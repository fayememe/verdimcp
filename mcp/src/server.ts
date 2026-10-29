import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DefaultBackend } from "./backend.js";
import type { ToolContext } from "./context.js";
import { registerSessions } from "./tools/sessions.js";
import { registerWindows } from "./tools/windows.js";
import { registerWaveform } from "./tools/waveform.js";
import { registerValues } from "./tools/values.js";
import { registerDesign } from "./tools/design.js";
import { registerPrimitives } from "./tools/primitives.js";
import { registerEvidence } from "./tools/evidence.js";
import { registerTcl } from "./tools/tcl.js";
import { registerCone } from "./tools/cone.js";

const backend = new DefaultBackend();
const capabilities = await backend.capabilities();
const ctx: ToolContext = { backend, capabilities };

const server = new McpServer({
  name: "verdimcp",
  version: "0.1.0",
});

registerSessions(server, ctx);
registerWindows(server, ctx);
registerWaveform(server, ctx);
registerValues(server, ctx);
registerDesign(server, ctx);
registerPrimitives(server, ctx);
registerEvidence(server, ctx);
registerTcl(server, ctx);
registerCone(server, ctx);

await server.connect(new StdioServerTransport());
