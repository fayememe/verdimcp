---
name: verdi-design-trace
description: Use when tracing a signal to its driver, fan-in cone, loads/fan-out, or source. Supports -dbdir (VCS KDB, VERIFIED) and -f filelist (VERIFIED); without a design library the tools return not_supported.
---

# Design trace / source

## Three paths (best first)

1. **`-dbdir simv.daidir` — VERIFIED (2026-10-18)**
   - Build with VCS `-kdb -debug_access+all`; `simv.daidir/simv.kdb` + `kdb.elab++/` must exist.
   - Start: `VCS_HOME=/opt/synopsys/vcs/W-2024.09-SP1 verdi -dbdir simv.daidir -ssf <fsdb> -serverPort <port>`.
   - `VCS_HOME` is mandatory; without it Verdi exits.
   - Driver/load/source verified. `schTraceFanIn` returns a trace result but `schDumpTracedLeafPin` rejects fan-in ("previous action was not tracing driver, load or connectivity") — report the trace result, not a leaf-pin list.
2. **`-f filelist.f` — VERIFIED**: Verdi re-elaborates sources; usable, but can drift if sources changed after the FSDB.
3. **Neither** — return `not_supported`; only time-correlated candidate signals are allowed, clearly labeled weak heuristics.

## Tools

- `verdi_scopes_list`
- `verdi_drivers_get`
- `verdi_fanin_get` (1 level)
- `verdi_fanout_get` (`schTraceLoad`)
- `verdi_source_get` (file+line, or signal→scope→caret)

## Rules

- Design names are dot-separated; the tools normalize `/` paths.
- `levels > 1` returns `not_supported` (`schTrace*ByLevel` unverified).
- `schDumpTracedLeafPin` must immediately follow the trace; the tool does this.
- Report the actual `report_path`; do not invent driver/load relationships.
- Prefer `-dbdir` over `-f` when both exist: it matches the FSDB-producing elaboration.
