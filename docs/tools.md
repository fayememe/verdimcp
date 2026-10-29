# Tool reference

39 tools. Every result is wrapped in an envelope:

```json
{"ok": true, "data": {...}, "meta": {"tool": "verdi_value_get", "elapsed_ms": 34}}
```

Failures use `{"ok": false, "error": {"code": "...", "message": "...", "details": {...}}}`.
`session_id` may be omitted whenever exactly one session is `up`.

## Session and window

| Tool | Input | Output |
|---|---|---|
| `verdi_capabilities` | — | `{verdi_home, engines:{gui,npi}, tools:[{name,status,notes}]}` |
| `verdi_sessions_list` | — | `{sessions:[{id,label,state,port,pid,fsdb,display,cwd}]}` |
| `verdi_session_info` | `{session_id?}` | one session entry in full |
| `verdi_session_start` | `{label?, args:[...], display?, port?, timeout?}` | `{session_id, port, pid, display}` |
| `verdi_session_stop` | `{session_id?}` | `{stopped:true}` |
| `verdi_windows_list` | `{session_id?}` | `{windows:[{window_id,xid,kind}]}` |
| `verdi_window_create` | `{session_id?}` | `{window_id, xid}` |
| `verdi_window_raise` | `{session_id?, window_id?}` | `{window_id, xid, raised}` |
| `verdi_window_screenshot` | `{session_id?, window_id, inline?}` | `{path,width,height,bytes,sha256,xid}` + image content |

`verdi_window_screenshot` returns the PNG as MCP image content when it is ≤2 MB.

## Waveform

| Tool | Input | Output |
|---|---|---|
| `verdi_fsdb_open` | `{window_id, path, time_unit?}` | `{path, unit}` |
| `verdi_signals_list` | `{window_id?, search?, kind?, offset?, limit?, delim?}` | `{items[], total, truncated, next_offset}` |
| `verdi_signals_add` | `{window_id?, signals[]}` | `{requested[], ok, result}` |
| `verdi_signals_remove` | `{window_id?, signals[]}` | `{requested[], ok}` |
| `verdi_cursor_set` | `{window_id?, time?, unit?, begin?, end?}` | `{time, unit}` |
| `verdi_value_get` | `{window_id?, signal, time?, unit?, format?, leading_zeros?}` | `{signal,time,value,unit,source}` |
| `verdi_transitions_get` | `{window_id?, signal, start?, end?, unit?, max?, with_values?, engine?}` | `{signal,transitions[],truncated,source,engine,fsdb}` |
| `verdi_xz_scan` | `{window_id?, fsdb?, signals?, scope?, start?, end?, unit?, max?, engine?}` | `{candidates[],truncated,source,engine,fsdb,signals_scanned}` |

`engine` is `auto` (default), `gui` or `npi`. `format` accepts `Hex`, `Bin`, `Oct`, `Ascii`, `UDec`,
`2Com`, `1Com`, `SMag`. X/Z are preserved as strings, leading zeros are kept by default.

**Naming**: GUI uses `/tb/dut/sig`; NPI uses `tb.dut.sig` with no leading slash. The tools normalize both.

## Design

| Tool | Input | Output |
|---|---|---|
| `verdi_scopes_list` | `{window_id?, root?, limit?}` | `{scopes[], truncated}` |
| `verdi_drivers_get` | `{signal, scope?, levels?=1}` | `{leaf_pins[], report_path}` |
| `verdi_fanin_get` | `{signal, scope?, levels?=1}` | `{leaf_pins[], report_path, note?}` |
| `verdi_fanout_get` | `{signal, scope?, levels?=1}` | `{leaf_pins[], report_path}` |
| `verdi_source_get` | `{signal?, file?, line?, lines?}` | `{file, line, snippet}` |
| `verdi_cone_capture` | `{signal, mode?, scope?, levels?, time?, unit?, keep_open?, footer?}` | `{window_id, mode, trace_applied, image:{path,width,height,bytes,sha256}, text_available:false, note}` |

Requires a session started with `-f` or `-dbdir`; otherwise `not_supported`.

`cone_capture.mode`:

| mode | what it traces |
|---|---|
| `driver` | direct drivers |
| `load` | loads |
| `fanin` | input cone (`levels>1` → `*ByLevel`) |
| `fanout` | output cone (`levels>1` → `*ByLevel`) |
| `x` | the X cone at `time`, then `schTraceX` |
| `active_fanin` | the active cone at `time` |

Cones are **images**. `text_available` is always `false`; see [limits.md](limits.md).

## Protocol-agnostic primitives

No protocol words appear in verdimcp. Roles are free-form strings you choose.

| Tool | Input | Output |
|---|---|---|
| `verdi_signal_map_put` | `{name, signals:{role: path}}` | `{name, roles[]}` |
| `verdi_signal_map_get` | `{name}` | profile |
| `verdi_signal_map_list` | — | `{profiles[]}` |
| `verdi_handshake_beats` | `{channel:{clock?,valid,ready,data?,id?,strobe?,last?}, start?, end?, unit?, max?}` | `{beats[], truncated}` |
| `verdi_change_stats` | `{signals[], start?, end?, unit?}` | `{stats:[{signal,count,first_value,last_value}], engine, fsdb}` |
| `verdi_window_scan` | `{predicate, start?, end, unit?, bins?, max?, min_duration?}` | `{predicate,hits[],truncated,bins,step,source}` |
| `verdi_check_define` | `{name, predicate, params}` | `{check_id, name}` |
| `verdi_check_run` | `{check_id}` | `{check_id, name, result}` |

Predicate grammar: identifiers, `!`, `&&`, `||`, parentheses. No arithmetic, no temporal operators.
`min_duration` expresses "held for at least N".

## Evidence

| Tool | Input | Output |
|---|---|---|
| `verdi_evidence_create` | `{session_id?, title}` | `{evidence_id, session_id}` |
| `verdi_capture_annotate` | `{evidence_id, signals[], start, end, unit?, annotations[]}` | `{item_id, data:{screenshot, annotations[], roi}}` |
| `verdi_waveform_render` | `{evidence_id, signals[≤16], end, start?, unit?, bins≤1000, annotations?}` | `{path, svg_path, width, height, bytes, signals, bins}` |
| `verdi_evidence_add` | `{evidence_id, type, data, query_used?}` | `{item_id, type, data, query_used}` |
| `verdi_waveform_compare` | `{window_id?, signals[], against_fsdb?[], two?, capture?}` | `{window_id, compared, image?, text_available:false, note, warning}` |
| `verdi_evidence_compare` | `{evidence_id, signals[], roi_a, roi_b, unit?}` | `{item_id, data:{path, bytes, roi_a, roi_b}}` |
| `verdi_evidence_report` | `{evidence_id, format?}` | `{path, format, items}` |

Annotation types: `marker`, `comment`, `highlight`. Native nWave objects are used when scripting allows;
each annotation reports `applied: true|false`.

## Escape hatch

| Tool | Input | Output |
|---|---|---|
| `verdi_tcl_exec` | `{commands[1..20]}` | `{results[], events[]}` |

Disabled unless the server process has `VERDI_ALLOW_RAW=1`. Single-line commands only; each one is written
to `audit.jsonl`. It exists because Verdi's Tcl surface is far larger than these 39 tools — and Tcl can
`exec` arbitrary processes, which is why it is off by default.

## Version notes

Verified against Verdi `W-2024.09-SP1`. Commands used by the design and cone tools
(`schCreateWindow`, `schTrace*`, `schCapture`, `schTraceX`) are long-standing, but Verdi does change
defaults between releases; run `scripts/acceptance.sh` on your installation before trusting a result.
