import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { convertTime, type TimeUnit } from "../time.js";
import { firstWindow, fsdbFor, toNpiName, windowUnit } from "./values.js";
import { tclQuote } from "./waveform.js";

/**
 * Structure evidence: nSchema cones (including the X cone) and cross-run
 * waveform comparison. See docs/tools.md and docs/limits.md.
 *
 * Verified constraints:
 *  - schCapture writes a real PNG; schTraceX applies the X trace to the window.
 *  - schDumpTracedLeafPin rejects X traces, so a cone is an IMAGE, not text.
 *  - wvCompareResult needs a second waveform pane that cannot be scripted, so a
 *    comparison is also an IMAGE. Say so; never pretend a text diff exists.
 */

const evidenceDir = join(homedir(), ".local/state/verdimcp/evidence");

const CONE_MODES = ["driver", "load", "fanin", "fanout", "x", "active_fanin"] as const;
type ConeMode = (typeof CONE_MODES)[number];

interface ImageInfo {
  path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function describeImage(path: string): Promise<ImageInfo> {
  const data = await Bun.file(path).arrayBuffer();
  const buffer = Buffer.from(data);
  const size = pngSize(buffer);
  if (!size) {
    throw new AppError("backend_error", "capture did not produce a valid PNG", { path });
  }
  return {
    path,
    width: size.width,
    height: size.height,
    bytes: statSync(path).size,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function scopeOf(signal: string): string {
  const parts = signal.split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : signal;
}

export function registerCone(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_cone_capture",
    {
      title: "Capture a design cone as an image",
      description:
        "Build an nSchema schematic cone for one signal and capture it as a PNG evidence artifact. mode=driver|load|fanin|fanout traces that direction, mode=x opens the X cone at `time` and applies schTraceX (root-cause trace), mode=active_fanin shows the active fan-in cone at `time`. Requires a design library (Verdi started with -f). VERIFIED LIMIT: cones are images only — Verdi exposes no textual dump for X or multi-level cones (schDumpTracedLeafPin rejects them), so quote the image, not a pin list. This changes the GUI; the window is closed unless keep_open=true.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        signal: z.string().min(1),
        mode: z.enum(CONE_MODES).optional(),
        scope: z.string().min(1).optional(),
        levels: z.number().int().min(1).max(10).optional(),
        time: z.number().optional(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        keep_open: z.boolean().optional(),
        footer: z.string().min(1).optional(),
      },
    },
    async (args) =>
      runTool("verdi_cone_capture", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const mode: ConeMode = args.mode ?? "driver";
        const signal = toNpiName(args.signal);
        const scope = toNpiName(args.scope ?? scopeOf(args.signal));

        let timeTicks: number | undefined;
        if (mode === "x" || mode === "active_fanin") {
          const windowId = await firstWindow(ctx, session.id);
          const unit = await windowUnit(ctx, session.id, windowId);
          const outUnit: TimeUnit = unit;
          timeTicks = convertTime(args.time ?? 0, args.unit ?? unit, outUnit);
        }

        const commands: string[] = [];
        if (mode === "x") {
          commands.push(`schCreateWindow -delim . -X -time ${timeTicks} ${tclQuote(signal)}`);
        } else if (mode === "active_fanin") {
          commands.push(
            `schCreateWindow -delim . -activeFanIn ${tclQuote(signal)} -cycle ${timeTicks}`,
          );
        } else {
          commands.push(`schCreateWindow -delim . -scope ${tclQuote(scope)}`);
        }

        const created = await ctx.backend.exec(session.id, commands);
        const first = created.results[0];
        const schWindow = (first?.result ?? "").trim();
        if (!first?.ok || !schWindow || schWindow === "0") {
          throw new AppError("not_supported", "could not create an nSchema window", {
            command: first?.command,
            result: first?.result,
            hint: "the session must be started with a design library (-f); a bare FSDB has no cone",
          });
        }

        let traceApplied = false;
        const traceCommands: string[] = [];
        if (mode === "x") {
          traceCommands.push(`schTraceX -win ${schWindow}`);
        } else if (mode !== "active_fanin") {
          const byLevel = args.levels !== undefined && args.levels > 1;
          const level = args.levels ?? 1;
          if (mode === "fanin" && byLevel) {
            traceCommands.push(
              `schTraceFanInByLevel -win ${schWindow} -delim . -signal ${tclQuote(signal)} -level ${level}`,
            );
          } else if (mode === "fanin") {
            traceCommands.push(`schTraceFanIn -win ${schWindow} -delim . -signal ${tclQuote(signal)}`);
          } else if (mode === "fanout" && byLevel) {
            traceCommands.push(
              `schTraceLoadByLevel -win ${schWindow} -delim . -signal ${tclQuote(signal)} -level ${level}`,
            );
          } else if (mode === "fanout") {
            traceCommands.push(`schTraceLoad -win ${schWindow} -delim . -signal ${tclQuote(signal)}`);
          } else if (byLevel) {
            traceCommands.push(
              `schTraceDriverByLevel -win ${schWindow} -delim . -signal ${tclQuote(signal)} -level ${level}`,
            );
          } else {
            traceCommands.push(`schTraceDriver -win ${schWindow} -delim . -signal ${tclQuote(signal)}`);
          }
        }

        if (traceCommands.length > 0) {
          const traced = await ctx.backend.exec(session.id, traceCommands);
          const traceResult = traced.results[0];
          if (!traceResult?.ok || traceResult.result.trim() === "0") {
            // Keep going: some Verdi builds return 0 while still updating the window.
            traceApplied = false;
          } else {
            traceApplied = true;
          }
        } else {
          traceApplied = true;
        }

        mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
        const path = join(evidenceDir, `cone-${mode}-${session.id}-${schWindow}-${Date.now()}.png`);
        const footer = args.footer ?? `verdi_cone_capture ${mode} ${signal}`;
        const capture = await ctx.backend.exec(session.id, [
          `schCapture -win ${schWindow} -file ${tclQuote(path)} -footer ${tclQuote(footer)}`,
        ]);
        const captureResult = capture.results[0];
        if (!captureResult?.ok || captureResult.result.trim() === "0") {
          throw new AppError("backend_error", "schCapture failed", {
            command: captureResult?.command,
            result: captureResult?.result,
          });
        }

        const image = await describeImage(path);
        if (args.keep_open !== true) {
          await ctx.backend.exec(session.id, [`schCloseWindow -win ${schWindow}`]);
        }

        return {
          window_id: schWindow,
          signal,
          scope,
          mode,
          levels: args.levels ?? null,
          time: mode === "x" || mode === "active_fanin" ? (args.time ?? 0) : null,
          unit: args.unit ?? null,
          trace_applied: traceApplied,
          image,
          text_available: false,
          note:
            "Verdi does not expose cone contents as text (schDumpTracedLeafPin rejects X, active and *ByLevel " +
            "traces). Treat the PNG as the evidence artifact and label conclusions as INFERRED from the image.",
        };
      }),
  );

  server.registerTool(
    "verdi_waveform_compare",
    {
      title: "Compare a signal against another run or signal",
      description:
        "Compare signals in the target nWave window against the same signals in other FSDB files, or two selected signals against each other, then capture the window as a PNG. VERIFIED LIMIT: wvCompareResult needs a second waveform pane that cannot be scripted, so there is no textual diff — the screenshot is the comparison artifact. Use it to answer 'did this behaviour change between runs'.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1),
        against_fsdb: z.array(z.string().min(1)).max(2).optional(),
        two: z.boolean().optional(),
        capture: z.boolean().optional(),
      },
    },
    async (args) =>
      runTool("verdi_waveform_compare", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const windowId = args.window_id ?? (await firstWindow(ctx, session.id));
        const signals = args.signals.map((name) => (name.startsWith("/") ? name : `/${name}`));

        const buildCommand = (): string => {
          const parts = [`wvCompareSelected -win ${windowId}`];
          parts.push(`-signal {${signals.join(" ")}}`);
          if (args.against_fsdb && args.against_fsdb.length > 0) {
            parts.push(`-fsdb {${args.against_fsdb.join(" ")}}`);
          }
          if (args.two === true) parts.push("-two on");
          return parts.join(" ");
        };

        let compared = await ctx.backend.exec(session.id, [buildCommand()]);
        let added = false;
        const firstResult = compared.results[0];
        if (!firstResult?.ok || firstResult.result.trim() === "0") {
          added = true;
          await ctx.backend.exec(session.id, [`wvAddSignal -win ${windowId} {${signals.join(" ")}}`]);
          compared = await ctx.backend.exec(session.id, [buildCommand()]);
        }
        const result = compared.results[0];
        if (!result?.ok || result.result.trim() === "0") {
          throw new AppError("not_supported", "wvCompareSelected failed", {
            command: result?.command,
            result: result?.result,
            hint: "the compared signals must exist in both the window and the reference FSDB",
          });
        }

        const fsdb = fsdbFor(session);
        const straySchematic = await ctx.backend.exec(session.id, ["schGetAllWindows"]);
        const strayIds = (straySchematic.results[0]?.result ?? "").trim().split(/\s+/).filter(Boolean);
        const payload: Record<string, unknown> = {
          window_id: windowId,
          signals,
          against_fsdb: args.against_fsdb ?? null,
          two: args.two === true,
          added_signals: added,
          fsdb,
          text_available: false,
          note:
            "wvCompareResult requires a second waveform pane, which is not scriptable, so no diff report is " +
            "written. The screenshot is the comparison artifact.",
          warning:
            strayIds.length > 0
              ? `this session already has ${strayIds.length} nSchema window(s); running a comparison after ` +
                `schematic operations was observed to kill Verdi W-2024.09 once. Prefer a fresh session, and ` +
                `tell the user the GUI may restart.`
              : null,
        };

        if (args.capture !== false) {
          const shot = await ctx.backend.screenshot(session.id, windowId);
          payload.image = shot;
        }
        return payload;
      }),
  );
}
