---
name: verdi-waveform
description: Use when setting up or inspecting a waveform view — opening an FSDB, listing/adding/removing signals, moving the cursor, reading values and transitions, and rendering a small bounded picture. Covers time units, naming, engine provenance, and large-FSDB limits.
---

# Waveform workflow

## Scope

**In:** get a value, a transition list, a cursor position, a signal list, or a small picture.
**Out:** interpreting X/Z (→ `verdi-xz-debug`), handshakes (→ `verdi-bus-debug`), structure (→ `verdi-design-trace`).

## Order

1. `verdi_sessions_list` / `verdi_session_info`.
2. `verdi_windows_list`, or `verdi_window_create` (changes the GUI).
3. `verdi_fsdb_open` — opens the FSDB and records it for NPI. A session started with `-ssf` already has one.
4. `verdi_signals_list {search, offset, limit, kind}` — resolve exact paths; respect `truncated` and `next_offset`.
5. `verdi_signals_add {signals[]}` — one batch, not one call per signal.
6. `verdi_cursor_set {time, unit}` or `{begin:true}` / `{end:true}`.
7. Read: `verdi_value_get`, `verdi_transitions_get`, `verdi_xz_scan`, `verdi_change_stats`.

## Which read tool

| Question | Tool | Why |
|---|---|---|
| value at one time | `verdi_value_get` | GUI, exact, preserves X/Z and leading zeros |
| every edge of one signal | `verdi_transitions_get` | NPI exact; GUI skips glitches |
| how active is a signal | `verdi_change_stats` | aggregate count + first/last, never the raw stream |
| where are the X/Z | `verdi_xz_scan` | NPI enumeration, or budgeted GUI sampling |
| picture of a few signals | `verdi_waveform_render` | bounded ≤16 signals / ≤1000 bins |
| picture of the real GUI state | `verdi_capture_annotate` / `verdi_window_screenshot` | pixels of what the engineer sees |

## Read the provenance, always

Each query returns `engine` and `fsdb`:

```json
"engine": {"requested":"auto","used":"npi","reason":"auto: NPI (max=5000 > 200, fsdb known)",
           "elapsed_ms":655,"alternatives":["gui"],"fallback":false,"switch_hint":null},
"fsdb":   {"max_time":240,"is_completed":true,"covers_requested_range":true,"warning":null}
```

- `engine.used` tells you whether glitches could have been skipped (`gui` can).
- `engine.fallback: true` means NPI failed and you are reading a GUI answer — say so.
- `engine.switch_hint` is only present when the call passed 15 s and the other engine is usable.
  It is advice, not an automatic retry.
- `fsdb.is_completed: false` invalidates any "never happened after `max_time`" conclusion.

## Time units

- The window unit comes from `wvGetWindowTimeUnit`; FSDB scale from `scale_unit` (usually `1ps`).
- Always pass `unit` when the number comes from a human ("40 ns", not 40).
- The demo FSDB is `1ps`: 40 ns = 40000 ticks. Never silently assume ns.

## Naming

- GUI: `/tb/dut/sig`, buses `[7:0]`. NPI: `tb.dut.sig`, no leading `/`. The tools convert; do not mix
  raw names in one call.
- Bus names with `[` `]` are quoted automatically; do not hand-escape them.
- `verdi_signals_list` returns what the FSDB actually contains — trust it over the RTL source when they differ.

## Rendering limits

- `verdi_waveform_render` is bounded (≤16 signals, ≤1000 bins) by design.
- A 128-signal full-window headless render was measured **slower** than a GUI capture (30.6 s vs 9.7 s at
  903 MB). For wide views use `verdi_capture_annotate` / `verdi_window_screenshot`, or aggregate with
  `change_stats`. See `verdi-performance`.

## Degradation

| Missing | Behaviour |
|---|---|
| FSDB path | NPI unusable → `not_supported`; GUI still answers if signals are in the window |
| signal not in window | `value_get` errors with `hint: call verdi_signals_add first` |
| GUI gone | NPI-only reads still work if the FSDB path is known |
| `-ssf` window holds a different FSDB | call `verdi_fsdb_open` on the target window first |

## Reporting

Quote `source`/`engine.used`, the unit, and whether the list was `truncated`. A transition list without
its engine and range is not evidence.
