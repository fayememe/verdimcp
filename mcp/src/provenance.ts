import { statSync } from "node:fs";
import { AppError } from "./errors.js";
import { runNpi } from "./npi.js";
import { convertTime, parseUnit, type TimeUnit } from "./time.js";

/**
 * Query provenance: which engine served the call, why, and whether the FSDB
 * covered the requested range. See docs/tools.md and docs/architecture.md.
 */

export type EngineName = "gui" | "npi";
export type EngineRequest = "auto" | EngineName;

/** A query slower than this gets a switch hint, but only if an alternative exists. */
export const SWITCH_HINT_MS = 15_000;

/** `verdi_transitions_get` auto-selects NPI above this transition budget. */
export const TRANSITIONS_NPI_MIN_MAX = 200;

/** Below this file size an incomplete FSDB whose max_time looks complete is suspicious. */
const BUFFERING_SUSPECT_BYTES = 1 << 20;

export interface EngineBlock {
  requested: EngineRequest;
  used: EngineName;
  reason: string;
  elapsed_ms: number;
  alternatives: EngineName[];
  fallback: boolean;
  switch_hint: string | null;
}

export interface FsdbBlock {
  path: string;
  max_time: number;
  is_completed: boolean;
  unit: TimeUnit;
  covers_requested_range: boolean;
  warning: string | null;
}

export interface FsdbState {
  scale_unit: string;
  max_time_ticks: number;
  max_time: number;
  is_completed: boolean;
}

export function switchHint(
  used: EngineName,
  elapsedMs: number,
  alternatives: EngineName[],
): string | null {
  if (elapsedMs < SWITCH_HINT_MS) return null;
  const other = alternatives.find((name) => name !== used);
  if (!other) return null;
  if (other === "gui") {
    return (
      `NPI took ${elapsedMs} ms. For wide/full-window views on a large FSDB the GUI capture path ` +
      `is usually faster (measured 9.7 s vs 26.4 s at 903 MB / 128 signals); pass engine="gui" to switch.`
    );
  }
  return (
    `GUI took ${elapsedMs} ms and samples instead of enumerating, so glitches are missed. ` +
    `NPI returns every transition; pass engine="npi" to switch.`
  );
}

export function buildEngine(input: {
  requested: EngineRequest;
  used: EngineName;
  reason: string;
  startedAt: number;
  alternatives: EngineName[];
  fallback?: boolean;
}): EngineBlock {
  const elapsed = Math.round(performance.now() - input.startedAt);
  return {
    requested: input.requested,
    used: input.used,
    reason: input.reason,
    elapsed_ms: elapsed,
    alternatives: input.alternatives,
    fallback: input.fallback ?? false,
    switch_hint: switchHint(input.used, elapsed, input.alternatives),
  };
}

/** Turn an explicit-engine failure into an error that names the escape hatch. */
export function withSwitchHint(err: unknown): AppError {
  const hint = 'retry with engine="gui"';
  if (err instanceof AppError) {
    const base =
      err.details && typeof err.details === "object"
        ? (err.details as Record<string, unknown>)
        : {};
    return new AppError(err.code, err.message, { ...base, hint });
  }
  return new AppError("backend_error", err instanceof Error ? err.message : String(err), { hint });
}

function fileBytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function buildFsdb(input: {
  path: string;
  state: FsdbState | null;
  fsdbUnit: TimeUnit;
  outUnit: TimeUnit;
  end?: number;
}): FsdbBlock | null {
  const { state } = input;
  if (!state) return null;
  const maxTicks = Number(state.max_time_ticks);
  if (!Number.isFinite(maxTicks)) return null;
  const completed = Boolean(state.is_completed);
  const maxTime = convertTime(maxTicks, input.fsdbUnit, input.outUnit);
  const covers = input.end === undefined ? true : input.end <= maxTime;
  const warnings: string[] = [];
  if (!completed) {
    warnings.push(
      `FSDB is still being written (is_completed=false); results only cover data up to ` +
        `max_time=${maxTime}${input.outUnit}. Absence of hits after max_time is not conclusive.`,
    );
  }
  if (!covers) {
    warnings.push(
      `requested end=${input.end}${input.outUnit} exceeds FSDB max_time=${maxTime}${input.outUnit}; ` +
        `results stop at max_time.`,
    );
  }
  if (!completed && covers) {
    const size = fileBytes(input.path);
    if (size !== null && size < BUFFERING_SUSPECT_BYTES) {
      warnings.push(
        `max_time is already at the full range while is_completed=false: VCS buffering without ` +
          `$fsdbDumpflush can make max_time look complete.`,
      );
    }
  }
  return {
    path: input.path,
    max_time: maxTime,
    is_completed: completed,
    unit: input.outUnit,
    covers_requested_range: covers,
    warning: warnings.length > 0 ? warnings.join("; ") : null,
  };
}

function isFsdbState(value: unknown): value is FsdbState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.max_time_ticks === "number" && typeof record.is_completed === "boolean";
}

/** Read FSDB state from a worker response without assuming it is present. */
export function fsdbStateFrom(data: Record<string, unknown>): FsdbState | null {
  const candidate = data.fsdb_state;
  return isFsdbState(candidate) ? candidate : null;
}

export function fsdbUnitOf(state: FsdbState | null, fallback: TimeUnit): TimeUnit {
  return parseUnit(state?.scale_unit ?? null) ?? fallback;
}

/**
 * Ask the reader for the current FSDB state. Best effort: a failure must not fail
 * the query, it only downgrades the `fsdb` block to null.
 */
export async function readFsdbState(
  fsdb: string,
): Promise<{ state: FsdbState | null; error: string | null }> {
  try {
    const data = await runNpi({ action: "info", fsdb });
    const state = fsdbStateFrom(data);
    if (state) return { state, error: null };
    return { state: null, error: "worker returned no fsdb_state" };
  } catch (err) {
    return { state: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function withSuffix(reason: string, suffix: string | null): string {
  return suffix ? `${reason}; ${suffix}` : reason;
}
