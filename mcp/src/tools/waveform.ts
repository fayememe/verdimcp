import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionEntry, ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { knownFsdb } from "../state.js";
import { assertAllowedPath } from "../paths.js";
import { convertTime, unitFromWindow, type TimeUnit } from "../time.js";

const tmpDir = join(homedir(), ".local/state/verdi-mcp/tmp");

export function tclQuote(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) return name;
  return /[[\]{}$\\\s]/.test(name) ? `{${name}}` : name;
}

async function allWindows(ctx: ToolContext, sessionId: string): Promise<string[]> {
  const res = await ctx.backend.exec(sessionId, ["wvGetAllWindows"]);
  const first = res.results[0];
  if (!first || !first.ok) {
    throw new AppError("window_not_found", "wvGetAllWindows failed", { result: first?.result });
  }
  return first.result.trim().split(/\s+/).filter(Boolean);
}

async function firstWindow(ctx: ToolContext, sessionId: string): Promise<string> {
  const windows = await allWindows(ctx, sessionId);
  if (windows.length === 0) {
    throw new AppError("window_not_found", "no nWave window in this session");
  }
  return windows[0];
}

async function resolveTarget(
  ctx: ToolContext,
  sessionId: string | undefined,
  windowId: string | undefined,
): Promise<{ session: SessionEntry; windowId: string }> {
  const session = await ctx.backend.resolveSession(sessionId);
  return { session, windowId: windowId ?? (await firstWindow(ctx, session.id)) };
}

async function windowUnit(
  ctx: ToolContext,
  sessionId: string,
  windowId: string,
): Promise<TimeUnit> {
  const res = await ctx.backend.exec(sessionId, [`wvGetWindowTimeUnit -win ${windowId}`]);
  const first = res.results[0];
  if (!first || !first.ok || !first.result.trim()) {
    throw new AppError("backend_error", "could not read the window time unit", {
      result: first?.result,
    });
  }
  return unitFromWindow(first.result);
}

function toUnit(value: number | undefined, unit: TimeUnit | undefined, target: TimeUnit): number | undefined {
  if (value === undefined) return undefined;
  return convertTime(value, unit ?? target, target);
}

export function registerWaveform(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_fsdb_open",
    {
      title: "Open FSDB in nWave",
      description:
        "Open an FSDB file in one nWave window (wvOpenFile) and return the window time unit. This changes the GUI and records the FSDB for later NPI queries.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1),
        path: z.string().min(1),
        time_unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_fsdb_open", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const safePath = assertAllowedPath(args.path, [session.cwd]);
        const res = await ctx.backend.exec(session.id, [
          `wvOpenFile -win ${args.window_id} ${tclQuote(safePath)}`,
        ]);
        const first = res.results[0];
        if (!first || !first.ok) {
          throw new AppError("backend_error", "wvOpenFile failed", { result: first?.result });
        }
        const unit = await windowUnit(ctx, session.id, args.window_id);
        knownFsdb.set(session.id, safePath);
        return { path: safePath, time_unit: `1${unit}`, requested_unit: args.time_unit ?? null };
      }),
  );

  server.registerTool(
    "verdi_signals_list",
    {
      title: "List signals or scopes",
      description:
        "Dump all signals or scopes from the FSDB open in an nWave window, filter by a case-insensitive substring, and paginate with offset/limit. Returns total, truncated and next_offset.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        kind: z.enum(["signal", "scope"]).optional(),
        delim: z.string().min(1).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) =>
      runTool("verdi_signals_list", async () => {
        const { session, windowId } = await resolveTarget(ctx, args.session_id, args.window_id);
        const kind = args.kind ?? "signal";
        const delim = args.delim ?? "/";
        const limit = args.limit ?? 500;
        const offset = args.offset ?? 0;
        mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const file = join(tmpDir, `signals-${randomUUID()}.txt`);
        try {
          const res = await ctx.backend.exec(session.id, [
            `wvDumpSignalListToFile -win ${windowId} -${kind} -delim ${tclQuote(delim)} -file ${tclQuote(file)}`,
          ]);
          const first = res.results[0];
          if (!first || !first.ok) {
            throw new AppError("backend_error", "wvDumpSignalListToFile failed", {
              result: first?.result,
            });
          }
          const lines = readFileSync(file, "utf8")
            .split(/\r?\n/)
            .map((line: string) => line.trim())
            .filter(Boolean);
          const filtered = args.search
            ? lines.filter((line: string) => line.toLowerCase().includes(args.search!.toLowerCase()))
            : lines;
          const items = filtered.slice(offset, offset + limit);
          return {
            items,
            total: filtered.length,
            truncated: offset + items.length < filtered.length,
            next_offset: offset + items.length < filtered.length ? offset + items.length : null,
          };
        } finally {
          rmSync(file, { force: true });
        }
      }),
  );

  server.registerTool(
    "verdi_signals_add",
    {
      title: "Add signals to nWave",
      description:
        "Add one or more signals (absolute paths) to an nWave window. This changes the GUI. Bus names with [ ] are Tcl-quoted automatically.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1).max(200),
      },
    },
    async (args) =>
      runTool("verdi_signals_add", async () => {
        const { session, windowId } = await resolveTarget(ctx, args.session_id, args.window_id);
        const quoted = args.signals.map(tclQuote).join(" ");
        const res = await ctx.backend.exec(session.id, [
          `wvAddSignal -win ${windowId} ${quoted}`,
        ]);
        const first = res.results[0];
        return {
          requested: args.signals,
          ok: Boolean(first?.ok),
          result: first?.result ?? "",
          events: res.events,
        };
      }),
  );

  server.registerTool(
    "verdi_signals_remove",
    {
      title: "Remove signals from nWave",
      description:
        "Remove one or more signals from an nWave window. This changes the GUI.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1).max(200),
      },
    },
    async (args) =>
      runTool("verdi_signals_remove", async () => {
        const { session, windowId } = await resolveTarget(ctx, args.session_id, args.window_id);
        const quoted = args.signals.map(tclQuote).join(" ");
        const res = await ctx.backend.exec(session.id, [
          `wvDeleteSignal -win ${windowId} ${quoted}`,
        ]);
        const first = res.results[0];
        return {
          requested: args.signals,
          ok: Boolean(first?.ok),
          result: first?.result ?? "",
        };
      }),
  );

  server.registerTool(
    "verdi_cursor_set",
    {
      title: "Set nWave cursor",
      description:
        "Move the nWave cursor to an absolute time (with optional unit), or to the beginning/end of the waveform. This changes the GUI.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        time: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        begin: z.boolean().optional(),
        end: z.boolean().optional(),
      },
    },
    async (args) =>
      runTool("verdi_cursor_set", async () => {
        const { session, windowId } = await resolveTarget(ctx, args.session_id, args.window_id);
        const unit = await windowUnit(ctx, session.id, windowId);
        if (args.begin && args.end) {
          throw new AppError("invalid_argument", "begin and end are mutually exclusive");
        }
        let selector: string;
        let requested: { time: number | null; unit: TimeUnit; mode: string };
        if (args.begin) {
          selector = "-begin";
          requested = { time: null, unit, mode: "begin" };
        } else if (args.end) {
          selector = "-end";
          requested = { time: null, unit, mode: "end" };
        } else if (args.time !== undefined) {
          const converted = toUnit(args.time, args.unit, unit);
          selector = String(converted);
          requested = { time: converted ?? null, unit, mode: "time" };
        } else {
          throw new AppError("invalid_argument", "provide time, begin, or end");
        }
        const res = await ctx.backend.exec(session.id, [
          `wvSetCursor -win ${windowId} ${selector}`,
        ]);
        const first = res.results[0];
        if (!first || !first.ok) {
          throw new AppError("backend_error", "wvSetCursor failed", { result: first?.result });
        }
        return requested;
      }),
  );
}
