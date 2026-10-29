---
name: verdi-performance
description: Use when a Verdi query or render is slow, when the FSDB is large, or when deciding between GUI and NPI for a big view. Covers the measured cost model, the hard render bounds, and which performance questions have no tool behind them.
---

# Performance, cost model, and bounds

## Scope

**In:** "this is slow", "the FSDB is 3 GB", "why did my render take 30 s", choosing an engine.
**Out of scope:** throughput, latency, outstanding-transaction, bottleneck attribution, CDC and
coverage. **No MCP tool implements those.** If asked, say so; do not derive them from raw change counts.

## Measured cost model (903 MB FSDB, 128 signals, 5 ms window, 2000 bins)

| Path | Stage | Time |
|---|---|---:|
| NPI | `npisys.init` | 4.04 s |
| NPI | open | 0.01 s |
| NPI | read (128 × 2000 = 256 k samples) | 18.15 s |
| NPI | SVG | 0.11 s |
| NPI | SVG→PNG (ImageMagick) | 8.28 s |
| NPI | **total** | **30.6 s**, RSS 8.0 GB |
| GUI | create + open + add + zoom + screenshot | 27.0 s, RSS 8.4 GB |
| GUI | same window, capture again | **9.7 s** |

Resident NPI reader (default) removes the 3–4 s init after the first call: hot queries measured
0.6–1.3 s. One-shot mode costs ~3.1 s per call.

Read the rule off that table: **NPI wins on targeted reads, loses on wide renders.** ~14 k samples/s for
reads; the PNG conversion is a flat cost proportional to image complexity.

## Practical thresholds

- ≤16 signals and ≤1000 bins → `verdi_waveform_render` (the tool enforces the bound; ~1 s of reads).
- More signals than that, or "show me what the engineer sees" → GUI capture
  (`verdi_capture_annotate` / `verdi_window_screenshot`).
- Very wide time ranges → sample with `verdi_window_scan` / aggregate with `verdi_change_stats` first,
  then narrow before reading transitions.
- `engine.auto` is the right default. `switch_hint` fires only past 15 s and only when the other engine is
  usable — it is the tool telling you the cost model disagrees with the auto choice.

## Why the render bound is not arbitrary

256,000 samples ≈ 18 s. The bound of 16×1000 = 16 000 samples ≈ 1.1 s, which keeps a "show me" call
interactive. Raising the bound is possible; it is a product decision, not a technical one.

## Cone capture cost

`verdi_cone_capture` takes 10–35 s per call: nSchema elaborates, traces, then `schCapture` writes a
full-window PNG. Do not loop over 20 signals. One cone per question.

## Memory

Both paths sat at ~8 GB RSS on the 903 MB FSDB — FSDB indexing dominates, and headless does **not** save
memory. On a shared host that is the number that gets you killed by a colleague, not the wall time.

## Degradation

- NPI unavailable → GUI sampling: `verdi_xz_scan` caps at 20 signals and a `max*2` query budget, sets
  `degraded: true`. Results are candidates, not a scan.
- GUI unavailable → NPI only: no capture, no annotation, no cone.
- Neither → report the blocker; do not approximate a waveform from logs.

## Answering "why is it slow"

Quote the stage breakdown, not a single number:

```
30.6 s = 4.0 init + 18.1 read (256k samples) + 0.1 svg + 8.3 png
fix: cut signals/bins (read is linear), or use a GUI capture (9.7 s same-window)
caveat: resident reader removes init, not read
```
