---
name: verdi-xz-debug
description: Use when a signal is X or Z. Classify the cause (undriven, uninitialized, tri-state, propagation), find the first X/Z with verdi_xz_scan / NPI, and report uncertainty instead of guessing.
---

# X/Z debug

## Classify first

Ask/derive which category is plausible:

1. **Undriven** — no driver, floating net, missing connection.
2. **Uninitialized** — register/memory not reset before read.
3. **Tri-state** — bus with no active driver (`z`), enable/select wrong.
4. **Propagation** — X/Z entered upstream and fanned out.

## Flow

1. `verdi_sessions_list` / `verdi_session_info`.
2. `verdi_fsdb_open` (records FSDB for NPI).
3. `verdi_signals_list` to resolve exact absolute paths.
4. `verdi_xz_scan` over the suspect signals/scope and time range:
   - NPI is the default; `source:"npi"` and `truncated` must be reported.
   - GUI fallback is budgeted sampling and sets `degraded=true`; treat it as a candidate list, not a complete scan.
5. `verdi_value_get` at the first X/Z time for exact values (X/Z preserved as strings).
6. If a design library is available (`-f` or `-dbdir`), use `verdi_drivers_get` / `verdi-fan-in` to find the source; otherwise return `not_supported` and say structure is unavailable.
7. Use `verdi_transitions_get` to see whether the signal ever leaves X/Z; use `verdi_change_stats` to gauge activity.

## Rules

- Never convert X/Z to 0. Report the literal string (`x`, `z`, `xx`, `zz`, …).
- Distinguish “no value change” from “constant X”: `change_stats` count + `value_get` at start/end.
- A single X/Z observation is evidence, not root cause. State the category as `likely`/`uncertain` when the design structure is unavailable.
- NPI naming: dot-separated, no leading `/`; GUI naming uses `/`. The tools convert; do not mix raw names.
