import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionEntry, ToolContext } from "../context.js";
import { AppError, runTool } from "../errors.js";
import { convertTime, type TimeUnit } from "../time.js";
import { tclQuote } from "./waveform.js";
import { allWindows, firstWindow, fsdbFor, windowUnit } from "./values.js";
import { npiValues } from "./primitives.js";

const evidenceDir = process.env.VERDI_EVIDENCE_DIR || join(homedir(), ".local/state/verdi-mcp/evidence");

interface EvidenceItem {
  item_id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
  query_used?: Record<string, unknown>;
}

interface Evidence {
  evidence_id: string;
  session_id: string;
  title: string;
  created_at: string;
  conclusion: string;
  confidence: string;
  items: EvidenceItem[];
}

interface Annotation {
  type: "marker" | "comment" | "highlight";
  signal?: string;
  time?: number;
  end?: number;
  label: string;
  color?: string;
}

function pathFor(id: string): string {
  return join(evidenceDir, `${id}.json`);
}

function loadEvidence(id: string): Evidence {
  const path = pathFor(id);
  if (!existsSync(path)) throw new AppError("not_supported", `evidence not found: ${id}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Evidence;
  } catch (err) {
    throw new AppError("backend_error", `invalid evidence file: ${String(err)}`);
  }
}

function saveEvidence(evidence: Evidence): void {
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  writeFileSync(pathFor(evidence.evidence_id), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

function quoteText(text: string): string {
  return text.includes("}") ? `"${text.replaceAll('"', '\\"')}"` : `{${text}}`;
}

async function ensureWindow(ctx: ToolContext, session: SessionEntry): Promise<string> {
  const windows = await allWindows(ctx, session.id);
  if (windows.length > 0) return windows[windows.length - 1];
  const created = await ctx.backend.exec(session.id, ["wvCreateWindow"]);
  const wid = created.results[0]?.result.trim() ?? "";
  if (!wid || wid === "0") throw new AppError("window_not_found", "could not create an nWave window");
  const fsdb = fsdbFor(session);
  if (fsdb) {
    await ctx.backend.exec(session.id, [`wvOpenFile -win ${wid} ${tclQuote(fsdb)}`]);
  }
  return wid;
}

async function applyAnnotation(
  ctx: ToolContext,
  session: SessionEntry,
  windowId: string,
  unit: TimeUnit,
  annotation: Annotation,
): Promise<Record<string, unknown>> {
  const ticks = (value: number) => convertTime(value, unit, unit);
  if (annotation.type === "highlight") {
    if (!annotation.signal) throw new AppError("invalid_argument", "highlight annotation requires signal");
    const color = annotation.color ?? "ID_BLUE3";
    const res = await ctx.backend.exec(session.id, [
      `verdiHighlightSignal -sigColor {${annotation.signal} ${color}} -apply`,
    ]);
    const first = res.results[0];
    if (!first?.ok) throw new AppError("not_supported", "verdiHighlightSignal failed", { result: first?.result });
    return { ...annotation, applied: true };
  }
  if (annotation.type === "marker") {
    const time = annotation.time ?? 0;
    const color = annotation.color ?? "ID_YELLOW8";
    const res = await ctx.backend.exec(session.id, [
      `wvSetMarker -win ${windowId} -name ${quoteText(annotation.label)} ${ticks(time)} ${color} solid`,
    ]);
    const first = res.results[0];
    if (!first?.ok) throw new AppError("not_supported", "wvSetMarker failed", { result: first?.result });
    return { ...annotation, applied: true };
  }
  const start = annotation.time ?? 0;
  const end = annotation.end ?? start + 1;
  const row = await ctx.backend.exec(session.id, [`wvAddComment ${quoteText(annotation.label)}`]);
  const rowId = row.results[0]?.result.trim() ?? "";
  if (!row.results[0]?.ok || !rowId) {
    throw new AppError("not_supported", "wvAddComment failed", { result: row.results[0]?.result });
  }
  const box = await ctx.backend.exec(session.id, [
    `wvAddCommentBox -win ${windowId} -rowid ${rowId} -style square -left ${ticks(start)} -right ${ticks(end)} ${quoteText(annotation.label)}`,
  ]);
  const first = box.results[0];
  if (!first?.ok) throw new AppError("not_supported", "wvAddCommentBox failed", { result: first?.result });
  return { ...annotation, row_id: rowId, applied: true };
}

async function capture(
  ctx: ToolContext,
  session: SessionEntry,
  windowId: string,
  signals: string[] | undefined,
  start: number,
  end: number,
  unit: TimeUnit,
  annotations: Annotation[],
): Promise<Record<string, unknown>> {
  if (signals && signals.length > 0) {
    await ctx.backend.exec(session.id, [
      `wvAddSignal -win ${windowId} ${signals.map(tclQuote).join(" ")}`,
    ]);
  }
  const windowUnitValue = await windowUnit(ctx, session.id, windowId);
  await ctx.backend.exec(session.id, [
    `wvZoom -win ${windowId} ${convertTime(start, unit, windowUnitValue)} ${convertTime(end, unit, windowUnitValue)}`,
  ]);
  const applied: Record<string, unknown>[] = [];
  for (const annotation of annotations) {
    const converted: Annotation = {
      ...annotation,
      time:
        annotation.time === undefined ? undefined : convertTime(annotation.time, unit, windowUnitValue),
      end: annotation.end === undefined ? undefined : convertTime(annotation.end, unit, windowUnitValue),
    };
    applied.push(await applyAnnotation(ctx, session, windowId, windowUnitValue, converted));
  }
  const shot = await ctx.backend.screenshot(session.id, windowId);
  return { screenshot: shot, annotations: applied };
}

function renderSvg(
  signals: string[],
  columns: string[][],
  times: number[],
  unit: TimeUnit,
  annotations: Annotation[],
): { svg: string; width: number; height: number } {
  const rowHeight = 14;
  const labelWidth = 260;
  const plotWidth = Math.max(400, Math.min(2000, times.length * 2));
  const width = labelWidth + plotWidth + 20;
  const height = 60 + signals.length * rowHeight;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    '<rect width="100%" height="100%" fill="white"/>',
    `<text x="8" y="24" font-size="13" font-family="monospace">verdi waveform_render — ${signals.length} signals — ${times[0]}..${times[times.length - 1]} ${unit}</text>`,
  ];
  for (let row = 0; row < signals.length; row++) {
    const y = 40 + row * rowHeight;
    const values = columns[row] ?? [];
    parts.push(`<text x="8" y="${y + 10}" font-size="9" font-family="monospace">${signals[row]}</text>`);
    const points: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const value = (values[i] ?? "").toLowerCase();
      const x = labelWidth + (i / Math.max(1, values.length - 1)) * plotWidth;
      const yy = /[xz]/.test(value) ? y + rowHeight / 2 : y + (value.endsWith("1") ? rowHeight - 3 : 3);
      points.push(`${Math.round(x)},${Math.round(yy)}`);
    }
    parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#0066cc" stroke-width="1"/>`);
  }
  for (const annotation of annotations) {
    if (annotation.time === undefined) continue;
    const x = labelWidth + ((annotation.time - times[0]) / Math.max(1, times[times.length - 1] - times[0])) * plotWidth;
    parts.push(`<line x1="${x}" y1="30" x2="${x}" y2="${height - 10}" stroke="#cc0000" stroke-dasharray="3,2"/>`);
    parts.push(`<text x="${x + 3}" y="38" font-size="9" fill="#cc0000" font-family="monospace">${annotation.label}</text>`);
  }
  parts.push("</svg>");
  return { svg: parts.join("\n"), width, height };
}

export function registerEvidence(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "verdi_evidence_create",
    {
      title: "Create evidence artifact",
      description: "Create an evidence bundle bound to a Verdi session. Items are added with verdi_capture_annotate / verdi_evidence_add / verdi_waveform_render.",
      inputSchema: { session_id: z.string().min(1).optional(), title: z.string().min(1) },
    },
    async (args) =>
      runTool("verdi_evidence_create", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const evidence: Evidence = {
          evidence_id: randomUUID(),
          session_id: session.id,
          title: args.title,
          created_at: new Date().toISOString(),
          conclusion: "",
          confidence: "uncertain",
          items: [],
        };
        saveEvidence(evidence);
        return { evidence_id: evidence.evidence_id, session_id: session.id };
      }),
  );

  server.registerTool(
    "verdi_capture_annotate",
    {
      title: "Capture annotated GUI evidence",
      description:
        "Zoom to a region, add the signals, apply native nWave markers/comment boxes/signal highlights (when scripting succeeds), and capture the window as a screenshot item.",
      inputSchema: {
        evidence_id: z.string().min(1),
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).optional(),
        start: z.number().optional(),
        end: z.number(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        annotations: z
          .array(
            z.object({
              type: z.enum(["marker", "comment", "highlight"]),
              signal: z.string().min(1).optional(),
              time: z.number().optional(),
              end: z.number().optional(),
              label: z.string().min(1),
              color: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    async (args) =>
      runTool("verdi_capture_annotate", async () => {
        const evidence = loadEvidence(args.evidence_id);
        const session = await ctx.backend.resolveSession(args.session_id ?? evidence.session_id);
        const windowId = args.window_id ?? (await ensureWindow(ctx, session));
        const unit = args.unit ?? (await windowUnit(ctx, session.id, windowId));
        const data = await capture(
          ctx,
          session,
          windowId,
          args.signals,
          args.start ?? 0,
          args.end,
          unit,
          (args.annotations ?? []) as Annotation[],
        );
        const item: EvidenceItem = {
          item_id: randomUUID(),
          type: "screenshot",
          created_at: new Date().toISOString(),
          data: { ...data, roi: { signals: args.signals ?? [], start: args.start ?? 0, end: args.end, unit } },
          query_used: { tool: "verdi_capture_annotate", arguments: args },
        };
        evidence.items.push(item);
        saveEvidence(evidence);
        return item;
      }),
  );

  server.registerTool(
    "verdi_waveform_render",
    {
      title: "Render a bounded headless waveform",
      description:
        "Render a small digital waveform from NPI values. Bounded by design: at most 16 signals and 1000 bins. For 128-signal / big-FSDB views use GUI capture instead (see md/10 §8).",
      inputSchema: {
        evidence_id: z.string().min(1).optional(),
        session_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1).max(16),
        start: z.number().optional(),
        end: z.number(),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
        bins: z.number().int().min(2).max(1000).optional(),
        annotations: z
          .array(
            z.object({
              type: z.enum(["marker", "comment", "highlight"]),
              signal: z.string().min(1).optional(),
              time: z.number().optional(),
              end: z.number().optional(),
              label: z.string().min(1),
              color: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    async (args) =>
      runTool("verdi_waveform_render", async () => {
        const session = await ctx.backend.resolveSession(args.session_id);
        const fsdb = fsdbFor(session);
        if (!fsdb) throw new AppError("not_supported", "waveform_render requires an FSDB");
        const windowId = await firstWindow(ctx, session.id);
        const unit = args.unit ?? (await windowUnit(ctx, session.id, windowId));
        const start = args.start ?? 0;
        const bins = args.bins ?? 500;
        const step = (args.end - start) / Math.max(1, bins - 1);
        const times = Array.from({ length: bins }, (_, i) => start + i * step);
        const columns = await npiValues(fsdb, args.signals, times, unit);
        const { svg, width, height } = renderSvg(args.signals, columns, times, unit, (args.annotations ?? []) as Annotation[]);
        mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const svgPath = join(evidenceDir, `render-${id}.svg`);
        const pngPath = join(evidenceDir, `render-${id}.png`);
        writeFileSync(svgPath, svg, { mode: 0o600 });
        const convert = Bun.spawn({ cmd: ["convert", svgPath, pngPath], stdout: "pipe", stderr: "pipe" });
        const code = await convert.exited;
        if (code !== 0) {
          throw new AppError("backend_error", "convert failed", { svg: svgPath, code });
        }
        const data = {
          path: pngPath,
          svg_path: svgPath,
          width,
          height,
          bytes: statSync(pngPath).size,
          signals: args.signals.length,
          bins,
          source: "npi",
        };
        if (args.evidence_id) {
          const evidence = loadEvidence(args.evidence_id);
          evidence.items.push({
            item_id: randomUUID(),
            type: "waveform",
            created_at: new Date().toISOString(),
            data,
            query_used: { tool: "verdi_waveform_render", arguments: args },
          });
          saveEvidence(evidence);
        }
        return data;
      }),
  );

  server.registerTool(
    "verdi_evidence_add",
    {
      title: "Add an evidence item",
      description: "Attach a Value/Changes/Source/Check item (machine layer) to an evidence bundle.",
      inputSchema: {
        evidence_id: z.string().min(1),
        type: z.enum(["value", "changes", "source", "check", "screenshot"]),
        data: z.record(z.string(), z.unknown()),
        query_used: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) =>
      runTool("verdi_evidence_add", async () => {
        const evidence = loadEvidence(args.evidence_id);
        const item: EvidenceItem = {
          item_id: randomUUID(),
          type: args.type,
          created_at: new Date().toISOString(),
          data: args.data,
          query_used: args.query_used,
        };
        evidence.items.push(item);
        saveEvidence(evidence);
        return item;
      }),
  );

  server.registerTool(
    "verdi_evidence_compare",
    {
      title: "Capture two regions side by side",
      description: "Capture ROI A and ROI B for the same signals and compose them side by side.",
      inputSchema: {
        evidence_id: z.string().min(1),
        session_id: z.string().min(1).optional(),
        window_id: z.string().min(1).optional(),
        signals: z.array(z.string().min(1)).min(1),
        roi_a: z.object({ start: z.number(), end: z.number() }),
        roi_b: z.object({ start: z.number(), end: z.number() }),
        unit: z.enum(["ps", "ns", "us", "ms", "s"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_evidence_compare", async () => {
        const evidence = loadEvidence(args.evidence_id);
        const session = await ctx.backend.resolveSession(args.session_id ?? evidence.session_id);
        const windowId = args.window_id ?? (await ensureWindow(ctx, session));
        const unit = args.unit ?? (await windowUnit(ctx, session.id, windowId));
        const a = await capture(ctx, session, windowId, args.signals, args.roi_a.start, args.roi_a.end, unit, []);
        const b = await capture(ctx, session, windowId, args.signals, args.roi_b.start, args.roi_b.end, unit, []);
        const shotA = (a.screenshot as { path: string }).path;
        const shotB = (b.screenshot as { path: string }).path;
        mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
        const path = join(evidenceDir, `compare-${randomUUID()}.png`);
        const proc = Bun.spawn({ cmd: ["convert", shotA, shotB, "+append", path], stdout: "pipe", stderr: "pipe" });
        const code = await proc.exited;
        if (code !== 0) throw new AppError("backend_error", "convert +append failed", { code });
        const item: EvidenceItem = {
          item_id: randomUUID(),
          type: "compare",
          created_at: new Date().toISOString(),
          data: { path, bytes: statSync(path).size, roi_a: args.roi_a, roi_b: args.roi_b, signals: args.signals },
          query_used: { tool: "verdi_evidence_compare", arguments: args },
        };
        evidence.items.push(item);
        saveEvidence(evidence);
        return item;
      }),
  );

  server.registerTool(
    "verdi_evidence_report",
    {
      title: "Render an evidence report",
      description: "Render the evidence bundle as Markdown (default) or HTML with reproducibility commands and item files.",
      inputSchema: {
        evidence_id: z.string().min(1),
        format: z.enum(["md", "html"]).optional(),
      },
    },
    async (args) =>
      runTool("verdi_evidence_report", async () => {
        const evidence = loadEvidence(args.evidence_id);
        const format = args.format ?? "md";
        const lines = [
          `# ${evidence.title}`,
          "",
          `- evidence_id: \`${evidence.evidence_id}\``,
          `- session: \`${evidence.session_id}\``,
          `- created: ${evidence.created_at}`,
          `- conclusion: ${evidence.conclusion || "(not set)"}`,
          `- confidence: ${evidence.confidence}`,
          "",
          "## Items",
          "",
        ];
        for (const item of evidence.items) {
          lines.push(`### ${item.type} \`${item.item_id}\``);
          lines.push("");
          lines.push("```json");
          lines.push(JSON.stringify(item.data, null, 2));
          lines.push("```");
          if (item.query_used) {
            lines.push("");
            lines.push("Reproduce:");
            lines.push("```json");
            lines.push(JSON.stringify(item.query_used, null, 2));
            lines.push("```");
          }
          lines.push("");
        }
        mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
        const path = join(evidenceDir, `report-${evidence.evidence_id}.${format}`);
        writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
        return { path, format, items: evidence.items.length };
      }),
  );
}
