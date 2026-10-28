import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { AppError, envelopeError, envelopeOk, runTool, textResult } from "../errors.js";

async function allWindows(ctx: ToolContext, sessionId: string): Promise<string[]> {
  const res = await ctx.backend.exec(sessionId, ["wvGetAllWindows"]);
  const first = res.results[0];
  if (!first || !first.ok) {
    throw new AppError("window_not_found", "wvGetAllWindows failed", {
      result: first?.result,
    });
  }
  return first.result.trim().split(/\s+/).filter(Boolean);
}

async function xidFor(ctx: ToolContext, sessionId: string, windowId: string): Promise<string> {
  const res = await ctx.backend.exec(sessionId, [`wvGetXWindowId -id ${windowId}`]);
  const first = res.results[0];
  if (!first || !first.ok || !first.result.trim()) {
    throw new AppError("window_not_found", `no X window id for window ${windowId}`, {
      result: first?.result,
    });
  }
  const raw = first.result.trim().replace(/^0x/i, "");
  return `0x${raw}`;
}

async function firstWindow(ctx: ToolContext, sessionId: string): Promise<string> {
  const windows = await allWindows(ctx, sessionId);
  if (windows.length === 0) {
    throw new AppError("window_not_found", "no nWave window in this session");
  }
  return windows[0];
}

export function registerWindows(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_windows_list",
    {
      title: "List nWave windows",
      description:
        "List nWave windows in a session and their X window ids. If session_id is omitted, the only running session is used.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_windows_list", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const ids = await allWindows(ctx, session.id);
        const windows = [];
        for (const window_id of ids) {
          let xid: string | undefined;
          try {
            xid = await xidFor(ctx, session.id, window_id);
          } catch {
            xid = undefined;
          }
          windows.push({ window_id, xid, kind: "nwave" as const });
        }
        return { windows };
      }),
  );

  server.registerTool(
    "verdi_window_create",
    {
      title: "Create nWave window",
      description:
        "Create a new nWave window in the target session. This changes the Verdi GUI; pass session_id when more than one session is running.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_window_create", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const res = await ctx.backend.exec(session.id, ["wvCreateWindow"]);
        const first = res.results[0];
        if (!first || !first.ok || !first.result.trim()) {
          throw new AppError("backend_error", "wvCreateWindow failed", {
            result: first?.result,
          });
        }
        const window_id = first.result.trim();
        const xid = await xidFor(ctx, session.id, window_id);
        return { window_id, xid };
      }),
  );

  server.registerTool(
    "verdi_window_raise",
    {
      title: "Raise an nWave window",
      description:
        "Raise one nWave window to the top of the X stacking order (wvRaiseWindow). Useful before a screenshot when several windows overlap. This changes window focus, not waveform content.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_window_raise", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const res = await ctx.backend.exec(session.id, [`wvRaiseWindow -win ${windowId}`]);
        const first = res.results[0];
        if (!first || !first.ok) {
          throw new AppError("backend_error", "wvRaiseWindow failed", { result: first?.result });
        }
        const xid = await xidFor(ctx, session.id, windowId);
        return { window_id: windowId, xid, raised: true };
      }),
  );

  server.registerTool(
    "verdi_window_screenshot",
    {
      title: "Screenshot nWave window",
      description:
        "Capture a PNG of one nWave window. Saves the file under ~/.local/state/verdi-mcp/screenshots and returns its path, size, dimensions and sha256. By default also returns the PNG as MCP image content when it is at most 2 MB.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1),
        inline: z.boolean().optional(),
      },
    },
    async (args) => {
      const started = performance.now();
      try {
        const session = await ctx.backend.resolveSession(args.session_id);
        const shot = await ctx.backend.screenshot(session.id, args.window_id);
        const envelope = envelopeOk("verdi_window_screenshot", shot, {
          sid: session.id,
          elapsed_ms: Math.round(performance.now() - started),
        });
        const content: Array<
          { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: JSON.stringify(envelope) }];
        if (args.inline !== false && shot.bytes <= 2 * 1024 * 1024) {
          const data = await Bun.file(shot.path).arrayBuffer();
          content.push({
            type: "image",
            data: Buffer.from(data).toString("base64"),
            mimeType: "image/png",
          });
        }
        return { content };
      } catch (err) {
        const envelope = envelopeError("verdi_window_screenshot", err);
        envelope.meta.elapsed_ms = Math.round(performance.now() - started);
        return textResult(envelope);
      }
    },
  );
}
