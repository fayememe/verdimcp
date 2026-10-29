import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const repoRoot = resolve(mcpRoot, "..");
const evidenceDir = join(repoRoot, "evidence/m1-m5");
mkdirSync(evidenceDir, { recursive: true });
const logPath = join(evidenceDir, "mcp-smoke.log");
const summaryPath = join(evidenceDir, "summary.json");

const expectedTools = [
  "verdi_capabilities",
  "verdi_sessions_list",
  "verdi_session_info",
  "verdi_session_start",
  "verdi_session_stop",
  "verdi_windows_list",
  "verdi_window_create",
  "verdi_window_raise",
  "verdi_window_screenshot",
  "verdi_fsdb_open",
  "verdi_signals_list",
  "verdi_signals_add",
  "verdi_signals_remove",
  "verdi_cursor_set",
  "verdi_value_get",
  "verdi_transitions_get",
  "verdi_xz_scan",
  "verdi_scopes_list",
  "verdi_drivers_get",
  "verdi_fanin_get",
  "verdi_fanout_get",
  "verdi_source_get",
  "verdi_tcl_exec",
];

const summary: Record<string, unknown> = { started: new Date().toISOString(), checks: [] };

function childEnv(): Record<string, string> {
  // StdioClientTransport only forwards a safe subset by default; the server needs the
  // caller's EDA environment (VERDI_HOME, DISPLAY, XAUTHORITY, LD_LIBRARY_PATH, ...).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function log(line: string): void {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  appendFileSync(logPath, `${text}\n`);
}

function check(name: string, passed: boolean, detail?: unknown): void {
  (summary.checks as Array<Record<string, unknown>>).push({ name, passed, detail });
  log(`${passed ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  if (!passed) throw new Error(`check failed: ${name}`);
}

function envelope(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("tool result has no text content");
  return JSON.parse(text) as Record<string, unknown>;
}

function hasImage(result: unknown): boolean {
  const content = (result as { content?: Array<{ type?: string }> }).content ?? [];
  return content.some((part) => part.type === "image");
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "mcp/src/server.ts"],
    cwd: repoRoot,
    stderr: "pipe",
    env: childEnv(),
  });
  const client = new Client({ name: "verdimcp-acceptance", version: "0.1.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    log(`call ${name} ${JSON.stringify(args)}`);
    const result = await client.callTool({ name, arguments: args });
    const env = envelope(result);
    log(`result ${name}: ${JSON.stringify(env).slice(0, 1200)}`);
    return env;
  };

  try {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of expectedTools) check(`tool:${name}`, names.has(name));

    const caps = await call("verdi_capabilities");
    check("capabilities.ok", caps.ok === true);
    check("capabilities.npi", Boolean((caps.data as { engines?: { npi?: boolean } }).engines?.npi));

    const sessions = await call("verdi_sessions_list");
    check("sessions.ok", sessions.ok === true);
    const sessionList =
      (sessions.data as { sessions?: Array<{ id: string; state: string; label?: string }> }).sessions ?? [];
    const up = sessionList.filter((session) => session.state === "up");
    const wantedLabel = process.env.VERDI_ACCEPTANCE_LABEL;
    const preferred = wantedLabel ? up.find((session) => session.label === wantedLabel) : undefined;
    if (up.length === 0) {
      log("NO_SESSION: acceptance requires a running Verdi session");
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    const sid = (preferred ?? up[0]).id;
    check("sessions.has_up", true, { sid, count: up.length });

    const info = await call("verdi_session_info", { session_id: sid });
    check("session_info.ok", info.ok === true);

    const windows = await call("verdi_windows_list", { session_id: sid });
    check("windows_list.ok", windows.ok === true);

    const created = await call("verdi_window_create", { session_id: sid });
    check("window_create.ok", created.ok === true);
    const windowId = (created.data as { window_id?: string }).window_id;
    if (!windowId) throw new Error("window_create returned no window_id");

    const shot = await call("verdi_window_screenshot", {
      session_id: sid,
      window_id: windowId,
      inline: false,
    });
    check("screenshot.ok", shot.ok === true);
    const shotData = shot.data as { path?: string; bytes?: number; width?: number; height?: number };
    check("screenshot.file", Boolean(shotData.path && existsSync(shotData.path)), shotData);
    check("screenshot.bytes", (shotData.bytes ?? 0) > 0, shotData);

    const inlineShot = await client.callTool({
      name: "verdi_window_screenshot",
      arguments: { session_id: sid, window_id: windowId, inline: true },
    });
    check("screenshot.inline_image", hasImage(inlineShot));

    const fsdb = join(repoRoot, "demo/sim/sync_fifo.fsdb");
    const opened = await call("verdi_fsdb_open", {
      session_id: sid,
      window_id: windowId,
      path: fsdb,
    });
    check("fsdb_open.ok", opened.ok === true, opened.data);

    const signals = await call("verdi_signals_list", {
      session_id: sid,
      window_id: windowId,
      search: "tb_sync_fifo",
      limit: 50,
    });
    check("signals_list.ok", signals.ok === true);
    const items = (signals.data as { items?: string[] }).items ?? [];
    check("signals_list.nonempty", items.length > 0, { count: items.length });
    const pick = (needle: string) => items.find((item) => item.toLowerCase().includes(needle));
    const clk = pick("clk");
    const rst = pick("rst_n");
    const rd = pick("rd_data");
    check("signals.have_clk", Boolean(clk), items.slice(0, 10));
    check("signals.have_rst", Boolean(rst));
    check("signals.have_rd", Boolean(rd));
    if (!clk || !rst || !rd) throw new Error("demo signals not found");

    const added = await call("verdi_signals_add", {
      session_id: sid,
      window_id: windowId,
      signals: [clk, rst, rd],
    });
    check("signals_add.ok", added.ok === true);

    const removed = await call("verdi_signals_remove", {
      session_id: sid,
      window_id: windowId,
      signals: [rd],
    });
    check("signals_remove.ok", removed.ok === true, removed.data);
    const readded = await call("verdi_signals_add", {
      session_id: sid,
      window_id: windowId,
      signals: [rd],
    });
    check("signals_readd.ok", readded.ok === true);

    const cursor = await call("verdi_cursor_set", {
      session_id: sid,
      window_id: windowId,
      time: 40,
      unit: "ns",
    });
    check("cursor_set.ok", cursor.ok === true, cursor.data);

    const value = await call("verdi_value_get", {
      session_id: sid,
      window_id: windowId,
      signal: rst,
      time: 40,
      unit: "ns",
    });
    check("value_get.ok", value.ok === true);
    const rstValue = String((value.data as { value?: string }).value ?? "").toLowerCase();
    check("value_get.rst_1", rstValue === "1", { signal: rst, value: rstValue });

    const current = await call("verdi_value_get", {
      session_id: sid,
      window_id: windowId,
      signal: rst,
    });
    check("value_get.current_ok", current.ok === true, current.data);

    const transitions = await call("verdi_transitions_get", {
      session_id: sid,
      window_id: windowId,
      signal: clk,
      start: 0,
      end: 240,
      unit: "ns",
      max: 500,
      engine: "auto",
    });
    check("transitions.ok", transitions.ok === true);
    check(
      "transitions.nonempty",
      ((transitions.data as { transitions?: unknown[] }).transitions ?? []).length > 0,
    );

    const autoEngine = (transitions.data as { engine?: Record<string, unknown> } | undefined)
      ?.engine;
    check(
      "transitions.engine_reported",
      autoEngine?.used === "npi" || autoEngine?.used === "gui",
      autoEngine,
    );
    check(
      "transitions.switch_hint_null_when_fast",
      autoEngine?.switch_hint === null,
      autoEngine,
    );
    const autoFsdb = (transitions.data as { fsdb?: Record<string, unknown> | null } | undefined)
      ?.fsdb;
    check(
      "transitions.fsdb_block",
      autoFsdb === null ||
        autoFsdb === undefined ||
        (typeof autoFsdb.is_completed === "boolean" && typeof autoFsdb.max_time === "number"),
      autoFsdb,
    );

    const guiTransitions = await call("verdi_transitions_get", {
      session_id: sid,
      window_id: windowId,
      signal: rst,
      start: 0,
      end: 240,
      unit: "ns",
      max: 100,
      engine: "gui",
    });
    check("transitions.gui_ok", guiTransitions.ok === true, guiTransitions.data);
    const guiEngine = (guiTransitions.data as { engine?: Record<string, unknown> } | undefined)
      ?.engine;
    check(
      "transitions.explicit_gui_honoured",
      guiEngine?.used === "gui" && guiEngine?.requested === "gui" && guiEngine?.fallback === false,
      guiEngine,
    );

    const xz = await call("verdi_xz_scan", {
      session_id: sid,
      window_id: windowId,
      signals: [rd],
      start: 0,
      end: 240,
      unit: "ns",
      max: 10,
      engine: "auto",
    });
    check("xz_scan.ok", xz.ok === true);
    check(
      "xz_scan.has_x",
      ((xz.data as { candidates?: unknown[] }).candidates ?? []).length > 0,
      xz.data,
    );
    const xzEngine = (xz.data as { engine?: Record<string, unknown> } | undefined)?.engine;
    check("xz_scan.engine_used_npi", xzEngine?.used === "npi", xzEngine);
    const xzFsdb = (xz.data as { fsdb?: Record<string, unknown> | null } | undefined)?.fsdb;
    check(
      "xz_scan.fsdb_completed",
      xzFsdb !== null && xzFsdb !== undefined && xzFsdb.is_completed === true,
      xzFsdb,
    );

    const scopes = await call("verdi_scopes_list", {
      session_id: sid,
      window_id: windowId,
      limit: 20,
    });
    check("scopes_list.ok", scopes.ok === true);

    const drivers = await call("verdi_drivers_get", {
      session_id: sid,
      signal: "tb_sync_fifo.clk",
    });
    check(
      "drivers.ok_or_not_supported",
      drivers.ok === true || (drivers.error as { code?: string } | undefined)?.code === "not_supported",
      drivers.error,
    );

    for (const name of ["verdi_fanin_get", "verdi_fanout_get"]) {
      const traced = await call(name, { session_id: sid, signal: "tb_sync_fifo.clk" });
      const code = (traced.error as { code?: string } | undefined)?.code;
      check(`${name}.ok_or_not_supported`, traced.ok === true || code === "not_supported", traced.error);
    }

    const runCompare = await call("verdi_waveform_compare", {
      session_id: sid,
      window_id: windowId,
      signals: [clk],
      against_fsdb: [`${process.cwd()}/demo/sim/sync_fifo.fsdb`],
    });
    check("waveform_compare.ok", runCompare.ok === true, runCompare.error);
    const compareImage = (runCompare.data as { image?: { path?: string; bytes?: number } } | undefined)
      ?.image;
    check(
      "waveform_compare.image",
      Boolean(compareImage?.path) && (compareImage?.bytes ?? 0) > 1000,
      compareImage,
    );

    const coneDriver = await call("verdi_cone_capture", {
      session_id: sid,
      signal: "tb_sync_fifo.clk",
      mode: "driver",
    });
    check(
      "cone_capture.driver_ok_or_not_supported",
      coneDriver.ok === true ||
        (coneDriver.error as { code?: string } | undefined)?.code === "not_supported",
      coneDriver.error,
    );

    const coneX = await call("verdi_cone_capture", {
      session_id: sid,
      signal: "tb_sync_fifo.rd_data[7:0]",
      mode: "x",
      time: 0,
      unit: "ns",
    });
    check("cone_capture.x_ok", coneX.ok === true, coneX.error);
    const coneImage = (coneX.data as { image?: { path?: string; bytes?: number; width?: number } })
      ?.image;
    check(
      "cone_capture.x_image",
      Boolean(coneImage?.path) && (coneImage?.bytes ?? 0) > 1000 && (coneImage?.width ?? 0) > 0,
      coneImage,
    );
    check(
      "cone_capture.x_text_unavailable",
      (coneX.data as { text_available?: boolean } | undefined)?.text_available === false,
      coneX.data,
    );

    const raised = await call("verdi_window_raise", { session_id: sid, window_id: windowId });
    check("window_raise.ok", raised.ok === true, raised.error);

    const rawTcl = await call("verdi_tcl_exec", { session_id: sid, commands: ["expr {1+2}"] });
    if (process.env.VERDI_ALLOW_RAW === "1") {
      check("tcl_exec.enabled", rawTcl.ok === true, rawTcl.error);
    } else {
      check(
        "tcl_exec.disabled_by_default",
        rawTcl.ok === false && (rawTcl.error as { code?: string } | undefined)?.code === "not_supported",
        rawTcl.error,
      );
    }

    const multiLevel = await call("verdi_drivers_get", {
      session_id: sid,
      signal: "tb_sync_fifo.clk",
      levels: 2,
    });
    const multiCode = (multiLevel.error as { code?: string } | undefined)?.code;
    check(
      "drivers.levels2_ok_or_not_supported",
      multiLevel.ok === true || multiCode === "not_supported",
      multiLevel.error,
    );

    const sourceSignal = await call("verdi_source_get", {
      session_id: sid,
      signal: "tb_sync_fifo.clk",
    });
    const sourceCode = (sourceSignal.error as { code?: string } | undefined)?.code;
    check(
      "source_get.signal_ok_or_not_supported",
      sourceSignal.ok === true || sourceCode === "not_supported",
      sourceSignal.error,
    );

    const source = await call("verdi_source_get", {
      session_id: sid,
      file: join(repoRoot, "demo/rtl/sync_fifo.v"),
      line: 1,
      lines: 20,
    });
    check("source_get.file", source.ok === true);
    check(
      "source_get.snippet",
      String((source.data as { snippet?: string }).snippet ?? "").length > 0,
    );


    const wrv = pick("wr_valid");
    const wrr = pick("wr_ready");
    const wrd = pick("wr_data");
    check("signals.have_wr", Boolean(wrv && wrr && wrd));

    const mapPut = await call("verdi_signal_map_put", {
      name: "tb_fifo_wr",
      signals: {
        clock: clk,
        valid: wrv,
        ready: wrr,
        data: wrd,
      },
    });
    check("signal_map_put.ok", mapPut.ok === true);
    const mapGet = await call("verdi_signal_map_get", { name: "tb_fifo_wr" });
    check("signal_map_get.ok", mapGet.ok === true);
    const mapList = await call("verdi_signal_map_list");
    check("signal_map_list.ok", mapList.ok === true);

    const handshake = await call("verdi_handshake_beats", {
      session_id: sid,
      channel: { name: "wr", clock: clk, valid: wrv, ready: wrr, data: [wrd] },
      start: 0,
      end: 240,
      unit: "ns",
      max: 100,
    });
    check("handshake_beats.ok", handshake.ok === true, handshake.data);

    const stats = await call("verdi_change_stats", {
      session_id: sid,
      signals: [clk, rst, rd],
      start: 0,
      end: 240,
      unit: "ns",
    });
    check("change_stats.ok", stats.ok === true);
    check(
      "change_stats.rows",
      ((stats.data as { stats?: unknown[] }).stats ?? []).length === 3,
      stats.data,
    );
    const statsEngine = (stats.data as { engine?: Record<string, unknown> } | undefined)?.engine;
    check(
      "change_stats.engine_npi_only",
      statsEngine?.used === "npi" &&
        Array.isArray(statsEngine?.alternatives) &&
        (statsEngine.alternatives as unknown[]).length === 0 &&
        statsEngine?.switch_hint === null,
      statsEngine,
    );
    const statsFsdb = (stats.data as { fsdb?: Record<string, unknown> | null } | undefined)?.fsdb;
    check(
      "change_stats.fsdb_block",
      statsFsdb !== null &&
        statsFsdb !== undefined &&
        typeof statsFsdb.is_completed === "boolean" &&
        typeof statsFsdb.max_time === "number",
      statsFsdb,
    );

    const scan = await call("verdi_window_scan", {
      session_id: sid,
      predicate: `${wrv} && !${wrr}`,
      start: 0,
      end: 240,
      unit: "ns",
      bins: 500,
      max: 20,
    });
    check("window_scan.ok", scan.ok === true, scan.data);

    const checkDef = await call("verdi_check_define", {
      name: "wr_stall",
      predicate: `${wrv} && !${wrr}`,
      params: { session_id: sid, start: 0, end: 240, unit: "ns", bins: 500, max: 20 },
    });
    check("check_define.ok", checkDef.ok === true);
    const checkId = (checkDef.data as { check_id?: string }).check_id;
    if (!checkId) throw new Error("check_define returned no check_id");
    const checkRun = await call("verdi_check_run", { check_id: checkId });
    check("check_run.ok", checkRun.ok === true, checkRun.data);

    const evidence = await call("verdi_evidence_create", {
      session_id: sid,
      title: "acceptance evidence",
    });
    check("evidence_create.ok", evidence.ok === true);
    const evidenceId = (evidence.data as { evidence_id?: string }).evidence_id;
    if (!evidenceId) throw new Error("evidence_create returned no evidence_id");

    const captureAnnotated = await call("verdi_capture_annotate", {
      evidence_id: evidenceId,
      session_id: sid,
      signals: [clk, rst],
      start: 0,
      end: 240,
      unit: "ns",
      annotations: [
        { type: "marker", time: 40, label: "agent_m1" },
        { type: "comment", time: 0, end: 80, label: "agent: window" },
        { type: "highlight", signal: clk, label: "clk", color: "ID_BLUE3" },
      ],
    });
    check("capture_annotate.ok", captureAnnotated.ok === true, captureAnnotated.error);
    const annotatedPath = (((captureAnnotated.data as { data?: { screenshot?: { path?: string } } }).data
      ?.screenshot?.path) ?? "");
    check("capture_annotate.file", Boolean(annotatedPath && existsSync(annotatedPath)), annotatedPath);

    const render = await call("verdi_waveform_render", {
      evidence_id: evidenceId,
      session_id: sid,
      signals: [clk, rst],
      start: 0,
      end: 240,
      unit: "ns",
      bins: 200,
    });
    check("waveform_render.ok", render.ok === true, render.error);
    const renderPath = (render.data as { path?: string }).path;
    check("waveform_render.file", Boolean(renderPath && existsSync(renderPath)), renderPath);

    const evidenceAdded = await call("verdi_evidence_add", {
      evidence_id: evidenceId,
      type: "value",
      data: { signal: rst, time: 40, value: "1" },
      query_used: { tool: "verdi_value_get", arguments: { signal: rst, time: 40, unit: "ns" } },
    });
    check("evidence_add.ok", evidenceAdded.ok === true);

    const report = await call("verdi_evidence_report", {
      evidence_id: evidenceId,
      format: "md",
    });
    check("evidence_report.ok", report.ok === true);
    const reportPath = (report.data as { path?: string }).path;
    check("evidence_report.file", Boolean(reportPath && existsSync(reportPath)), reportPath);

    const compare = await call("verdi_evidence_compare", {
      evidence_id: evidenceId,
      session_id: sid,
      signals: [clk],
      roi_a: { start: 0, end: 120 },
      roi_b: { start: 120, end: 240 },
      unit: "ns",
    });
    check("evidence_compare.ok", compare.ok === true, compare.error);
    const comparePath = (((compare.data as { data?: { path?: string } }).data?.path) ?? "");
    check("evidence_compare.file", Boolean(comparePath && existsSync(comparePath)), comparePath);

    check("all_checks", true);
    summary.finished = new Date().toISOString();
    summary.ok = true;
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    log("ACCEPTANCE PASSED");
  } catch (err) {
    summary.finished = new Date().toISOString();
    summary.ok = false;
    summary.error = err instanceof Error ? err.stack ?? err.message : String(err);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    log(`ACCEPTANCE FAILED: ${String(summary.error)}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`MCP SMOKE FAILED: ${message}`);
  appendFileSync(logPath, `MCP SMOKE FAILED: ${message}\n`);
  process.exit(1);
});
