export type TimeUnit = "ps" | "ns" | "us" | "ms" | "s";

const FACTOR: Record<TimeUnit, number> = {
  ps: 1,
  ns: 1_000,
  us: 1_000_000,
  ms: 1_000_000_000,
  s: 1_000_000_000_000,
};

export function parseUnit(raw: string | undefined | null): TimeUnit | null {
  if (!raw) return null;
  const m = /^1?\s*(ps|ns|us|ms|s)$/i.exec(raw.trim());
  return m ? (m[1].toLowerCase() as TimeUnit) : null;
}

export function convertTime(value: number, from: TimeUnit, to: TimeUnit): number {
  if (!Number.isFinite(value)) throw new Error(`invalid time: ${value}`);
  return Math.round((value * FACTOR[from]) / FACTOR[to]);
}

export function unitFromWindow(raw: string): TimeUnit {
  const unit = parseUnit(raw);
  if (!unit) throw new Error(`unsupported time unit: ${raw}`);
  return unit;
}
