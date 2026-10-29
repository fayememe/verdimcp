---
name: verdi-evidence
description: Use at the end of a Verdi debug session to build a reproducible evidence artifact — GUI capture with native annotations, structure/cone images, bounded headless render, machine items, comparison, and a Markdown/HTML report. Prevents fabricated values, screenshots and cones.
---

# Evidence bundle

## Scope

**In:** turn a finished investigation into something a reviewer can trust and re-run.
**Out:** making the conclusion sound better than the data. This skill exists to stop that.

## Flow

1. `verdi_evidence_create {session_id?, title}` → `evidence_id`.
2. **Waveform visual** — pick one:
   - `verdi_capture_annotate {evidence_id, signals, start, end, unit, annotations}`:
     native nWave markers / comment boxes / signal highlights (VERIFIED), then a screenshot.
     `annotations[].applied` tells you which ones actually took; report `false` ones as missing.
   - `verdi_waveform_render {evidence_id, signals ≤16, bins ≤1000}`: bounded NPI render for portable
     pictures. For wide views use the GUI capture instead (see `verdi-performance`).
3. **Structure visual** — `verdi_cone_capture {signal, mode, time?}` when the claim is about logic
   (X root cause, driver cone, active branch). Returns a PNG + sha256 and `text_available: false`.
   Label the conclusion INFERRED; the image is only evidence about pixels.
4. **Diff visual** — `verdi_waveform_compare {signals, against_fsdb}` when the claim is "changed between
   runs". No textual diff exists; the screenshot is the artifact.
5. **Machine items** — `verdi_evidence_add {type: value|changes|source|check|screenshot, data, query_used}`.
6. **Comparison** — `verdi_evidence_compare {signals, roi_a, roi_b}` for before/after in one image.
7. **Report** — `verdi_evidence_report {evidence_id, format: md|html}`.

## `query_used` is the contract

`query_used` must be the real tool name and the real arguments that produced the item. The report's
"reproduce" section is generated from it, so a wrong `query_used` makes the whole bundle unfalsifiable.
If you cannot reconstruct the call, omit the item — do not paraphrase it.

## What each artifact can and cannot prove

| Artifact | Proves | Does not prove |
|---|---|---|
| `value` item | the value at that time, if `query_used` re-runs to it | that the design is correct |
| `changes` item | edges/counts in a stated range, with `engine` + `fsdb` | delta-cycle completeness when `engine: gui` |
| `check` item | the predicate held for those params | that the predicate is the right rule |
| annotated screenshot | what the engineer sees | the logic behind it |
| cone image | the traced topology at that time | a pin list (Verdi gives none) |
| compare image | a visible difference | a cycle count (use transitions) |

## Rules

- Never invent a value, screenshot path, driver, cone, or check result. If a tool returned
  `not_supported`, record that as the finding.
- Copy `truncated` / `degraded` / `source` / `engine.used` / `fsdb.is_completed` exactly as returned.
- Strength: `confirmed` only when machine data **and** visual evidence agree. Otherwise `likely` /
  `uncertain`, with the missing piece named.
- Keep RTL/FSDB contents local: signal names, times, minimal snippets and conclusions travel; dumps do not.
- Artifacts live under `~/.local/state/verdimcp/{evidence,screenshots}/`; copy the bundle into the
  project when it belongs to a bug report.
- A report existing is not evidence that the run happened. Cite the tool result.

## Labels

Use the repo's vocabulary in the report body: **VERIFIED** / **INFERRED** / **DOCUMENTED_ONLY** /
**NOT_TESTED**. The report is not VERIFIED just because it was generated.

## Minimal bundle for a bug

```
evidence:  "fifo_wr_stall_2026-10-28"
value:     /tb_sync_fifo/wr_valid @115.43ns = "1"        (VERIFIED)
changes:   /tb_sync_fifo/wr_ready 0..240ns count=0       (VERIFIED, npi, fsdb.completed)
check:     wr_stall (7dcf91b9) hits=17                   (VERIFIED)
capture:   annotated.png 2560x615 sha256 26f718f8…       (VERIFIED image)
cone:      cone-x-...png 1711x618 sha256 f8f6e51a…       (VERIFIED image, INFERRED logic)
report:    report-<id>.md
```
