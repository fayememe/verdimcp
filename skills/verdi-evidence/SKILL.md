---
name: verdi-evidence
description: Use at the end of a Verdi debug session to build a reproducible evidence artifact — GUI capture with native annotations, bounded headless waveform render, machine items, comparison, and a Markdown/HTML report. Prevents fabricated values/screenshots.
---

# Evidence bundle

## Flow

1. `verdi_evidence_create {session_id?, title}` → `evidence_id`.
2. **Visual evidence**:
   - `verdi_capture_annotate {evidence_id, signals, start, end, unit, annotations}`:
     native nWave markers / comment boxes / signal highlights when scriptable (VERIFIED), then screenshot.
   - `verdi_waveform_render {evidence_id, signals (≤16), bins (≤1000), start, end}`:
     bounded NPI render. For large FSDB/many signals use GUI capture instead.
3. **Machine evidence**: `verdi_evidence_add {type: value|changes|source|check|screenshot, data, query_used}`.
4. **Comparison**: `verdi_evidence_compare {signals, roi_a, roi_b}`.
5. **Report**: `verdi_evidence_report {evidence_id, format: md|html}`.

## Rules

- `query_used` must be the actual tool call + arguments that produced the item. The report's reproduce section is generated from it.
- Never invent a value, screenshot path, driver, or check result. If a tool returned `not_supported`, record that.
- Report `truncated` / `degraded` / `source` (`gui` vs `npi`) exactly as returned.
- Label strength: `confirmed` only when machine data + visual evidence agree; otherwise `likely` / `uncertain` with a reason.
- Keep RTL/FSDB contents local; only signal names, times, conclusions and minimal snippets leave the session.
- Evidence files default to `~/.local/state/verdi-mcp/evidence/`; copy the report/artifacts into the project when they belong to a bug.

## Labels

Use the repo's evidence labels: VERIFIED / DOCUMENTED_ONLY / NOT_TESTED / INFERRED. The report is not VERIFIED just because it exists; the underlying query must have run.
