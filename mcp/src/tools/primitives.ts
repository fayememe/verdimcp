import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionEntry, ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { convertTime, parseUnit, type TimeUnit } from "../time.js";
import { tclQuote } from "./waveform.js";
import { dumpSignals, firstWindow, fsdbFor, runNpi, toNpiName, windowUnit } from "./values.js";

const stateDir = join(homedir(), ".local/state/verdi-mcp");
const mapPath = join(stateDir, "signal-maps.json");
const checkPath = join(stateDir, "checks.json");

interface SignalMap {
  name: string;
  signals: Record<string, string>;
  created_by: string;
  updated_at: string;
}

interface DeclarativeCheck {
  check_id: string;
  name: string;
  predicate: string;
  params: Record<string, unknown>;
  created_at: string;
  last_run?: string;
  result?: unknown;
}

interface NpiTransition {
  time_ticks: number;
  value: string;
}

interface NpiValueRow {
  signal: string;
  time_ticks: number;
  value: string;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function loadMaps(): SignalMap[] {
  const value = loadJson<unknown>(mapPath, []);
  return Array.isArray(value) ? (value as SignalMap[]) : [];
}

function loadChecks(): DeclarativeCheck[] {
  const value = loadJson<unknown>(checkPath, []);
  return Array.isArray(value) ? (value as DeclarativeCheck[]) : [];
}

function isHigh(value: string | undefined): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  if (text === "1" || text === "true") return true;
  if (text === "0" || text === "false") return false;
  return !/[xz]/.test(text);
}

async function npiTransitions(
  fsdb: string,
  signal: string,
  start: number,
  end: number | undefined,
  unit: TimeUnit,
  max = 5000,
): Promise<Array<{ time: number; value: string }>> {
  const data = await runNpi({
    action: "transitions",
    fsdb,
    signal: toNpiName(signal),
    start: { value: start, unit },
    end: end === undefined ? undefined : { value: end, unit },
    max,
    format: "Hex",
  });
  const fsdbUnit = parseUnit(String(data.scale_unit ?? "")) ?? unit;
  const rows = (data.transitions as NpiTransition[] | undefined) ?? [];
  return rows.map((row) => ({
    time: convertTime(row.time_ticks, fsdbUnit, unit),
    value: String(row.value),
  }));
}

export async function npiValues(
  fsdb: string,
  signals: string[],
  times: number[],
  unit: TimeUnit,
  format = "Hex",
): Promise<string[][]> {
  if (signals.length === 0 || times.length === 0) return [];
  const data = await runNpi({
    action: "values",
    fsdb,
    signals: signals.map(toNpiName),
    times: times.map((value) => ({ value, unit })),
    format,
  });
  const fsdbUnit = parseUnit(String(data.scale_unit ?? "")) ?? unit;
  const rows = (data.values as NpiValueRow[] | undefined) ?? [];
  const out: string[][] = [];
  for (let signalIndex = 0; signalIndex < signals.length; signalIndex++) {
    const row: string[] = [];
    for (let timeIndex = 0; timeIndex < times.length; timeIndex++) {
      const entry = rows[signalIndex * times.length + timeIndex];
      row.push(entry ? String(entry.value) : "");
    }
    out.push(row);
  }
  return out;
}

type Expr =
  | { kind: "id"; name: string }
  | { kind: "not"; expr: Expr }
  | { kind: "and"; left: Expr; right: Expr }
  | { kind: "or"; left: Expr; right: Expr };

function parsePredicate(input: string): { expr: Expr; identifiers: string[] } {
  const tokens = input.match(/&&|\|\||!|\(|\)|[^\s&|!()]+/g) ?? [];
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  const parseOr = (): Expr => {
    let left = parseAnd();
    while (peek() === "||") {
      take();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Expr => {
    let left = parseUnary();
    while (peek() === "&&") {
      take();
      left = { kind: "and", left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Expr => {
    if (peek() === "!") {
      take();
      return { kind: "not", expr: parseUnary() };
    }
    if (peek() === "(") {
      take();
      const expr = parseOr();
      if (take() !== ")") throw new AppError("invalid_argument", "unbalanced parentheses");
      return expr;
    }
    const token = take();
    if (!token || token === ")" || token === "&&" || token === "||") {
      throw new AppError("invalid_argument", `unexpected token in predicate: ${token ?? "end"}`);
    }
    return { kind: "id", name: token };
  };

  if (tokens.length === 0) throw new AppError("invalid_argument", "empty predicate");
  const expr = parseOr();
  if (index !== tokens.length) throw new AppError("invalid_argument", "trailing tokens in predicate");
  const identifiers = new Set<string>();
  const walk = (node: Expr): void => {
    if (node.kind === "id") identifiers.add(node.name);
    else if (node.kind === "not") walk(node.expr);
    else {
      walk(node.left);
      walk(node.right);
    }
  };
  walk(expr);
  return { expr, identifiers: [...identifiers] };
}

function evalPredicate(expr: Expr, values: Map<string, string>): boolean {
  switch (expr.kind) {
    case "id":
      return isHigh(values.get(expr.name));
    case "not":
      return !evalPredicate(expr.expr, values);
    case "and":
      return evalPredicate(expr.left, values) && evalPredicate(expr.right, values);
    case "or":
      return evalPredicate(expr.left, values) || evalPredicate(expr.right, values);
  }
}

interface ScanParams {
  start: number;
  end: number;
  unit: TimeUnit;
  bins: number;
  max: number;
  min_duration: number;
}

async function scanWindow(
  ctx: ToolContext,
  session: SessionEntry,
  predicate: string,
  params: ScanParams,
) {
  const fsdb = fsdbFor(session);
  if (!fsdb) {
    throw new AppError("not_supported", "window_scan requires an FSDB; call verdi_fsdb_open first");
  }
  const { expr, identifiers } = parsePredicate(predicate);
  const bins = Math.max(2, Math.min(params.bins, 5000));
  const step = (params.end - params.start) / (bins - 1);
  const times = Array.from({ length: bins }, (_, i) => params.start + i * step);
  const columns = await npiValues(fsdb, identifiers, times, params.unit);
  const hits: Array<{ time: number; values: Record<string, string> }> = [];
  let truncated = false;
  let runStart: number | null = null;
  for (let i = 0; i < bins; i++) {
    const values = new Map<string, string>();
    identifiers.forEach((name, signalIndex) => values.set(name, columns[signalIndex]?.[i] ?? ""));
    const matched = evalPredicate(expr, values);
    if (!matched) {
      runStart = null;
      continue;
    }
    if (runStart === null) runStart = times[i];
    if (params.min_duration > 0 && times[i] - runStart < params.min_duration) continue;
    if (hits.length >= params.max) {
      truncated = true;
      break;
    }
    hits.push({ time: times[i], values: Object.fromEntries(values) });
    runStart = null;
  }
  return {
    predicate,
    hits,
    truncated,
    bins,
    step,
    source: "npi",
  };
}

function checkParamsSchema() {
  return z.object({
    session_id: z.string().min(1).optional(),
    window_id: z.string().min(1).optional(),
    start: z.number().optional(),
    end: z.number(),
    unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
    bins: z.number().int().min(2).max(5000).optional(),
    max: z.number().int().min(1).max(10_000).optional(),
    min_duration: z.number().min(0).optional(),
  });
}

export function registerPrimitives(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_signal_map_put",
    {
      title: "Save signal map",
      description:
        "Persist a protocol-agnostic role→signal-path profile (e.g. valid, ready, data). The server stores no protocol semantics; roles are free-form strings chosen by the agent.",
      inputSchema: {
        name: z.string().min(1),
        signals: z.record(z.string().min(1), z.string().min(1)),
      },
    },
    async (args) =>
      runTool("verdi_signal_map_put", async () => {
        const maps = loadMaps();
        const profile: SignalMap = {
          name: args.name,
          signals: args.signals,
          created_by: process.env.USER ?? "unknown",
          updated_at: new Date().toISOString(),
        };
        const next = maps.filter((map) => map.name !== args.name);
        next.push(profile);
        saveJson(mapPath, next);
        return { name: profile.name, signals: profile.signals };
      }),
  );

  server.registerTool(
    "verdi_signal_map_get",
    {
      title: "Get signal map",
      description: "Return a saved role→signal-path profile by name.",
      inputSchema: { name: z.string().min(1) },
    },
    async (args) =>
      runTool("verdi_signal_map_get", async () => {
        const profile = loadMaps().find((map) => map.name === args.name);
        if (!profile) throw new AppError("not_supported", `signal map not found: ${args.name}`);
        return profile;
      }),
  );

  server.registerTool(
    "verdi_signal_map_list",
    {
      title: "List signal maps",
      description: "List saved role→signal-path profiles.",
      inputSchema: {},
    },
    async () => runTool("verdi_signal_map_list", async () => ({ profiles: loadMaps() })),
  );

  server.registerTool(
    "verdi_handshake_beats",
    {
      title: "Extract handshake beats",
      description:
        "Given a free-form channel (clock?, valid, ready, data roles), return every sampled cycle where valid and ready are both high, with the data/id/strobe/last values. This primitive knows nothing about any protocol; the role names are supplied by the caller.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        channel: z.object({
          name: z.string().optional(),
          clock: z.string().min(1).optional(),
          valid: z.string().min(1),
          ready: z.string().min(1),
          data: z.array(z.string().min(1)).optional(),
          id: z.string().min(1).optional(),
          strobe: z.string().min(1).optional(),
          last: z.string().min(1).optional(),
        }),
        start: z.number().optional(),
        end: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        max: z.number().int().min(1).max(10_000).optional(),
      },
    },
    async (args) =>
      runTool("verdi_handshake_beats", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const unit = args.unit ?? (await windowUnit(ctx, session.id, args.window_id ?? (await firstWindow(ctx, session.id))));
        const fsdb = fsdbFor(session);
        if (!fsdb) throw new AppError("not_supported", "handshake_beats requires an FSDB");
        const start = args.start ?? 0;
        const max = args.max ?? 1000;
        const channel = args.channel;

        let times: number[] = [];
        if (channel.clock) {
          const edges = await npiTransitions(fsdb, channel.clock, start, args.end, unit, Math.max(max * 4, 1000));
          times = edges.filter((edge) => isHigh(edge.value)).map((edge) => edge.time);
        } else {
          const [validChanges, readyChanges] = await Promise.all([
            npiTransitions(fsdb, channel.valid, start, args.end, unit, Math.max(max * 4, 1000)),
            npiTransitions(fsdb, channel.ready, start, args.end, unit, Math.max(max * 4, 1000)),
          ]);
          times = [...new Set([...validChanges, ...readyChanges].map((edge) => edge.time))].sort((a, b) => a - b);
        }
        if (times.length === 0) return { channel: channel.name ?? "channel", beats: [], truncated: false, source: "npi" };
        const selected = times.slice(0, max * 4);
        const roles = [channel.valid, channel.ready, ...(channel.data ?? []), channel.id, channel.strobe, channel.last].filter(
          (role): role is string => Boolean(role),
        );
        const columns = await npiValues(fsdb, roles, selected, unit);
        const valueAt = (role: string, index: number): string => columns[roles.indexOf(role)]?.[index] ?? "";
        const beats: Array<Record<string, unknown>> = [];
        let truncated = selected.length < times.length;
        for (let i = 0; i < selected.length; i++) {
          const valid = valueAt(channel.valid, i);
          const ready = valueAt(channel.ready, i);
          if (!isHigh(valid) || !isHigh(ready)) continue;
          if (beats.length >= max) {
            truncated = true;
            break;
          }
          const data: Record<string, string> = {};
          for (const role of channel.data ?? []) data[role] = valueAt(role, i);
          beats.push({
            time: selected[i],
            valid,
            ready,
            ...(Object.keys(data).length > 0 ? { data } : {}),
            ...(channel.id ? { id: valueAt(channel.id, i) } : {}),
            ...(channel.strobe ? { strobe: valueAt(channel.strobe, i) } : {}),
            ...(channel.last ? { last: valueAt(channel.last, i) } : {}),
          });
        }
        return { channel: channel.name ?? "channel", beats, truncated, source: "npi" };
      }),
  );

  server.registerTool(
    "verdi_change_stats",
    {
      title: "Aggregate signal changes",
      description:
        "Return per-signal change count and first/last values over a time range. Aggregate only; never returns the raw change stream.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1).max(256),
        start: z.number().optional(),
        end: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_change_stats", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const fsdb = fsdbFor(session);
        if (!fsdb) throw new AppError("not_supported", "change_stats requires an FSDB");
        const windowId = await firstWindow(ctx, session.id);
        const unit = args.unit ?? (await windowUnit(ctx, session.id, windowId));
        const data = await runNpi({
          action: "change_stats",
          fsdb,
          signals: args.signals.map(toNpiName),
          start: { value: args.start ?? 0, unit },
          end: args.end === undefined ? undefined : { value: args.end, unit },
          format: "Hex",
        });
        return { stats: data.stats ?? [], scale_unit: data.scale_unit ?? `1${unit}`, source: "npi" };
      }),
  );

  server.registerTool(
    "verdi_window_scan",
    {
      title: "Scan a time window with a predicate",
      description:
        "Evaluate a protocol-agnostic boolean predicate over signal values at sampled times. Supports identifiers, !, &&, || and parentheses; optionally require the predicate to hold for min_duration. Returns the first max hits.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        predicate: z.string().min(1),
        start: z.number().optional(),
        end: z.number(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        bins: z.number().int().min(2).max(5000).optional(),
        max: z.number().int().min(1).max(10_000).optional(),
        min_duration: z.number().min(0).optional(),
      },
    },
    async (args) =>
      runTool("verdi_window_scan", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = await firstWindow(ctx, session.id);
        const unit = args.unit ?? (await windowUnit(ctx, session.id, windowId));
        return scanWindow(ctx, session, args.predicate, {
          start: args.start ?? 0,
          end: args.end,
          unit,
          bins: args.bins ?? 1000,
          max: args.max ?? 100,
          min_duration: args.min_duration ?? 0,
        });
      }),
  );

  server.registerTool(
    "verdi_check_define",
    {
      title: "Define a declarative check",
      description:
        "Persist a protocol-agnostic predicate + scan parameters as a reusable check. The check is created from the debug session, not preloaded; verdi_check_run re-evaluates it deterministically.",
      inputSchema: {
        name: z.string().min(1),
        predicate: z.string().min(1),
        params: checkParamsSchema(),
      },
    },
    async (args) =>
      runTool("verdi_check_define", async () => {
        parsePredicate(args.predicate);
        const checks = loadChecks();
        const check: DeclarativeCheck = {
          check_id: randomUUID(),
          name: args.name,
          predicate: args.predicate,
          params: args.params,
          created_at: new Date().toISOString(),
        };
        checks.push(check);
        saveJson(checkPath, checks);
        return { check_id: check.check_id, name: check.name };
      }),
  );

  server.registerTool(
    "verdi_check_run",
    {
      title: "Run a declarative check",
      description: "Run a previously defined check against the current session/FSDB and return its hits.",
      inputSchema: { check_id: z.string().min(1) },
    },
    async (args) =>
      runTool("verdi_check_run", async () => {
        const checks = loadChecks();
        const check = checks.find((entry) => entry.check_id === args.check_id);
        if (!check) throw new AppError("not_supported", `check not found: ${args.check_id}`);
        const params = check.params as {
          session_id?: string;
          start?: number;
          end: number;
          unit?: "ps" | "ns" | "us" | "ms" | "s";
          bins?: number;
          max?: number;
          min_duration?: number;
        };
        const session = await ctx.backend.resolveSession(params.session_id);
        const unit = params.unit ?? (await windowUnit(ctx, session.id, await firstWindow(ctx, session.id)));
        const result = await scanWindow(ctx, session, check.predicate, {
          start: params.start ?? 0,
          end: params.end,
          unit,
          bins: params.bins ?? 1000,
          max: params.max ?? 100,
          min_duration: params.min_duration ?? 0,
        });
        check.last_run = new Date().toISOString();
        check.result = result;
        saveJson(checkPath, checks);
        return { check_id: check.check_id, name: check.name, result };
      }),
  );
}
