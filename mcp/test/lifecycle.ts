import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Session lifecycle through MCP: verdi_session_start -> inspect -> verdi_session_stop.
 * Only ever touches the session it starts (label mcp-lifecycle).
 */
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const evidenceDir = join(repoRoot, "poc/evidence/lifecycle");
mkdirSync(evidenceDir, { recursive: true });
const logPath = join(evidenceDir, "lifecycle.log");

const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = [];
function check(name: string, passed: boolean, detail?: unknown): void {
  checks.push({ name, passed, detail });
  const line = `${passed ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`;
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["run", "mcp/src/server.ts"],
  cwd: repoRoot,
  stderr: "pipe",
});
const client = new Client({ name: "verdi-mcp-lifecycle", version: "0.1.0" });
await client.connect(transport);

const envelope = (result: unknown): Record<string, unknown> => {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("tool result has no text content");
  return JSON.parse(text) as Record<string, unknown>;
};
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const started = Date.now();
  const env = envelope(await client.callTool({ name, arguments: args }));
  console.log(`${name} (${Date.now() - started} ms): ${JSON.stringify(env).slice(0, 600)}`);
  return env;
};

const LABEL = "mcp-lifecycle";
let sessionId: string | undefined;

try {
  // Clean slate: stop a leftover from an aborted run, ignore failures.
  await call("verdi_session_stop", { label: LABEL });

  const started = await call("verdi_session_start", {
    label: LABEL,
    cwd: join(repoRoot, "demo/sim"),
    fsdb: join(repoRoot, "demo/sim/sync_fifo.fsdb"),
    design: [join(repoRoot, "demo/sim/filelist.f")],
    top: "tb_sync_fifo",
    timeout_sec: 240,
    settle_sec: 10,
  });
  check("start.ok", started.ok === true, started.error);
  if (started.ok !== true) throw new Error("session start failed");
  const data = (started.data ?? {}) as { session_id?: string; port?: number; pid?: number; state?: string };
  sessionId = data.session_id;
  check("start.session_id", Boolean(sessionId), data);
  check("start.port_range", (data.port ?? 0) >= 11000 && (data.port ?? 0) <= 11999, data);
  check("start.state_up", data.state === "up", data);

  const info = await call("verdi_session_info", { session_id: sessionId });
  check("info.ok", info.ok === true);
  check(
    "info.label",
    (info.data as { label?: string } | undefined)?.label === LABEL,
    info.data,
  );

  const windows = await call("verdi_windows_list", { session_id: sessionId });
  check("windows.ok", windows.ok === true);
  const windowList = (windows.data as { windows?: Array<{ window_id: string }> } | undefined)?.windows ?? [];
  check("windows.nonempty", windowList.length > 0, { count: windowList.length });

  if (windowList.length > 0) {
    const raised = await call("verdi_window_raise", {
      session_id: sessionId,
      window_id: windowList[0].window_id,
    });
    check("window_raise.ok", raised.ok === true, raised.error);
  }

  const stopped = await call("verdi_session_stop", { session_id: sessionId });
  check("stop.ok", stopped.ok === true, stopped.error);
  sessionId = undefined;

  const after = await call("verdi_sessions_list");
  const stillUp = ((after.data as { sessions?: Array<{ id: string; state: string }> } | undefined)?.sessions ?? [])
    .filter((session) => session.state === "up" || session.state === "down");
  check("stop.removed", !stillUp.some((session) => session.id === data.session_id), { stillUp });
} catch (err) {
  check("lifecycle.exception", false, String(err));
  if (sessionId) {
    await call("verdi_session_stop", { session_id: sessionId }).catch(() => undefined);
  }
} finally {
  await client.close();
}

const ok = checks.every((entry) => entry.passed);
writeFileSync(
  join(evidenceDir, "summary.json"),
  `${JSON.stringify({ started: new Date().toISOString(), checks, ok }, null, 2)}\n`,
);
console.log(ok ? "LIFECYCLE PASSED" : "LIFECYCLE FAILED");
process.exit(ok ? 0 : 1);
