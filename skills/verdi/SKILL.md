---
name: verdi
description: Use when observing or operating a running Verdi/nWave session through the verdi MCP tools. Covers session selection, safety, GUI-vs-NPI routing, protocol-agnostic primitives, evidence tools, and degradation.
---

# Verdi session workflow

Use this skill whenever the task touches a running Verdi/nWave session.

## Safety first

- Only operate sessions in the current user's `verdi-session` registry. Never attach to, signal, or kill another user's Verdi.
- Prefer read-only tools. `window_create`, `signals_add/remove`, `cursor_set`, `fsdb_open` and `capture_annotate` change the GUI; confirm the target session when more than one is running.
- No raw Tcl tool exists. Do not invent one.

## Core flow

1. `verdi_capabilities` — GUI/NPI availability and verified tools.
2. `verdi_sessions_list` → `verdi_session_info` — pick a session. If exactly one is `up`, `session_id` may be omitted.
3. `verdi_windows_list` — inspect nWave windows; `verdi_window_create` only when needed.
4. `verdi_window_screenshot` — read-only visual evidence.

## Routing

- **Interactive GUI**: FSDB open / signals / cursor / value / design trace.
- **Headless NPI**: `change_stats`, `window_scan`, `handshake_beats`, bounded `waveform_render`, X/Z scans. NPI needs the FSDB opened once (`verdi_fsdb_open`) or a session started with `-ssf`.
- **Large FSDB**: do **not** request a 128-signal full-window headless render (measured slower than GUI). Use GUI capture or aggregated primitives; see `verdi-waveform`.

## Protocol-agnostic primitives

- `verdi_signal_map_put/get/list`: save free-form role→path profiles (e.g. valid/ready/data). The server stores no protocol semantics.
- `verdi_handshake_beats`: cycles where valid & ready are both high, with data/id/strobe/last.
- `verdi_change_stats`: per-signal change count + first/last values (aggregate only).
- `verdi_window_scan`: boolean predicate (`!`, `&&`, `||`, parentheses) over sampled values, optional `min_duration`.
- `verdi_check_define` / `verdi_check_run`: persist and re-run a predicate deterministically.

## Evidence

`verdi_evidence_create` → `verdi_capture_annotate` / `verdi_waveform_render` / `verdi_evidence_add` → `verdi_evidence_compare` → `verdi_evidence_report`. Use `verdi-evidence` for the full flow.

## Errors

`session_not_found` / `ambiguous_session`: list and choose explicitly.
`session_down`: the Verdi process is gone.
`not_supported`: missing prerequisite (FSDB, design library, native annotation) — report it, never fabricate.
