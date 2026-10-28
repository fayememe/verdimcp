import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  Backend,
  CapabilityMatrix,
  ExecResult,
  ScreenshotResult,
  SessionEntry,
  StartSessionOptions,
} from "./context.js";
import { AppError, type ErrorCode } from "./errors.js";

const VERDI_HOME_DEFAULT = "/opt/synopsys/verdi/W-2024.09-SP1";

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

export class DefaultBackend implements Backend {
  private readonly cli: string;

  constructor() {
    this.cli = resolveCli();
  }

  cliPath(): string {
    return this.cli;
  }

  async listSessions(): Promise<SessionEntry[]> {
    const r = await this.run(this.cli, ["list", "--json"], { timeoutMs: 15_000 });
    if (r.code !== 0) {
      throw new AppError("backend_error", "verdi-session list failed", {
        stderr: r.stderr.trim(),
      });
    }
    try {
      const parsed: unknown = JSON.parse(r.stdout);
      if (!Array.isArray(parsed)) {
        throw new Error("list --json did not return an array");
      }
      return parsed as SessionEntry[];
    } catch (err) {
      throw new AppError("backend_error", `invalid verdi-session list JSON: ${String(err)}`, {
        stdout: r.stdout.slice(0, 2000),
      });
    }
  }

  async resolveSession(sessionId?: string): Promise<SessionEntry> {
    if (sessionId) {
      const r = await this.run(this.cli, ["info", "--id", sessionId], { timeoutMs: 15_000 });
      if (r.code !== 0) {
        throw new AppError("session_not_found", `session not found: ${sessionId}`, {
          stderr: r.stderr.trim(),
        });
      }
      return this.parseSession(r.stdout, sessionId);
    }

    const sessions = await this.listSessions();
    const up = sessions.filter((s) => s.state === "up");
    if (up.length === 0) {
      throw new AppError(
        "session_not_found",
        "no running Verdi session; start one with verdi-session start --detach ...",
        { sessions: sessions.map((s) => ({ id: s.id, state: s.state })) },
      );
    }
    if (up.length > 1) {
      throw new AppError(
        "ambiguous_session",
        `multiple running Verdi sessions (${up.map((s) => s.id).join(", ")}); pass session_id`,
        { candidates: up.map((s) => ({ id: s.id, label: s.label, port: s.port })) },
      );
    }
    return up[0];
  }

  async startSession(opts: StartSessionOptions): Promise<SessionEntry> {
    const timeoutSec = opts.timeoutSec ?? 180;
    const verdiArgs = [
      ...(opts.fsdb ? ["-ssf", opts.fsdb] : []),
      ...(opts.design ?? []).flatMap((file) => ["-f", file]),
      ...(opts.top ? ["-top", opts.top] : []),
      "-nologo",
      ...(opts.args ?? []),
    ];
    const args = ["start", "--detach", "--timeout", String(timeoutSec)];
    if (opts.label) args.push("--label", opts.label);
    if (opts.port) args.push("--port", String(opts.port));
    args.push("--", ...verdiArgs);

    const startedAt = Date.now();
    const display = opts.display ?? process.env.DISPLAY ?? process.env.VERDI_DISPLAY ?? "localhost:10.0";
    const r = await this.run(this.cli, args, {
      timeoutMs: timeoutSec * 1000 + 60_000,
      cwd: opts.cwd,
      env: { DISPLAY: display, XAUTHORITY: process.env.XAUTHORITY ?? join(homedir(), ".Xauthority") },
    });
    if (r.code !== 0) {
      throw new AppError("backend_error", "verdi-session start failed", {
        exit_code: r.code,
        stdout: r.stdout.slice(-2000),
        stderr: r.stderr.slice(-2000),
      });
    }
    const match = /^session\s+(\S+)\s+port\s+(\d+)\s+pid\s+(\d+)/m.exec(r.stdout);
    if (!match) {
      throw new AppError("backend_error", "could not parse verdi-session start output", {
        stdout: r.stdout.slice(-2000),
      });
    }
    const entry = await this.resolveSession(match[1]);
    audit({
      action: "session_start",
      session_id: entry.id,
      port: entry.port,
      pid: entry.pid,
      label: entry.label,
      args: verdiArgs,
      elapsed_ms: Date.now() - startedAt,
    });
    return entry;
  }

  async stopSession(sessionId: string): Promise<void> {
    const r = await this.run(this.cli, ["stop", "--id", sessionId], { timeoutMs: 60_000 });
    if (r.code !== 0) {
      throw new AppError("backend_error", "verdi-session stop failed", {
        exit_code: r.code,
        stderr: r.stderr.trim(),
      });
    }
    audit({ action: "session_stop", session_id: sessionId });
  }

  async exec(
    sessionId: string,
    commands: string[],
    opts: { lockTimeoutSec?: number; timeoutMs?: number } = {},
  ): Promise<ExecResult> {
    const startedAt = Date.now();
    if (commands.length === 0) {
      throw new AppError("invalid_argument", "at least one Verdi command is required");
    }
    const args = [
      "exec",
      "--id",
      sessionId,
      "--json",
      "--lock-timeout",
      String(opts.lockTimeoutSec ?? 5),
      "--",
      ...commands,
    ];
    const r = await this.run(this.cli, args, { timeoutMs: opts.timeoutMs ?? 60_000 });
    if (r.timedOut) {
      throw new AppError("timeout", `verdi-session exec timed out after ${opts.timeoutMs ?? 60_000} ms`, {
        session_id: sessionId,
      });
    }
    if (r.code === 75) {
      throw new AppError("busy", `session ${sessionId} is busy`, { session_id: sessionId });
    }

    const results: ExecResult["results"] = [];
    const events: ExecResult["events"] = [];
    let protocolError: { code?: string; message?: string } | null = null;

    for (const line of r.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        throw new AppError("backend_error", "verdi-session emitted non-JSON output", {
          stdout: r.stdout.slice(0, 2000),
          stderr: r.stderr.trim(),
        });
      }
      switch (obj.type) {
        case "result":
          results.push({
            command: String(obj.command ?? ""),
            ok: Boolean(obj.ok),
            result: String(obj.result ?? ""),
          });
          break;
        case "event":
          events.push({
            event: String(obj.event ?? ""),
            data: String(obj.data ?? ""),
            cmd_index: typeof obj.cmd_index === "number" ? obj.cmd_index : undefined,
          });
          break;
        case "error":
          protocolError = {
            code: typeof obj.code === "string" ? obj.code : undefined,
            message: typeof obj.message === "string" ? obj.message : undefined,
          };
          break;
        case "connect":
        case "hold":
        case "hold_end":
          break;
        default:
          break;
      }
    }

    if (protocolError) {
      const code: ErrorCode =
        protocolError.code === "busy" || protocolError.code === "session_down"
          ? protocolError.code
          : "backend_error";
      throw new AppError(code, protocolError.message ?? "verdi-session reported an error");
    }
    if (results.length === 0 && r.code !== 0) {
      throw new AppError("backend_error", "verdi-session exec failed", {
        exit_code: r.code,
        stderr: r.stderr.trim(),
      });
    }
    audit({
      action: "exec",
      session_id: sessionId,
      commands,
      results: results.map((entry) => ({ command: entry.command, ok: entry.ok })),
      exit_code: r.code,
      elapsed_ms: Date.now() - startedAt,
    });
    return { results, events, stderr: r.stderr, exitCode: r.code };
  }

  async screenshot(sessionId: string, windowId: string): Promise<ScreenshotResult> {
    const startedAt = Date.now();
    const session = await this.resolveSession(sessionId);
    const xidRes = await this.exec(sessionId, [`wvGetXWindowId -id ${windowId}`]);
    const xidResult = xidRes.results[0];
    if (!xidResult || !xidResult.ok || !xidResult.result.trim()) {
      throw new AppError("window_not_found", `window ${windowId} has no X window id`, {
        command: xidResult?.command,
        result: xidResult?.result,
      });
    }
    const xid = xidResult.result.trim().replace(/^0x/i, "");
    const display = session.display || "localhost:10.0";
    const xauthority = process.env.XAUTHORITY || join(homedir(), ".Xauthority");
    const dir = join(homedir(), ".local/state/verdi-mcp/screenshots");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${sessionId}-${windowId}-${Date.now()}.png`);

    const shot = await this.run("import", ["-window", `0x${xid}`, path], {
      timeoutMs: 30_000,
      env: { DISPLAY: display, XAUTHORITY: xauthority },
    });
    if (shot.code !== 0 || !existsSync(path)) {
      throw new AppError("backend_error", "screenshot failed", {
        stderr: shot.stderr.trim(),
        display,
        xid: `0x${xid}`,
      });
    }

    const ident = await this.run("identify", ["-format", "%w %h", path], {
      timeoutMs: 10_000,
    });
    const [widthRaw, heightRaw] = ident.stdout.trim().split(/\s+/);
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new AppError("backend_error", "could not determine screenshot dimensions", {
        stdout: ident.stdout,
        stderr: ident.stderr,
      });
    }

    const bytes = statSync(path).size;
    const data = await Bun.file(path).arrayBuffer();
    const sha256 = createHash("sha256").update(Buffer.from(data)).digest("hex");
    audit({
      action: "screenshot",
      session_id: sessionId,
      window_id: windowId,
      xid: `0x${xid}`,
      path,
      bytes,
      elapsed_ms: Date.now() - startedAt,
    });
    return { path, width, height, bytes, sha256, xid: `0x${xid}` };
  }

  async capabilities(): Promise<CapabilityMatrix> {
    const verdiHome = process.env.VERDI_HOME || VERDI_HOME_DEFAULT;
    const npi = existsSync(join(verdiHome, "share/NPI/python/pynpi")) && Bun.which("python3") !== null;
    return {
      verdi_home: verdiHome,
      engines: { gui: true, npi },
      tools: [
        { name: "verdi_capabilities", status: "verified" },
        { name: "verdi_sessions_list", status: "verified" },
        { name: "verdi_session_info", status: "verified" },
        { name: "verdi_session_start", status: "verified", notes: "detach only; never attaches to existing GUI" },
        { name: "verdi_session_stop", status: "verified", notes: "registry sessions only" },
        { name: "verdi_windows_list", status: "verified" },
        { name: "verdi_window_create", status: "verified" },
        { name: "verdi_window_raise", status: "verified", notes: "wvRaiseWindow" },
        { name: "verdi_window_screenshot", status: "verified" },
        { name: "verdi_fsdb_open", status: "verified" },
        { name: "verdi_signals_list", status: "verified", notes: "GUI dump to file" },
        { name: "verdi_signals_add", status: "verified" },
        { name: "verdi_signals_remove", status: "verified" },
        { name: "verdi_cursor_set", status: "verified" },
        { name: "verdi_value_get", status: "verified", notes: "GUI" },
        { name: "verdi_transitions_get", status: "verified", notes: "GUI loop / NPI" },
        { name: "verdi_xz_scan", status: "verified", notes: "NPI; GUI fallback budgeted" },
        { name: "verdi_scopes_list", status: "verified" },
        { name: "verdi_drivers_get", status: "verified", notes: "requires -f design library" },
        { name: "verdi_fanin_get", status: "verified", notes: "1 level; >1 degraded (ByLevel has no leaf pins)" },
        { name: "verdi_fanout_get", status: "verified", notes: "schTraceLoad" },
        { name: "verdi_source_get", status: "verified", notes: "requires -f design library" },
        { name: "verdi_signal_map_put", status: "verified" },
        { name: "verdi_signal_map_get", status: "verified" },
        { name: "verdi_signal_map_list", status: "verified" },
        { name: "verdi_handshake_beats", status: "verified" },
        { name: "verdi_change_stats", status: "verified" },
        { name: "verdi_window_scan", status: "verified" },
        { name: "verdi_check_define", status: "verified" },
        { name: "verdi_check_run", status: "verified" },
        { name: "verdi_evidence_create", status: "verified" },
        { name: "verdi_capture_annotate", status: "verified" },
        { name: "verdi_waveform_render", status: "verified", notes: "bounded: <=16 signals, <=1000 bins" },
        { name: "verdi_evidence_add", status: "verified" },
        { name: "verdi_evidence_compare", status: "verified" },
        { name: "verdi_evidence_report", status: "verified" },
        {
          name: "verdi_tcl_exec",
          status: "documented",
          notes: "raw Tcl escape hatch; disabled unless VERDI_ALLOW_RAW=1",
        },
      ],
    };
  }

  private parseSession(raw: string, sessionId: string): SessionEntry {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("not an object");
      }
      return parsed as SessionEntry;
    } catch (err) {
      throw new AppError("backend_error", `invalid session info for ${sessionId}: ${String(err)}`, {
        stdout: raw.slice(0, 2000),
      });
    }
  }

  private async run(
    command: string,
    args: string[],
    opts: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {},
  ): Promise<RunResult> {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...(opts.env ?? {}) }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn({
        cmd: [command, ...args],
        stdout: "pipe",
        stderr: "pipe",
        env,
        cwd: opts.cwd,
      });
    } catch (err) {
      throw new AppError("backend_error", `failed to spawn ${command}: ${String(err)}`);
    }

    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { stdout, stderr, code, timedOut };
  }
}

function audit(entry: Record<string, unknown>): void {
  try {
    const dir = join(homedir(), ".local/state/verdi-mcp");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(dir, "audit.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Auditing must never break a tool call.
  }
}

function resolveCli(): string {
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const candidates = [
    process.env.VERDI_SESSION_BIN,
    join(homedir(), ".local/bin/verdi-session"),
    join(repoRoot, "bin/verdi-session"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}
