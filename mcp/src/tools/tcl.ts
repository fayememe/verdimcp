import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";

/**
 * Escape hatch for Verdi Tcl commands that the typed tools do not cover.
 * Disabled unless VERDI_ALLOW_RAW=1: Tcl in nWave can exec arbitrary
 * processes, so this is an operator decision, not an agent default.
 */
export function registerTcl(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_tcl_exec",
    {
      title: "Run raw Verdi Tcl (disabled by default)",
      description:
        "Escape hatch: evaluate up to 20 raw Tcl commands in the target Verdi session, one result each. Disabled unless the MCP server was started with VERDI_ALLOW_RAW=1, because Tcl can exec arbitrary processes. Every command is written to ~/.local/state/verdimcp/audit.jsonl. Prefer the typed tools.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        commands: z.array(z.string().min(1).max(4000)).min(1).max(20),
      },
    },
    async (args) =>
      runTool("verdi_tcl_exec", async () => {
        if (process.env.VERDI_ALLOW_RAW !== "1") {
          throw new AppError("not_supported", "raw Tcl is disabled", {
            hint: "start the MCP server with VERDI_ALLOW_RAW=1 to enable verdi_tcl_exec",
          });
        }
        for (const command of args.commands) {
          if (command.includes("\n") || command.includes("\r")) {
            throw new AppError("invalid_argument", "commands must be single-line");
          }
        }
        const session = await ctx.backend.resolveSession(args.session_id);
        const res = await ctx.backend.exec(session.id, args.commands, { timeoutMs: 120_000 });
        return {
          results: res.results.map((entry) => ({
            command: entry.command,
            ok: entry.ok,
            result: entry.result,
          })),
          events: res.events,
        };
      }),
  );
}
