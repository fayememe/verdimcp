---
name: verdi-temporal-pattern
description: Use when the question is about ordering in time — "find the cycle where A happens then B", "the handshake was stuck for more than 3 cycles", "did this ever occur". Covers sampled predicates vs exact enumeration, min_duration, and freezing a rule as a reusable deterministic check.
---

# Temporal patterns

## Scope

**In:** boolean/temporal questions over a window — first occurrence, sustained condition, coexistence, ordering.
**Out:** protocol legality rules (→ `verdi-bus-debug` grounding text), exact delta-cycle event sequences
(Verdi's EventSequence window is not scriptable — see limits).

## Two primitives, different strength

| Tool | Semantics | Honest wording |
|---|---|---|
| `verdi_window_scan {predicate, start, end, bins, max, min_duration}` | evaluates the predicate at `bins` sampled points | "**sampled** at N points; the condition held at these points" |
| `verdi_check_define` + `verdi_check_run` | same sampler, but the predicate + params are persisted and re-run deterministically | "reproducible result for this predicate and these params" |

Neither is an exhaustive cycle-by-cycle proof. If the claim must be exact, use `verdi_transitions_get`
(NPI) on each signal and evaluate the ordering yourself.

## Predicate language

- Identifiers are signal paths as they appear in the window (`/tb/dut/valid`).
- Operators: `!`, `&&`, `||`, parentheses. No arithmetic, no comparison operators, no temporal operators.
- `min_duration` (with `unit`) requires the predicate to hold for at least that long, which is how you
  express "stuck for more than 3 cycles at 10 ns".

Examples:

```
/tb/dut/wr_valid && !/tb/dut/wr_ready                     first stall
(awvalid && !awready) || (wvalid && !wready)               any blocked write channel
rst_n && !/tb/dut/fsm.busy                                 idle after reset    (min_duration: 20ns)
```

## Flow

1. Add the signals to the window (`verdi_signals_add`) — the predicate resolves against window signals.
2. `verdi_window_scan` with a deliberately small `bins` first (e.g. 200) to see whether the pattern exists
   at all, then raise `bins` to localise. Report `truncated` and the computed `step`.
3. Once the predicate is the right one, freeze it: `verdi_check_define {name, predicate, params}` →
   `verdi_check_run {check_id}`. The check stores the session/window/range, so it can be re-run after a
   re-simulation and compared.
4. For an exact cycle count of a hit, take `verdi_transitions_get` around the hit and quote the times.

## Turning a hit into a number

A scan gives you a time. To make it evidence:

- `verdi_value_get` at that time for every signal in the predicate → the actual values.
- `verdi_transitions_get` on the *controlling* signal (usually read/valid) to show when it last moved.
- `verdi_change_stats` over the window to prove the signal was otherwise quiet.

## Limits (verified)

- **EventSequence / Temporal Flow View are GUI-only.** `tfgNewViewer -win <nWave>` returns `0` because it
  needs an existing TFV window; there is no scriptable way to create the first one. Do not promise
  `wvEventSequenceSearchNext`-style searches.
- `bins` caps at 5000 and `max` at 10000 in `window_scan`; the sampler step is `(end-start)/bins`.
- Sampling can miss a one-cycle pulse. Say "sampled", never "always/never", unless transitions back it.

## Reporting

```
predicate:  /tb_sync_fifo/wr_valid && !/tb_sync_fifo/wr_ready   (min_duration 0)
range:      0..240 ns, bins 500, step 0.48 ns, truncated=true
hits:       17 sampled points, first 115.43 ns   (VERIFIED sampled)
exact:      wr_valid rose at 115.0 ns, wr_ready never rose until 240 ns   (VERIFIED, NPI transitions)
check:      wr_stall (7dcf91b9) re-runnable
caveat:     sampled — a shorter-than-step pulse between points could be missed
```
