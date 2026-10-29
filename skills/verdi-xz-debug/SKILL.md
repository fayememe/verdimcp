---
name: verdi-xz-debug
description: Use when a signal is X or Z. Classify the cause (undriven, uninitialized, tri-state, propagation), find the first X/Z, then trace the cone back to a root cause with verdi_cone_capture and state how confident the conclusion is. Covers the verified limit that Verdi exposes X cones as images only.
---

# X / Z debug

## Scope

**In:** a signal whose value is `x`, `z`, `xx`, `zz`, or a bus that turns X mid-simulation.
**Out:** functional protocol errors with clean 0/1 values (→ `verdi-bus-debug`), and lint-level
"this net can never be driven" claims (no static analysis here).

## Step 1 — classify before tracing

| Category | Tell | Probe |
|---|---|---|
| **Undriven / floating net** | X from t=0 and never changes | `change_stats` count == 0, `value_get` at 0 and at end both `x` |
| **Uninitialized register / memory** | X at reset release, clears after a write | `transitions_get`: X → a real value at first write |
| **Tri-state bus** | `z` or mixed `xz`; driver enable low | `value_get` shows `z`; look for the enable/select role |
| **Propagation** | X enters later, fans out to many signals | `xz_scan` shows an upstream signal X before this one |

Do not skip this step. "X at time 0" and "X appeared at 1.2 µs" have completely different root causes.

## Step 2 — find the first occurrence

1. `verdi_fsdb_open` (records the FSDB for NPI).
2. `verdi_signals_list` to resolve exact absolute paths (never guess scope names).
3. `verdi_xz_scan {signals|scope, start, end, max, engine}`.
   - `source: "npi"` = real transition enumeration. `source: "gui"` + `degraded: true` = budgeted sampling;
     a candidate list, not a complete scan. Say which one you got.
   - Read `fsdb.is_completed` before treating "no X after t" as a finding.
4. `verdi_value_get` at the first X time for the literal string. Never print X as 0.

## Step 3 — trace the cone (needs a design library)

`verdi_cone_capture {signal, mode: "x", time, unit}` creates an nSchema window at that time, applies
`schTraceX`, and captures a PNG.

- Returns `{window_id, trace_applied, image:{path,width,height,bytes,sha256}, text_available:false}`.
- `trace_applied: true` means Verdi accepted the X trace on the window.
- **Verified limit:** `schDumpTracedLeafPin` rejects X traces ("previous action was not tracing driver,
  load or connectivity"), so there is **no textual X cone**. The image is the artifact.
- If `mode: "x"` returns `not_supported`, the session has no design library. Report that and fall back to
  time-correlation only (Step 4). Do **not** describe a cone you could not open.
- `mode: "active_fanin"` with `time` shows the active fan-in cone at that cycle — useful when you suspect
  a mux/select rather than a missing driver.

## Step 4 - say what is missing

Without a design library:

- `verdi_scopes_list` + `verdi_xz_scan` over the parent scope to find an earlier X in the same cone.
- `verdi_change_stats` to prove the suspect signal was quiet before the X appeared.
- Label the conclusion **INFERRED / likely**, and state exactly which structural question you could not answer.

## Step 5 — report

Answer in this shape:

```
signal:        tb.dut.fifo.mem[3].data  (VERIFIED, value "xxxxxxxx" at 1.240 us)
first X:       1.240 us  (NPI scan, 3 candidates, truncated=false, fsdb.completed=true)
category:      uninitialized read  (INFERRED from X->valid transition at first write)
cone:          cone-x-...png (VERIFIED image, X trace applied)
root cause:    read before reset released on bank 3  (INFERRED from image + waveform)
not proven:    date of the missing reset in RTL
```

## Rules

- Never convert X/Z to 0. Keep the literal string, including width (`xx`, `xxxx_xxxx`).
- "No X found" is a claim about a range: quote `start`/`end`, `fsdb.max_time`, and `fsdb.is_completed`.
- One X observation is evidence, not root cause. Separate observation, category, and cause.
- The image is evidence about pixels; the conclusion about logic is INFERRED unless a text dump backs it.
- Do not run `verdi_waveform_compare` in the same session right after cone captures — see `verdi-cone-evidence`.
