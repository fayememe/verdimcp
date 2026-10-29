import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionEntry, ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { assertAllowedPath } from "../paths.js";
import { tclQuote } from "./waveform.js";

const tmpDir = join(homedir(), ".local/state/verdimcp/tmp");

function toDotName(name: string): string {
  return name.replace(/^\/+/, "").replaceAll("/", ".");
}

function deriveScope(signal: string): string {
  const dot = toDotName(signal);
  const index = dot.lastIndexOf(".");
  return index > 0 ? dot.slice(0, index) : dot;
}

async function firstWindow(ctx: ToolContext, sessionId: string): Promise<string> {
  const res = await ctx.backend.exec(sessionId, ["wvGetAllWindows"]);
  const first = res.results[0];
  if (!first || !first.ok) {
    throw new AppError("window_not_found", "wvGetAllWindows failed", { result: first?.result });
  }
  const windows = first.result.trim().split(/\s+/).filter(Boolean);
  if (windows.length === 0) {
    throw new AppError("window_not_found", "no nWave window in this session");
  }
  return windows[0];
}

function readReport(cwd: string): { path: string; lines: string[] } | null {
  const candidates = [
    join(cwd, "verdiLog/leafpin.rpt"),
    join(cwd, ".verdiLog/leafpin.rpt"),
  ].filter((path) => existsSync(path));
  if (candidates.length === 0) return null;
  const path = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
            .map((line: string) => line.trim())
    .filter(Boolean);
  return { path, lines };
}

function readSnippet(
  file: string,
  line: number,
  count: number,
  extraRoots: Array<string | undefined> = [],
): string {
  const safe = assertAllowedPath(file, extraRoots);
  if (!existsSync(safe)) {
    throw new AppError("not_supported", `source file not found: ${file}`);
  }
  const all = readFileSync(safe, "utf8").split(/\r?\n/);
  const start = Math.max(0, line - 1);
  return all.slice(start, start + count).join("\n");
}

interface TraceResult {
  leaf_pins: string[];
  cone_paths: string[];
  report_path: string | null;
  levels: number;
  degraded: boolean;
  note?: string;
}

const BY_LEVEL: Record<"driver" | "fanin" | "fanout", string> = {
  driver: "schTraceDriverByLevel",
  fanin: "schTraceFanInByLevel",
  fanout: "schTraceLoadByLevel",
};

function splitPathSegments(raw: string): string[] {
  const braced = [...raw.matchAll(/\{([^}]*)\}/g)].map((match) => match[1].trim());
  if (braced.length > 0) return braced;
  return raw.trim().split(/\s+/).filter(Boolean);
}

async function trace(
  ctx: ToolContext,
  session: SessionEntry,
  kind: "driver" | "fanin" | "fanout",
  signal: string,
  scope: string | undefined,
  levels: number,
): Promise<TraceResult> {
  const dotSignal = toDotName(signal);
  const dotScope = (scope ? toDotName(scope) : deriveScope(signal)).replace(/\.$/, "");
  const create = await ctx.backend.exec(session.id, [
    `schCreateWindow -delim . -scope ${tclQuote(dotScope)}`,
  ]);
  const created = create.results[0];
  const schWindow = created?.result.trim() ?? "";
  if (!created?.ok || !schWindow || schWindow === "0") {
    throw new AppError(
      "not_supported",
      "could not create an nSchema window; a design library is required",
      { hint: "start Verdi with -f <filelist> and elaborate the design", result: created?.result },
    );
  }

  const command =
    kind === "driver"
      ? "schTraceDriver"
      : kind === "fanin"
        ? // Verdi's schTraceFanIn result is not exposed to schDumpTracedLeafPin in
          // W-2024.09; the level-1 fan-in of a net is its direct driver set, which
          // schTraceDriver does expose.
          "schTraceDriver"
        : "schTraceLoad";

  try {
    if (levels > 1) {
      // Multi-level traces (*ByLevel) use a different internal store: Verdi does
      // not expose their result through schDumpTracedLeafPin, so we return the
      // traced path segments and mark the result degraded.
      const byLevel = await ctx.backend.exec(session.id, [
        `${BY_LEVEL[kind]} -win ${schWindow} -delim . -signal ${tclQuote(dotSignal)} -level ${levels}`,
      ]);
      const traced = byLevel.results[0];
      if (!traced?.ok) {
        throw new AppError("not_supported", `${BY_LEVEL[kind]} failed; design library is required`, {
          result: traced?.result,
        });
      }
      const cone_paths = splitPathSegments(traced.result);
      if (cone_paths.length === 0) {
        throw new AppError("not_supported", "multi-level trace returned no path", {
          result: traced.result,
          levels,
        });
      }
      return {
        leaf_pins: [],
        cone_paths,
        report_path: null,
        levels,
        degraded: true,
        note:
          "Verdi W-2024.09 does not expose *ByLevel trace results to schDumpTracedLeafPin; " +
          "cone_paths holds the traced path segments (boundary instances) instead of leaf pins. " +
          "Use levels=1 when leaf pins are required.",
      };
    }

    const traced = await ctx.backend.exec(session.id, [
      `${command} -win ${schWindow} -delim . -signal ${tclQuote(dotSignal)}`,
      "schDumpTracedLeafPin -delim .",
    ]);
    const traceResult = traced.results[0];
    if (!traceResult?.ok) {
      throw new AppError("not_supported", `${command} failed; design library is required`, {
        result: traceResult?.result,
      });
    }
    const dumpResult = traced.results[1];
    if (!dumpResult?.ok) {
      throw new AppError("not_supported", "schDumpTracedLeafPin failed", {
        result: dumpResult?.result,
      });
    }

    const report = readReport(session.cwd ?? process.cwd());
    if (!report) {
      throw new AppError("not_supported", "trace report was not produced", {
        cwd: session.cwd,
      });
    }

    return {
      leaf_pins: report.lines,
      cone_paths: splitPathSegments(traceResult.result),
      report_path: report.path,
      levels,
      degraded: false,
      ...(kind === "fanin"
        ? { note: "level-1 fan-in is reported as the direct driver set (schTraceDriver)" }
        : {}),
    };
  } finally {
    try {
      await ctx.backend.exec(session.id, [`schCloseWindow -win ${schWindow}`]);
    } catch {
      // Best effort: leaving the window open does not invalidate the trace result.
    }
  }
}

export function registerDesign(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_scopes_list",
    {
      title: "List scopes",
      description:
        "List scopes in the FSDB open in the target nWave window, optionally filtered by a root prefix.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        root: z.string().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      },
    },
    async (args) =>
      runTool("verdi_scopes_list", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const limit = args.limit ?? 500;
        mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
        const file = join(tmpDir, `scopes-${randomUUID()}.txt`);
        try {
          const res = await ctx.backend.exec(session.id, [
            `wvDumpSignalListToFile -win ${windowId} -scope -delim / -file ${tclQuote(file)}`,
          ]);
          const first = res.results[0];
          if (!first || !first.ok) {
            throw new AppError("backend_error", "wvDumpSignalListToFile failed", {
              result: first?.result,
            });
          }
          const all = readFileSync(file, "utf8")
            .split(/\r?\n/)
    .map((line: string) => line.trim())
            .filter(Boolean);
          const filtered = args.root ? all.filter((scope: string) => scope.startsWith(args.root!)) : all;
          const scopes = filtered.slice(0, limit);
          return {
            scopes,
            total: filtered.length,
            truncated: scopes.length < filtered.length,
          };
        } finally {
          rmSync(file, { force: true });
        }
      }),
  );

  const registerTrace = (
    name: string,
    kind: "driver" | "fanin" | "fanout",
    label: string,
  ) => {
    server.registerTool(
      name,
      {
        title: label,
        description:
          "Trace the design cone for a signal using nSchema. Requires Verdi to be started with a design library (-f). levels=1 returns leaf pins from leafpin.rpt; levels>1 uses Verdi's *ByLevel trace, which does not expose leaf pins (returns cone_paths boundary instances and sets degraded=true).",
        inputSchema: {
          session_id: z.string().min(1).optional(),
          signal: z.string().min(1),
          scope: z.string().optional(),
          levels: z.number().int().min(1).max(10).optional(),
        },
      },
      async (args) =>
        runTool(name, async () => {
          const session = await ctx.backend.resolveSession(args.session_id);
          return trace(ctx, session, kind, args.signal, args.scope, args.levels ?? 1);
        }),
    );
  };

  registerTrace("verdi_drivers_get", "driver", "Trace drivers");
  registerTrace("verdi_fanin_get", "fanin", "Trace fan-in");
  registerTrace("verdi_fanout_get", "fanout", "Trace fan-out (loads)");

  server.registerTool(
    "verdi_source_get",
    {
      title: "Read source code",
      description:
        "Read a source file directly, or open a signal's scope in the nTrace source window and return the code around the caret. Requires a design library for the signal path.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        signal: z.string().optional(),
        file: z.string().optional(),
        line: z.number().int().min(1).optional(),
        lines: z.number().int().min(1).max(500).optional(),
      },
    },
    async (args) =>
      runTool("verdi_source_get", async () => {
        const count = args.lines ?? 40;
        if (args.file) {
          const session = await ctx.backend.resolveSession(args.session_id);
          const line = args.line ?? 1;
          return {
            file: args.file,
            line,
            snippet: readSnippet(args.file, line, count, [session.cwd]),
            source: "file",
          };
        }
        if (!args.signal) {
          throw new AppError("invalid_argument", "provide signal or file");
        }
        const session = await ctx.backend.resolveSession(args.session_id);
        const scope = deriveScope(args.signal);
        const created = await ctx.backend.exec(session.id, [
          `srcCreateWindow -scope ${tclQuote(scope)}`,
        ]);
        const srcWindow = created.results[0]?.result.trim() ?? "";
        if (!created.results[0]?.ok || !srcWindow || srcWindow === "0") {
          throw new AppError("not_supported", "could not open a source window", {
            hint: "start Verdi with -f <filelist> and elaborate the design",
          });
        }
        const located = await ctx.backend.exec(session.id, [
          `srcGetCaretFile -win ${srcWindow}`,
          `srcGetCaretLine -win ${srcWindow}`,
        ]);
        const file = located.results[0]?.result.trim() ?? "";
        const line = Number(located.results[1]?.result.trim() ?? "0");
        try {
          await ctx.backend.exec(session.id, [`srcCloseWindow -win ${srcWindow}`]);
        } catch {
          // Best effort.
        }
        if (!file || file === "no file loaded" || !Number.isFinite(line) || line <= 0) {
          throw new AppError("not_supported", "source location is unavailable", {
            file,
            line,
            hint: "the design may not be elaborated",
          });
        }
        return {
          file,
          line,
          snippet: readSnippet(file, line, count, [session.cwd]),
          source: "gui",
        };
      }),
  );
}
