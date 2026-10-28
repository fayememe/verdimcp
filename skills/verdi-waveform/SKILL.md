---
name: verdi-waveform
description: Use when setting up or inspecting an nWave waveform view — opening an FSDB, listing/adding/removing signals, moving the cursor, and rendering a small bounded waveform. Covers time units, Tcl-safe bus names, and large-FSDB limits.
---

# Waveform workflow

## Order

1. `verdi_sessions_list` / `verdi_session_info`.
2. `verdi_windows_list` or `verdi_window_create`.
3. `verdi_fsdb_open` — open the FSDB; records it for NPI.
4. `verdi_signals_list` — search with `offset`/`limit`; respect `truncated`.
5. `verdi_signals_add` — absolute paths; bus names are quoted automatically.
6. `verdi_cursor_set` — absolute time/unit or `begin`/`end`.

## Rendering

- `verdi_waveform_render` is **bounded**: ≤16 signals, ≤1000 bins, small time window. It is for targeted views, not 128-signal full windows.
- For a large FSDB / many signals, use `verdi_capture_annotate` (GUI capture) or aggregated `verdi_change_stats` + `verdi_window_scan`; a 128-signal headless render was measured slower than GUI (903 MB FSDB, 2026-10-18).
- `verdi_evidence_compare` captures two regions side by side; it also uses GUI capture.

## Time units

- Use the window unit returned by `wvGetWindowTimeUnit`; tool inputs take `time` + optional `unit`.
- The demo FSDB is `1ps`; 40 ns = 40000 ticks. Never silently assume ns.

## Rules

- Value queries require the signal to be added to the target window.
- One batch `verdi_signals_add` beats many single-signal calls.
- X/Z classification belongs to `verdi-xz-debug`; handshake analysis to `verdi-bus-debug`.
