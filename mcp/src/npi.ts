import { dirname, join, resolve } from "node:path";
import { AppError, type ErrorCode } from "./errors.js";

export const NPI_IDLE_MS = Number(process.env.VERDI_MCP_NPI_IDLE_MS ?? 600_000);

export function npiEnv(): Record<string, string> {
  const verdiHome = process.env.VERDI_HOME;
  if (!verdiHome) {
    throw new AppError(
      "not_supported",
      "VERDI_HOME is not set; the NPI reader needs a Verdi installation",
      { hint: "export VERDI_HOME=<your verdi install> (and source your site EDA env) before starting the MCP server" },
    );
  }
  const ld = [
    join(verdiHome, "share/NPI/lib/linux64"),
    join(verdiHome, "platform/linux64/lib/Qt5/lib"),
    process.env.LD_LIBRARY_PATH,
  ]
    .filter((value): value is string => Boolean(value))
    .join(":");
  return {
    VERDI_HOME: verdiHome,
    PYTHONPATH: [join(verdiHome, "share/NPI/python"), process.env.PYTHONPATH]
      .filter((value): value is string => Boolean(value))
      .join(":"),
    LD_LIBRARY_PATH: ld,
  };
}

function workerPath(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), "../npi/npi_worker.py");
}

function pythonBin(): string {
  return Bun.which("python3") ?? "python3";
}

function parseResult(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.ok !== true) {
    const error = parsed.error as { code?: string; message?: string; details?: unknown } | undefined;
    throw new AppError(
      (error?.code as ErrorCode) ?? "backend_error",
      error?.message ?? "NPI query failed",
      error?.details,
    );
  }
  return (parsed.data as Record<string, unknown>) ?? {};
}

/** One-shot worker: pays npisys.init (~3 s) on every call. Used as a fallback. */
export async function runNpiOnce(
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({
    cmd: [pythonBin(), workerPath()],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...npiEnv() } as Record<string, string>,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
    await proc.stdin.end();
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    if (timedOut) {
      throw new AppError("timeout", `NPI worker timed out after ${timeoutMs} ms`);
    }
    let parsed: Record<string, unknown> | null = null;
    for (const line of stdout.split("\n")) {
      const text = line.trim();
      if (!text.startsWith("{")) continue;
      try {
        const candidate = JSON.parse(text) as Record<string, unknown>;
        if (candidate && typeof candidate === "object" && "ok" in candidate) parsed = candidate;
      } catch {
        // NPI prints banners and logs to stdout; ignore non-JSON lines.
      }
    }
    if (!parsed) {
      throw new AppError("backend_error", "NPI worker emitted no JSON result", {
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 2000),
      });
    }
    return parseResult(parsed);
  } finally {
    clearTimeout(timer);
  }
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Resident NPI reader: one python process per MCP server, FSDB handle kept open.
 * Requests are serialized; the process is stopped after NPI_IDLE_MS of silence.
 */
class ResidentNpi {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private fsdb: string | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private stderrTail = "";

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop(), NPI_IDLE_MS);
    this.idle.unref?.();
  }

  private stdinSink(proc: ReturnType<typeof Bun.spawn>): Bun.FileSink {
    const stdin = proc.stdin;
    if (typeof stdin === "number" || !stdin) {
      throw new AppError("backend_error", "NPI resident reader has no writable stdin");
    }
    return stdin;
  }

  private async ensure(fsdb: string): Promise<void> {
    if (this.proc && this.fsdb === fsdb) return;
    if (this.proc) await this.stop();
    this.stderrTail = "";
    const proc = Bun.spawn({
      cmd: [pythonBin(), workerPath(), "--serve"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...npiEnv() } as Record<string, string>,
    });
    this.proc = proc;
    this.fsdb = fsdb;
    void this.pump(proc);
    void this.drainStderr(proc);
    void proc.exited.then(() => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.fsdb = null;
      this.failAll(
        new AppError("backend_error", "NPI resident reader exited", {
          stderr: this.stderrTail.slice(-2000),
        }),
      );
    });
  }

  private async drainStderr(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      this.stderrTail = (this.stderrTail + decoder.decode(value, { stream: true })).slice(-4000);
    }
  }

  private async pump(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line.startsWith("{")) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const id = parsed._id;
        if (typeof id !== "number") continue;
        const pending = this.pending.get(id);
        if (!pending) continue;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        try {
          pending.resolve(parseResult(parsed));
        } catch (err) {
          pending.reject(err);
        }
      }
    }
  }

  private failAll(error: unknown): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async request(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const run = this.chain.then(() => this.send(payload, timeoutMs));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async send(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const fsdb = String(payload.fsdb ?? "");
    if (!fsdb) throw new AppError("invalid_argument", "fsdb is required for NPI queries");
    await this.ensure(fsdb);
    this.armIdle();
    const proc = this.proc;
    if (!proc) throw new AppError("backend_error", "NPI resident reader is not running");

    const id = this.nextId++;
    const promise = new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError("timeout", `NPI query timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
    });
    const stdin = this.stdinSink(proc);
    stdin.write(`${JSON.stringify({ ...payload, _id: id })}\n`);
    await stdin.flush();
    return promise;
  }

  async stop(): Promise<void> {
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.fsdb = null;
    try {
      const stdin = this.stdinSink(proc);
      stdin.write(`${JSON.stringify({ action: "close" })}\n`);
      await stdin.flush();
    } catch {
      // Pipe already gone.
    }
    const timer = setTimeout(() => proc.kill(), 2000);
    await proc.exited;
    clearTimeout(timer);
    this.failAll(new AppError("backend_error", "NPI resident reader stopped"));
  }
}

const resident = new ResidentNpi();

/**
 * Run an NPI query. Uses the resident reader by default (keeps npisys.init and
 * the FSDB handle warm) and falls back to a one-shot worker on transport errors.
 */
export async function runNpi(
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  if (process.env.VERDI_MCP_NPI_RESIDENT === "0") {
    return runNpiOnce(payload, timeoutMs);
  }
  try {
    return await resident.request(payload, timeoutMs);
  } catch (err) {
    // Query-level errors (not_supported / invalid_argument) are real answers.
    if (err instanceof AppError && err.code !== "backend_error" && err.code !== "timeout") {
      throw err;
    }
    if (err instanceof AppError && err.code === "timeout") throw err;
    return runNpiOnce(payload, timeoutMs);
  }
}

export async function shutdownNpi(): Promise<void> {
  await resident.stop();
}

// Never leave an NPI reader behind when the MCP server exits.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdownNpi().finally(() => process.exit(0));
  });
}
process.on("exit", () => {
  void resident.stop();
});
