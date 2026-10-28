export type ErrorCode =
  | "session_not_found"
  | "ambiguous_session"
  | "session_down"
  | "window_not_found"
  | "not_supported"
  | "not_tested"
  | "timeout"
  | "busy"
  | "backend_error"
  | "invalid_argument";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ToolEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  meta: Record<string, unknown>;
}

export function envelopeOk(
  tool: string,
  data: unknown,
  meta: Record<string, unknown> = {},
): ToolEnvelope {
  return { ok: true, data, meta: { tool, ...meta } };
}

export function envelopeError(tool: string, err: unknown): ToolEnvelope {
  if (err instanceof AppError) {
    return {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
      meta: { tool },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    error: { code: "backend_error", message },
    meta: { tool },
  };
}

export function textResult(envelope: ToolEnvelope) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    ...(envelope.ok ? {} : { isError: true }),
  };
}

export async function runTool<T>(
  tool: string,
  fn: () => Promise<T>,
  map: (data: T) => unknown = (data) => data,
) {
  const started = performance.now();
  try {
    const data = await fn();
    return textResult(envelopeOk(tool, map(data), { elapsed_ms: Math.round(performance.now() - started) }));
  } catch (err) {
    const envelope = envelopeError(tool, err);
    envelope.meta.elapsed_ms = Math.round(performance.now() - started);
    return textResult(envelope);
  }
}
