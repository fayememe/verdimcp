import { existsSync, statSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { assertAllowedPath } from "../paths.js";

function requireFile(path: string, extraRoots: Array<string | undefined>, label: string): string {
  const safe = assertAllowedPath(path, extraRoots);
  if (!existsSync(safe) || !statSync(safe).isFile()) {
    throw new AppError("invalid_argument", `${label} not found: ${path}`, { path: safe });
  }
  return safe;
}

export function registerSessions(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_capabilities",
    {
      title: "Verdi capabilities",
      description:
        "Return the static capability matrix (what is verified / documented / untested) and whether the GUI and NPI engines are available. Does not touch any Verdi session.",
      inputSchema: {},
    },
    async () => runTool("verdi_capabilities", async () => ctx.capabilities),
  );

  server.registerTool(
    "verdi_sessions_list",
    {
      title: "List Verdi sessions",
      description:
        "List Verdi sessions registered by verdi-session for the current user, including state up/down/stale, port, pid, label, cwd, FSDB and display.",
      inputSchema: {},
    },
    async () =>
      runTool("verdi_sessions_list", async () => ({
        sessions: await ctx.backend.listSessions(),
      })),
  );

  server.registerTool(
    "verdi_session_info",
    {
      title: "Verdi session info",
      description:
        "Return full information for one session. If session_id is omitted and exactly one session is up, that session is used; otherwise the call fails with session_not_found or ambiguous_session.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_session_info", async () =>
        ctx.backend.resolveSession(args.session_id),
      ),
  );

  server.registerTool(
    "verdi_session_start",
    {
      title: "Start a Verdi session",
      description:
        "Start a new detach-mode Verdi/nWave session with -serverPort and register it in the per-user registry. Only sessions started this way (or by verdi-session) are ever controllable; existing GUI processes are never attached. Returns the session id, port and pid. This launches a GUI window.",
      inputSchema: {
        label: z.string().min(1).max(64).optional(),
        fsdb: z.string().min(1).optional(),
        design: z.array(z.string().min(1)).min(1).max(16).optional(),
        top: z.string().min(1).optional(),
        args: z.array(z.string().min(1)).max(64).optional(),
        cwd: z.string().min(1).optional(),
        display: z.string().min(1).optional(),
        port: z.number().int().min(11000).max(11999).optional(),
        timeout_sec: z.number().int().min(30).max(600).optional(),
        settle_sec: z.number().int().min(0).max(180).optional(),
      },
    },
    async (args) =>
      runTool("verdi_session_start", async () => {
        const cwd = args.cwd
          ? assertAllowedPath(args.cwd)
          : process.env.VERDI_DEFAULT_CWD
            ? assertAllowedPath(process.env.VERDI_DEFAULT_CWD)
            : process.cwd();
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          throw new AppError("invalid_argument", `cwd is not a directory: ${cwd}`);
        }
        const fsdb = args.fsdb ? requireFile(args.fsdb, [cwd], "fsdb") : undefined;
        const design = (args.design ?? []).map((file) => requireFile(file, [cwd], "design file"));

        const entry = await ctx.backend.startSession({
          label: args.label,
          port: args.port,
          cwd,
          display: args.display,
          timeoutSec: args.timeout_sec,
          fsdb,
          design,
          top: args.top,
          args: args.args,
        });

        const settle = args.settle_sec ?? 0;
        if (settle > 0) await Bun.sleep(settle * 1000);

        return {
          session_id: entry.id,
          port: entry.port,
          pid: entry.pid,
          label: entry.label ?? "",
          cwd: entry.cwd ?? cwd,
          fsdb: entry.fsdb ?? null,
          design: entry.design ?? null,
          state: entry.state,
        };
      }),
  );

  server.registerTool(
    "verdi_session_stop",
    {
      title: "Stop a Verdi session",
      description:
        "Stop one Verdi session that is registered in this user's registry (SIGTERM, then SIGKILL after a grace period) and remove its registry entry. Refuses ids that are not in the registry, so other users' GUI processes can never be touched.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_session_stop", async () => {
        if (args.session_id && args.label) {
          throw new AppError("invalid_argument", "pass session_id or label, not both");
        }
        const sessions = await ctx.backend.listSessions();
        const candidates = sessions.filter((session) =>
          args.session_id ? session.id === args.session_id : session.label === args.label,
        );
        if (candidates.length === 0) {
          throw new AppError("session_not_found", "no matching session in this user's registry", {
            session_id: args.session_id ?? null,
            label: args.label ?? null,
          });
        }
        if (candidates.length > 1) {
          throw new AppError("ambiguous_session", "multiple sessions match; pass session_id", {
            candidates: candidates.map((session) => ({ id: session.id, label: session.label })),
          });
        }
        const target = candidates[0];
        await ctx.backend.stopSession(target.id);
        return { session_id: target.id, port: target.port, stopped: true };
      }),
  );
}
