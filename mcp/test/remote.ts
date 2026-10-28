import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Remote-mode smoke test: the MCP server runs behind an arbitrary stdio wrapper
 * (ssh, socat, docker exec, ...) given as argv JSON in MCP_REMOTE_JSON.
 * Proves the transport is stdout-clean: any banner or log line would break the
 * MCP handshake and fail here.
 */
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const evidenceDir = join(repoRoot, "poc/evidence/remote");
mkdirSync(evidenceDir, { recursive: true });
const logPath = join(evidenceDir, "remote.log");
const summaryPath = join(evidenceDir, "summary.json");

const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = [];
function check(name: string, passed: boolean, detail?: unknown): void {
  checks.push({ name, passed, detail });
  const line = `${passed ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`;
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
}

const raw = process.env.MCP_REMOTE_JSON;
if (!raw) {
  console.error("MCP_REMOTE_JSON is required (JSON array: [command, ...args])");
  process.exit(2);
}
const argv = JSON.parse(raw) as string[];
console.log(`remote argv: ${JSON.stringify(argv)}`);

const started = Date.now();
const transport = new StdioClientTransport({
  command: argv[0],
  args: argv.slice(1),
  stderr: "pipe",
});
const client = new Client({ name: "verdi-mcp-remote", version: "0.1.0" });
await client.connect(transport);
const connectMs = Date.now() - started;
check("remote.handshake", true, { connect_ms: connectMs });

const envelope = (result: unknown): Record<string, unknown> => {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("tool result has no text content");
  return JSON.parse(text) as Record<string, unknown>;
};

try {
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  check("remote.tools_listed", names.size >= 30, { count: names.size });
  check("remote.has_capabilities", names.has("verdi_capabilities"));
  check("remote.has_session_start", names.has("verdi_session_start"));

  const startedCall = Date.now();
  const caps = envelope(
    await client.callTool({ name: "verdi_capabilities", arguments: {} }),
  );
  check("remote.capabilities_ok", caps.ok === true, { call_ms: Date.now() - startedCall });
  const engines = (caps.data as { engines?: { gui?: boolean } } | undefined)?.engines;
  check("remote.gui_engine", engines?.gui === true);

  const sessions = envelope(
    await client.callTool({ name: "verdi_sessions_list", arguments: {} }),
  );
  check("remote.sessions_list_ok", sessions.ok === true, {
    count: ((sessions.data as { sessions?: unknown[] } | undefined)?.sessions ?? []).length,
  });
} finally {
  await client.close();
}

const ok = checks.every((entry) => entry.passed);
writeFileSync(
  summaryPath,
  `${JSON.stringify(
    { started: new Date().toISOString(), argv: argv.map((part) => (part.length > 200 ? "<trimmed>" : part)), checks, ok },
    null,
    2,
  )}\n`,
);
console.log(ok ? "REMOTE SMOKE PASSED" : "REMOTE SMOKE FAILED");
process.exit(ok ? 0 : 1);
