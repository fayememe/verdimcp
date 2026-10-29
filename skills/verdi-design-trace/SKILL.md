---
name: verdi-design-trace
description: Use when tracing a signal to its driver, fan-in cone, loads/fan-out, or RTL source. Covers the three design-library paths (-dbdir KDB, -f filelist, none), verified text-vs-image limits, and when to escalate to a cone capture.
---

# Design trace / source

## Scope

**In:** "who drives this", "what does this feed", "which line of RTL is this", "what is in this scope".
**Out:** graphical cone artifacts (→ `verdi-cone-evidence`), functional protocol rules (→ `verdi-bus-debug`).

## Three paths, best first

1. **`-dbdir simv.daidir` — VERIFIED.** Needs VCS to have built with `-kdb -debug_access+all`, and
   `VCS_HOME` must be set or Verdi exits. Matches the elaboration that produced the FSDB — prefer it.
2. **`-f filelist.f` — VERIFIED.** Verdi re-elaborates sources. Works, but can drift if the RTL changed
   after the FSDB was dumped. Say which one you are on.
3. **Neither — `not_supported`.** Only time-correlated candidates are allowed, clearly labelled weak.

Check once with `verdi_drivers_get` on a known signal; if it returns `not_supported`, stop trying.

## Tools and what they actually return

| Tool | Backing command | Output |
|---|---|---|
| `verdi_scopes_list` | `wvDumpSignalListToFile -scope` | scope paths under the FSDB root |
| `verdi_drivers_get` | `schTraceDriver` + `schDumpTracedLeafPin` | `leaf_pins[]` + `report_path` |
| `verdi_fanout_get` | `schTraceLoad` + dump | `leaf_pins[]` + `report_path` |
| `verdi_fanin_get` | `schTraceDriver` at level 1 | `leaf_pins[]` + `note` |
| `verdi_source_get` | `srcCreateWindow` + `srcGetCaretFile/Line` | `{file, line, snippet}` |

## Verified limits — quote these instead of guessing

- **`levels > 1` has no leaf pins.** `schTrace*ByLevel` results are not accepted by
  `schDumpTracedLeafPin` ("previous action was not tracing driver, load or connectivity") and
  `schTraceReport` writes nothing. The tool returns `cone_paths` + `degraded: true`. If you need the
  multi-hop picture, capture the cone as an image (`verdi-cone-evidence`).
- **`verdi_fanin_get` at level 1 is mapped to `schTraceDriver`**, because `schTraceFanIn` results are also
  not dumpable. One-level fan-in equals the direct driver set; the response carries a `note` saying so.
- **Text is only for level-1 driver/load.** Everything else is an image.

## Follow a cone by hand (when levels matter)

```
hop 1: verdi_drivers_get {signal: A}        -> leaf pins [B, C]
hop 2: verdi_drivers_get {signal: B}        -> leaf pins [D]
hop 2: verdi_drivers_get {signal: C}        -> leaf pins [E]
```

N calls, ~3.5–4 s each. Stop when you hit a register, a primary input, or the scope you care about.
State the hop count and that each hop is an independent snapshot.

## Source

- `verdi_source_get {signal}` opens the scope in nTrace and reads the caret line.
- `verdi_source_get {file, line, lines}` reads a file directly — no session needed, use it for citing RTL.
- The snippet is a pointer, not a proof. Quote the line numbers so a human can check.

## Rules

- Report the real `report_path`; never invent a driver/load relationship.
- Design names are dot-separated; the tools normalize `/`.
- A leaf pin like `tb.dut.fifo(@1):SigOp8:38:38:ComboMemory_mem[0:3].CKR_clk` is a **pin**, not a signal
  you can query with `value_get`. Map it to an FSDB signal with `verdi_signals_list` before reading values.
- If the design library is missing, say "structure unavailable", then add a time-correlation
  heuristic labelled INFERRED.
