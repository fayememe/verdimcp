export interface SessionEntry {
  id: string;
  port: number;
  pid: number;
  uid?: number;
  host?: string;
  started?: string;
  cwd?: string;
  label?: string;
  verdi?: string;
  display?: string;
  cmd?: string[] | string;
  fsdb?: string[] | string;
  design?: string[] | string;
  status?: string;
  state: string;
}

export interface ExecResult {
  results: Array<{ command: string; ok: boolean; result: string }>;
  events: Array<{ event: string; data: string; cmd_index?: number }>;
  stderr: string;
  exitCode: number;
}

export interface ScreenshotResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  xid: string;
}

export type CapabilityStatus = "verified" | "documented" | "untested" | "not_implemented";

export interface CapabilityMatrix {
  verdi_home: string;
  engines: { gui: boolean; npi: boolean };
  tools: Array<{ name: string; status: CapabilityStatus; notes?: string }>;
}

export interface StartSessionOptions {
  label?: string;
  port?: number;
  cwd?: string;
  display?: string;
  timeoutSec?: number;
  fsdb?: string;
  design?: string[];
  top?: string;
  args?: string[];
}

export interface Backend {
  cliPath(): string;
  listSessions(): Promise<SessionEntry[]>;
  resolveSession(sessionId?: string): Promise<SessionEntry>;
  startSession(opts: StartSessionOptions): Promise<SessionEntry>;
  stopSession(sessionId: string): Promise<void>;
  exec(
    sessionId: string,
    commands: string[],
    opts?: { lockTimeoutSec?: number; timeoutMs?: number },
  ): Promise<ExecResult>;
  screenshot(sessionId: string, windowId: string): Promise<ScreenshotResult>;
}

export interface ToolContext {
  backend: Backend;
  capabilities: CapabilityMatrix;
}
