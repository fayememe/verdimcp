---
name: verdi-cone-evidence
description: Use when the answer needs a schematic/cone artifact rather than a number — "show the logic that produces this", driver/load/fan-in cones, X cones, active fan-in. Covers capture hygiene, how to read a cone image, and the verified limit that cones are images, never text.
---

# Cone evidence (nSchema capture)

## Scope

**In:** produce a picture of the logic cone for one signal, at a stated time, and state what it proves.
**Out:** textual connectivity graphs (Verdi will not give you one — see the limits), and multi-level cone
pin lists (verified negative; `*ByLevel` results are not dumpable).

## When a cone is the right artifact

- "Why is this X?" → `mode: "x"` (needs a time).
- "What feeds this?" → `mode: "driver"` or `mode: "fanin"`.
- "What does this corrupt?" → `mode: "fanout"`.
- "Which mux branch was active at cycle N?" → `mode: "active_fanin"` with `time`.
- A human will look at the answer, or the bug report needs a picture.

Do **not** reach for a cone when a number would do. A cone is slow (10–35 s), mutates the GUI, and
consumes memory. `transitions_get` is the cheaper answer to "what happened".

## Flow

1. `verdi_windows_list` — a session must exist. The design library must be loaded (`-f` / `-dbdir`);
   otherwise the tool returns `not_supported`. Check with `verdi_drivers_get` first if unsure.
2. `verdi_cone_capture {signal, mode, time?, unit?, levels?, keep_open?, footer?}`.
   - `signal` accepts `/a/b` or `a.b`; it is normalized.
   - `time` is only meaningful for `mode: "x"` / `mode: "active_fanin"`; it is converted to window ticks.
   - `levels > 1` switches to `*ByLevel`, which still yields **no leaf pins** — only a picture.
   - The tool closes the window unless `keep_open: true` (leave it open when the user will look at it).
3. Read the response:

```json
{"window_id":"...","mode":"x","trace_applied":true,
 "image":{"path":".../cone-x-....png","width":1711,"height":618,"bytes":34947,"sha256":"..."},
 "text_available":false}
```

4. Compare `sha256` across runs to prove two captures are actually the same picture.

## Reading a cone image

State only what the pixels support:

- Which signals/instances are visible (names are legible in the capture).
- Which nets are highlighted/marked as the traced or X path.
- Whether the traced cone stops at a register, a primary input, a memory, or a constant.

Then separate the layers:

- **VERIFIED:** the capture exists, has this size/hash, and shows these labels.
- **INFERRED:** "therefore the X originates at `bank3.q_reg`, which is never reset".
- **NOT PROVEN:** anything outside the captured frame — the tool does not dump the full cone.

## Capture hygiene (important)

- **Ordering hazard (observed):** running `verdi_waveform_compare` in a session that already opened
  nSchema windows killed Verdi W-2024.09 once (`connect to port ... failed`). Run comparisons **before**
  cone captures, or in a fresh session. `verdi_waveform_compare` warns when schematic windows already exist.
- One cone per call, then let the tool close it. Do not pile up schematic windows.
- A cone capture costs 10–35 s; warn the user before a multi-signal sweep.
- Captures land in `~/.local/state/verdimcp/evidence/`; copy the ones that belong to a bug report.

## Limits (verified, quote them when refusing)

| Want | Reality |
|---|---|
| Text list of cone pins for X / active / `*ByLevel` | ❌ `schDumpTracedLeafPin` refuses; image only |
| `driver` / `load` leaf pins at level 1 | ✅ `verdi_drivers_get` / `verdi_fanout_get` (text) |
| Temporal Flow View of the cone | ❌ `tfgNewViewer` returns 0 — needs an existing TFV window, not scriptable |
| Schematic that survives the call | ✅ `keep_open: true` |

## Output template

```
mode:      x, time 0 ns   (VERIFIED args)
artifact:  cone-x-<sid>-<wid>-<ts>.png  1711x618  34947 B  sha256 f8f6e5…
shows:     rd_data[7:0] | ComboOp2 | SyncFifo_mem · X path highlighted
infers:    X enters from the memory read port before reset release
limits:    no textual cone; frame covers only the traced region
```
