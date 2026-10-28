import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const expected = [
  "verdi_capabilities",
  "verdi_sessions_list",
  "verdi_session_info",
  "verdi_windows_list",
  "verdi_window_create",
  "verdi_window_screenshot",
];

function fail(message: string): never {
  throw new Error(message);
}

function parseEnvelope(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") fail("tool result is not an object");
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((part) => part.type === "text")?.text;
  if (!text) fail("tool result has no text content");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") fail("tool envelope is not an object");
  return parsed as Record<string, unknown>;
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", "src/server.ts"],
    cwd: mcpRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "verdi-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);

  try {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of expected) {
      if (!names.has(name)) fail(`missing tool: ${name}`);
    }

    const caps = parseEnvelope(await client.callTool({ name: "verdi_capabilities", arguments: {} }));
    if (caps.ok !== true) fail(`verdi_capabilities failed: ${JSON.stringify(caps)}`);

    const sessions = parseEnvelope(
      await client.callTool({ name: "verdi_sessions_list", arguments: {} }),
    );
    if (sessions.ok !== true) fail(`verdi_sessions_list failed: ${JSON.stringify(sessions)}`);

    const info = parseEnvelope(
      await client.callTool({ name: "verdi_session_info", arguments: {} }),
    );
    if (info.ok !== false) {
      fail(`expected session_not_found/ambiguous_session with no session, got: ${JSON.stringify(info)}`);
    }
    const code = (info.error as { code?: string } | undefined)?.code;
    if (code !== "session_not_found") {
      fail(`expected session_not_found, got ${String(code)}`);
    }

    console.log("M1 SMOKE PASSED");
    console.log(`tools: ${[...names].sort().join(", ")}`);
    console.log(`sessions: ${JSON.stringify((sessions.data as { sessions?: unknown[] }).sessions ?? [])}`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(`M1 SMOKE FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
