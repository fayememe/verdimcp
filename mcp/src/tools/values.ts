import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionEntry, ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { knownFsdb } from "../state.js";
import { convertTime, unitFromWindow, type TimeUnit } from "../time.js";
import { tclQuote } from "./waveform.js";

import { runNpi } from "../npi.js";
import {
  buildEngine,
  buildFsdb,
  fsdbStateFrom,
  fsdbUnitOf,
  readFsdbState,
  TRANSITIONS_NPI_MIN_MAX,
  withSuffix,
  withSwitchHint,
} from "../provenance.js";
export { runNpi };

const tmpDir = join(homedir(), ".local/state/verdimcp/tmp");

export async function allWindows(ctx: ToolContext, sessionId: string): Promise<string[]> {
  const res = await ctx.backend.exec(sessionId, ["wvGetAllWindows"]);
  const first = res.results[0];
  if (!first || !first.ok) {
    throw new AppError("window_not_found", "wvGetAllWindows failed", { result: first?.result });
  }
  return first.result.trim().split(/\s+/).filter(Boolean);
}

export async function firstWindow(ctx: ToolContext, sessionId: string): Promise<string> {
  const windows = await allWindows(ctx, sessionId);
  if (windows.length === 0) {
    throw new AppError("window_not_found", "no nWave window in this session");
  }
  return windows[0];
}

export async function windowUnit(ctx: ToolContext, sessionId: string, windowId: string): Promise<TimeUnit> {
  const res = await ctx.backend.exec(sessionId, [`wvGetWindowTimeUnit -win ${windowId}`]);
  const first = res.results[0];
  if (!first || !first.ok || !first.result.trim()) {
    throw new AppError("backend_error", "could not read the window time unit", {
      result: first?.result,
    });
  }
  return unitFromWindow(first.result);
}

export function fsdbFor(session: SessionEntry, explicit?: string): string | null {
  if (explicit) return explicit;
  const known = knownFsdb.get(session.id);
  if (known) return known;
  const raw = session.fsdb;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

export function toNpiName(name: string): string {
  return name.replace(/^\/+/, "").replaceAll("/", ".");
}

export async function dumpSignals(
  ctx: ToolContext,
  sessionId: string,
  windowId: string,
  kind: "signal" | "scope",
): Promise<string[]> {
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const file = join(tmpDir, `dump-${randomUUID()}.txt`);
  try {
    const res = await ctx.backend.exec(sessionId, [
      `wvDumpSignalListToFile -win ${windowId} -${kind} -delim / -file ${tclQuote(file)}`,
    ]);
    const first = res.results[0];
    if (!first || !first.ok) {
      throw new AppError("backend_error", "wvDumpSignalListToFile failed", { result: first?.result });
    }
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean);
  } finally {
    rmSync(file, { force: true });
  }
}

export async function guiValue(
  ctx: ToolContext,
  sessionId: string,
  windowId: string,
  signal: string,
  ticks: number | undefined,
  format: string,
  leadingZeros: boolean,
): Promise<string> {
  const command =
    ticks === undefined
      ? `wvGetCurValueString -win ${windowId} -delim / ${tclQuote(signal)}`
      : `wvGetSigValueByTime -win ${windowId} -delim / ${tclQuote(signal)} -format ${format} ${
          leadingZeros ? "-lz " : ""
        }-time ${ticks}`;
  const res = await ctx.backend.exec(sessionId, [command]);
  const first = res.results[0];
  if (!first || !first.ok) {
    throw new AppError("backend_error", "signal value query failed", {
      command,
      result: first?.result,
    });
  }
  return first.result.trim();
}

export function registerValues(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_value_get",
    {
      title: "Get signal value",
      description:
        "Read one signal value at a time (GUI wvGetSigValueByTime). The signal must already be added to the target nWave window. X/Z are preserved as strings; leading zeros are kept by default.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signal: z.string().min(1),
        time: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        format: z.enum(["Hex", "Bin", "Oct", "Ascii", "UDec", "2Com", "1Com", "SMag"]).optional(),
        leading_zeros: z.boolean().optional(),
      },
    },
    async (args) =>
      runTool("verdi_value_get", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const unit = await windowUnit(ctx, session.id, windowId);
        const outUnit = args.unit ?? unit;
        const ticks = args.time === undefined ? undefined : convertTime(args.time, outUnit, unit);
        const value = await guiValue(
          ctx,
          session.id,
          windowId,
          args.signal,
          ticks,
          args.format ?? "Hex",
          args.leading_zeros ?? true,
        );
        if (!value || value === "(null)") {
          throw new AppError("not_supported", "signal is not in the window or has no value", {
            signal: args.signal,
            hint: "call verdi_signals_add first",
          });
        }
        return {
          signal: args.signal,
          time: args.time ?? null,
          value,
          unit: outUnit,
          source: "gui",
        };
      }),
  );

  server.registerTool(
    "verdi_transitions_get",
    {
      title: "Get signal transitions",
      description:
        "List value changes of one signal in a time range. Two engines exist: `npi` (exact, returns every transition, needs an FSDB) and `gui` (wvSearchNextBySignal; cheaper to start but skips glitches). engine=auto picks NPI when max > 200 and an FSDB is known. The chosen engine is always reported in data.engine.used with a reason; pass engine=\"gui\" or engine=\"npi\" to force one (an explicit engine is never silently swapped, and a failure returns a hint). data.fsdb carries max_time and is_completed so you can tell whether the FSDB is still being written; data.engine.switch_hint appears only when the call exceeded 15 s and the other engine is available. Times are returned in the requested unit.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signal: z.string().min(1),
        start: z.number().optional(),
        end: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        max: z.number().int().min(1).max(100_000).optional(),
        with_values: z.boolean().optional(),
        engine: z.enum(["auto", "gui", "npi"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_transitions_get", async () => {
        const startedAt = performance.now();
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const unit = await windowUnit(ctx, session.id, windowId);
        const outUnit = args.unit ?? unit;
        const max = args.max ?? 1000;
        const engineRequest = args.engine ?? "auto";
        const start = args.start ?? 0;
        const end = args.end;
        const fsdb = fsdbFor(session, undefined);
        const npiUsable = fsdb !== null;
        const autoPicksNpi = max > TRANSITIONS_NPI_MIN_MAX && npiUsable;

        let fallback = false;
        let npiFailure: string | null = null;

        if (engineRequest === "npi" || (engineRequest === "auto" && autoPicksNpi)) {
          if (!npiUsable) {
            throw new AppError("not_supported", "NPI requires an FSDB path; call verdi_fsdb_open first", {
              hint: 'retry with engine="gui"',
            });
          }
          try {
            const data = await runNpi({
              action: "transitions",
              fsdb,
              signal: toNpiName(args.signal),
              start: { value: start, unit: outUnit },
              end: end === undefined ? undefined : { value: end, unit: outUnit },
              max,
              format: "Hex",
            });
            const state = fsdbStateFrom(data);
            const fsdbUnit = fsdbUnitOf(state, outUnit);
            const rows = (data.transitions as Array<{ time_ticks: number; value: string }>) ?? [];
            return {
              signal: args.signal,
              transitions: rows.map((row) => ({
                time: convertTime(row.time_ticks, fsdbUnit, outUnit),
                value: row.value,
              })),
              truncated: Boolean(data.truncated),
              source: "npi",
              unit: outUnit,
              engine: buildEngine({
                requested: engineRequest,
                used: "npi",
                reason:
                  engineRequest === "npi"
                    ? "explicit engine=npi"
                    : `auto: NPI (max=${max} > ${TRANSITIONS_NPI_MIN_MAX}, fsdb known)`,
                startedAt,
                alternatives: ["gui"],
              }),
              fsdb: buildFsdb({ path: fsdb, state, fsdbUnit, outUnit, end }),
            };
          } catch (err) {
            if (engineRequest === "npi") throw withSwitchHint(err);
            fallback = true;
            npiFailure = err instanceof Error ? err.message : String(err);
          }
        }

        const startTicks = convertTime(start, outUnit, unit);
        const endTicks = end === undefined ? undefined : convertTime(end, outUnit, unit);
        let cursor = startTicks;
        const times: number[] = [];
        let truncated = false;
        let guard = 0;
        const guardLimit = max * 4 + 100;
        while (times.length < max && guard < guardLimit) {
          guard++;
          const res = await ctx.backend.exec(session.id, [
            `wvSearchNextBySignal -win ${windowId} -delim / ${tclQuote(args.signal)} -time ${cursor}`,
          ]);
          const first = res.results[0];
          if (!first || !first.ok) {
            throw new AppError("backend_error", "wvSearchNextBySignal failed", {
              result: first?.result,
            });
          }
          const match = /^1\s+(-?\d+)/.exec(first.result.trim());
          if (!match) break;
          const next = Number(match[1]);
          if (endTicks !== undefined && next > endTicks) break;
          if (next <= cursor) {
            cursor += 1;
            continue;
          }
          times.push(next);
          cursor = next;
        }
        if (times.length >= max) truncated = true;

        let values: string[] | undefined;
        let valuesTruncated = false;
        if (args.with_values) {
          const limit = Math.min(times.length, 50);
          values = [];
          for (let i = 0; i < limit; i++) {
            values.push(
              await guiValue(ctx, session.id, windowId, args.signal, times[i], "Hex", true),
            );
          }
          valuesTruncated = times.length > limit;
        }

        const guiReason = fallback
          ? `auto: GUI (npi failed: ${npiFailure ?? "unknown error"})`
          : engineRequest === "gui"
            ? "explicit engine=gui"
            : npiUsable
              ? `auto: GUI (max=${max} <= ${TRANSITIONS_NPI_MIN_MAX})`
              : "auto: GUI (npi unavailable: no fsdb)";
        const info = fsdb === null ? { state: null, error: null } : await readFsdbState(fsdb);

        return {
          signal: args.signal,
          transitions: times.map((ticks, index) => ({
            time: convertTime(ticks, unit, outUnit),
            ...(values ? { value: values[index] } : {}),
          })),
          truncated,
          values_truncated: valuesTruncated,
          source: "gui",
          unit: outUnit,
          engine: buildEngine({
            requested: engineRequest,
            used: "gui",
            reason: withSuffix(
              guiReason,
              info.error === null ? null : `fsdb state unavailable: ${info.error}`,
            ),
            startedAt,
            alternatives: npiUsable ? ["npi"] : [],
            fallback,
          }),
          fsdb:
            fsdb === null
              ? null
              : buildFsdb({
                  path: fsdb,
                  state: info.state,
                  fsdbUnit: fsdbUnitOf(info.state, outUnit),
                  outUnit,
                  end,
                }),
        };
      }),
  );

  server.registerTool(
    "verdi_xz_scan",
    {
      title: "Scan signals for X/Z",
      description:
        "Scan one or more signals (or every signal under a scope) for X/Z values in a time range. Two engines exist: `npi` (FSDB reader; enumerates real transitions) and `gui` (budgeted sampling, degraded). engine=auto picks NPI whenever an FSDB is known. The chosen engine is reported in data.engine.used with a reason; pass engine=\"gui\" or engine=\"npi\" to force one (an explicit engine is never silently swapped, and a failure returns a hint). data.fsdb carries max_time and is_completed so you can tell whether the FSDB is still being written; data.engine.switch_hint appears only when the call exceeded 15 s and the other engine is available. Returns candidate {signal,time,value} entries and a truncated flag.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        fsdb: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1).optional(),
        scope: z.string().min(1).optional(),
        start: z.number().optional(),
        end: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        max: z.number().int().min(1).max(100_000).optional(),
        engine: z.enum(["auto", "gui", "npi"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_xz_scan", async () => {
        const startedAt = performance.now();
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const unit = await windowUnit(ctx, session.id, windowId);
        const outUnit = args.unit ?? unit;
        const max = args.max ?? 100;
        const engineRequest = args.engine ?? "auto";
        const start = args.start ?? 0;
        const end = args.end;
        const fsdb = fsdbFor(session, args.fsdb);
        const npiUsable = fsdb !== null;

        let signals = args.signals ?? [];
        if (signals.length === 0 && args.scope) {
          const all = await dumpSignals(ctx, session.id, windowId, "signal");
          const prefix = args.scope.replace(/\/+$/, "") + "/";
          signals = all.filter((name) => name === args.scope || name.startsWith(prefix));
        }
        if (signals.length === 0) {
          throw new AppError("invalid_argument", "provide signals or a scope with at least one signal");
        }
        signals = signals.slice(0, 100);

        let fallback = false;
        let npiFailure: string | null = null;

        if (engineRequest === "npi" || (engineRequest === "auto" && npiUsable)) {
          if (!npiUsable) {
            throw new AppError("not_supported", "NPI requires an FSDB path; call verdi_fsdb_open first", {
              hint: 'retry with engine="gui"',
            });
          }
          try {
            const data = await runNpi({
              action: "xz_scan",
              fsdb,
              signals: signals.map(toNpiName),
              start: { value: start, unit: outUnit },
              end: end === undefined ? undefined : { value: end, unit: outUnit },
              max,
              format: "Hex",
            });
            const state = fsdbStateFrom(data);
            const fsdbUnit = fsdbUnitOf(state, outUnit);
            const rows = (data.candidates as Array<{ signal: string; time_ticks: number; value: string }>) ?? [];
            return {
              candidates: rows.map((row) => ({
                signal: row.signal,
                time: convertTime(row.time_ticks, fsdbUnit, outUnit),
                value: row.value,
              })),
              truncated: Boolean(data.truncated),
              source: "npi",
              unit: outUnit,
              signals_scanned: signals.length,
              engine: buildEngine({
                requested: engineRequest,
                used: "npi",
                reason:
                  engineRequest === "npi"
                    ? "explicit engine=npi"
                    : `auto: NPI (fsdb known, ${signals.length} signals)`,
                startedAt,
                alternatives: ["gui"],
              }),
              fsdb: buildFsdb({ path: fsdb, state, fsdbUnit, outUnit, end }),
            };
          } catch (err) {
            if (engineRequest === "npi") throw withSwitchHint(err);
            fallback = true;
            npiFailure = err instanceof Error ? err.message : String(err);
          }
        }

        const startTicks = convertTime(start, outUnit, unit);
        const endTicks = end === undefined ? undefined : convertTime(end, outUnit, unit);
        const span = endTicks === undefined ? 1_000 : Math.max(1, endTicks - startTicks);
        const steps = Math.min(max, 50);
        const step = Math.max(1, Math.floor(span / steps));
        const candidates: Array<{ signal: string; time: number; value: string }> = [];
        let truncated = false;
        let queries = 0;
        const budget = max * 2;
        outer: for (const signal of signals.slice(0, 20)) {
          for (let t = startTicks; endTicks === undefined || t <= endTicks; t += step) {
            if (queries >= budget) {
              truncated = true;
              break outer;
            }
            queries++;
            const value = await guiValue(ctx, session.id, windowId, signal, t, "Hex", true);
            if (/[xz]/i.test(value)) {
              if (candidates.length >= max) {
                truncated = true;
                break outer;
              }
              candidates.push({ signal, time: convertTime(t, unit, outUnit), value });
            }
          }
        }

        const guiReason = fallback
          ? `auto: GUI (npi failed: ${npiFailure ?? "unknown error"})`
          : engineRequest === "gui"
            ? "explicit engine=gui"
            : "auto: GUI (npi unavailable: no fsdb)";
        const info = fsdb === null ? { state: null, error: null } : await readFsdbState(fsdb);

        return {
          candidates,
          truncated,
          source: "gui",
          degraded: true,
          unit: outUnit,
          signals_scanned: Math.min(signals.length, 20),
          engine: buildEngine({
            requested: engineRequest,
            used: "gui",
            reason: withSuffix(
              guiReason,
              info.error === null ? null : `fsdb state unavailable: ${info.error}`,
            ),
            startedAt,
            alternatives: npiUsable ? ["npi"] : [],
            fallback,
          }),
          fsdb:
            fsdb === null
              ? null
              : buildFsdb({
                  path: fsdb,
                  state: info.state,
                  fsdbUnit: fsdbUnitOf(info.state, outUnit),
                  outUnit,
                  end,
                }),
        };
      }),
  );
}
