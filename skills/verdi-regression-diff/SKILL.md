---
name: verdi-regression-diff
description: Use when the same signal behaved differently between two runs or two builds. Compares signals against another FSDB in nWave and captures the diff as an image; documents the verified limit that Verdi gives no textual comparison report.
---

# Regression diff (two runs)

## Scope

**In:** "this worked in the previous run", "the transfer is one cycle later now", "did my fix change anything".
**Out:** formal equivalence checking, and any diff that needs a second pane's textual report (not
scriptable — see limits).

## Flow

1. Confirm the **two artifacts**: current session FSDB (`verdi_session_info` → `fsdb`) and the reference
   FSDB path. Both must exist and be readable; the reference can be a copy of an older run.
2. **Do this before any cone capture** in the session (ordering hazard below).
3. `verdi_waveform_compare {signals, against_fsdb: [ref], capture: true}`.
   - Signals are normalized to `/`-prefixed GUI names; if they are not yet in the window the tool adds them
     once and reports `added_signals: true`.
   - Returns `{window_id, signals, against_fsdb, image:{path,width,height,bytes,sha256}, text_available:false, warning}`.
4. Read the screenshot and state the difference shape per signal:

| Visual difference | Usual meaning |
|---|---|
| Same edges, offset by N cycles | pipeline/latency change or a new stall |
| Extra / missing transition | state machine path changed |
| Value differs on the same edge | data path or constant changed |
| Same picture, identical sha256 | no visible difference in this ROI |

5. If the diff must be quantified (e.g. "late by 2 cycles"), get the numbers with
   `verdi_transitions_get` on each run separately and compare the times yourself. The compare tool gives
   the picture; the evidence for "2 cycles" is the two transition lists.

## Limits (verified)

- `wvCompareResult -file ...` writes
  `"You must open another waveform pane before running this option!"` — a second pane cannot be scripted,
  so **no textual diff file exists**. The screenshot is the artifact. Never quote a diff report.
- Comparing a signal that exists only in one FSDB fails with `not_supported`; check the name in both runs
  with `verdi_signals_list` first.
- **Ordering hazard:** comparing in a session that already opened nSchema windows killed Verdi W-2024.09
  once. The tool returns `warning` when schematic windows are present; if so, prefer a fresh session.

## Reporting

```
run A:  demo/sim/sync_fifo.fsdb         (VERIFIED)
run B:  /tmp/old_run/sync_fifo.fsdb     (VERIFIED)
signal: /tb_sync_fifo/rd_data[7:0]
diff:   first valid beat at 40 ns (A) vs 44 ns (B)   (VERIFIED from two transitions_get calls)
visual: compare-<sid>-<ts>.png sha256 afb02699…      (VERIFIED image, INFERRED about logic)
verdict: 1-cycle latency regression on the read path (INFERRED)
```

## Rules

- Never claim "no difference" from a screenshot alone; say "no visible difference in this ROI" and give
  the ROI (`start`/`end`/zoom) and the sha256.
- Never claim a cycle count from pixels. Use transitions.
- Always name both FSDB paths — a diff without provenance is useless a week later.
