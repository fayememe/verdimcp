# Limits

Every entry below was probed on Verdi `W-2024.09-SP1` and is enforced in code. If a command does not
return the data, the tool says so; a caller that trusts a made-up answer wastes more time than one that hits
`not_supported`.

## Verified negatives

| Want | Reality | Where it is enforced |
|---|---|---|
| Pin list for a multi-level cone | `schTrace*ByLevel` results are rejected by `schDumpTracedLeafPin` (`0 The previous action was not tracing driver, load or connectivity`). Tools return `cone_paths` + `degraded: true` | `mcp/src/tools/design.ts` |
| Text dump of an X cone | `schTraceX` succeeds but the result is not dumpable; `schCreateWindow -X -dump` returns `0` and writes no file | `cone_capture` → `text_available: false` |
| Text dump of an active cone | `schCreateWindow -activeFanIn` works, no textual export | same |
| Textual waveform diff | `wvCompareResult -file` writes `You must open another waveform pane before running this option!`; the second pane is not scriptable | `waveform_compare` → `text_available: false` |
| Temporal Flow View | `tfgNewViewer -win <nWave>` returns `0`; it needs an existing TFV window, and the first one cannot be created from Tcl | no tool offered |
| Event-sequence search | `wvEventSequenceSearchNext` requires an EventSequence window (same problem) | no tool offered |
| Register queries | `vc_apps_list_registers` does not exist in this installation (empty `info commands`) | no tool offered |
| Native X listing | `listxListX -all` returns an empty string | not used |
| Fan-in leaf pins | `schTraceFanIn` returns a trace result that cannot be dumped; level-1 fan-in is mapped to `schTraceDriver` and the response carries a `note` | `verdi_fanin_get` |

## Operational hazards

- **Comparison after cones killed Verdi once.** Running `verdi_waveform_compare` in a session that had
  already opened nSchema windows terminated the Verdi process (`connect to port ... failed`). Isolated
  retries (fresh session, three parameter variants) never reproduced it, and reordering the acceptance
  suite fixed it. The tool now returns `warning` when schematic windows exist, and the skills require
  comparing first or opening a fresh session. Nothing restarts a session silently — a dead GUI is a
  visible loss for whoever was using it.
- **Cones are slow and expensive.** 10–35 s each, plus memory. One cone per question, not a sweep.
- **A live FSDB only shows flushed data.** With `$fsdbDumpflush` every 1024 cycles the reader saw
  `max_time` grow monotonically and `is_completed` flip at the end; without it, VCS buffers and a 7 KB file
  can already report the full range. `fsdb.is_completed` is the field that settles it.
- **GUI transitions skip glitches.** `wvSearchNextBySignal` does; NPI does not. The `engine` block says
  which one produced the list.

## Deliberate scope

Not implemented, and not planned:

| Not doing | Why |
|---|---|
| Protocol decoders (AXI/AHB/APB state machines) | verdimcp must contain no protocol semantics; rules live in skills |
| Log parsing, `read_log`, "jump before error" | that is a different tool's job, not a waveform session |
| VCD/FST support | not Verdi |
| Static analysis / source graphs | not Verdi |
| UVM transaction debug (`uvm*`, 82 commands) | needs UVM testbench integration; not worth the surface |
| Power / CDC / coverage products | separate Verdi products, outside this MCP's story |
| Throughput / latency / outstanding analysis | no tools exist; the `verdi-performance` skill says so rather than deriving it from change counts |
| A browser waveform viewer | contradicts the premise of driving the real GUI |

## Platform notes

- Requires `libnclt` (the `-serverPort` channel). A Verdi built without it cannot be driven.
- The GUI half needs a display and a readable `XAUTHORITY`. Over SSH: `ssh -X`, then check `echo $DISPLAY`.
- Design trace and cones need `-f` or `-dbdir`. With `-ssf` only, waveforms work and structure does not.
- `-dbdir` (KDB) additionally needs `VCS_HOME`, or Verdi exits at startup.
- Verified on `W-2024.09-SP1`; other releases may differ. Run `scripts/acceptance.sh` to find out.

## How to report a new limit

Add a row with the command, the observed result, and where the code enforces it, then add an acceptance
check that asserts the negative behaviour. A limit without a test becomes a rumour.
