# Verdi Web API — Reference Design

Status: **design reference** (API shape is proposed; only the parts marked VERIFIED were executed on this host).
Target host: `f29`, Verdi W-2024.09-SP1.
Companion docs: `00-recon.md`, PoC in `/tmp/opencode/verdi_poc/`.

Evidence labels used below:

- **VERIFIED** — executed end-to-end on this host (transport, nWave setup, screenshot, session registry).
- **DOCUMENTED_ONLY** — command exists in the local Tcl/FSDB docs, not executed here.
- **PROPOSED** — API contract defined by this document; implementation may not exist yet.

---

## 1. Purpose

Expose a **local, single-user, HTTP/JSON interface** over one or more running Verdi GUI
sessions so that agents and scripts can:

1. discover and control live Verdi sessions,
2. query waveform data and FSDB contents,
3. query design structure and source links (when a design DB is loaded),
4. drive the GUI the engineer is watching (add signals, move cursor, open views),
5. receive asynchronous notifications (cursor moves, window events).

Non-goals: multi-tenant remote service, replacing Verdi, bypassing licensing, editing RTL,
or storing FSDB/RTL outside the machine.

---

## 2. Architecture

```
            ┌───────────────┐        HTTP/JSON (127.0.0.1)        ┌──────────────┐
 agents ───▶│ verdi-web     │────── serialized command queue ────▶│ broker       │
 scripts    │ (REST + SSE)  │                                      │ (1/session)  │
            └───────┬───────┘                                      └──────┬───────┘
                    │                                                     │ libnclt socket
                    │ registry (~/.local/state/verdi-sessions)            ▼
                    │                                              ┌──────────────┐
                    └────────── read-only ────────────────────────▶│ Verdi GUI    │
                                                                   │ -serverPort N│
                                                                   └──────────────┘
                                                                          │
                                              FSDB Reader / NPI (no GUI) ─┘
```

Key rules:

- **One broker per Verdi session.** It owns the only `libnclt` connection and serializes
  commands (the server's multi-client semantics are **not** proven; see §17).
- **The GUI is the session.** Closing the Verdi window terminates the API's control channel.
- **Read-only paths bypass the GUI**: FSDB Reader for waveform values, NPI for design queries
  (when available). This keeps bulk scans from blocking the engineer's view.
- **Everything binds loopback only.**

---

## 3. Conventions

### 3.1 Base

```
http://127.0.0.1:<web_port>/api/v1
```

Default `web_port` is allocated from 12000–12999 and written to
`~/.local/state/verdi-web/port`.

### 3.2 Authentication

- Token file: `~/.local/state/verdi-web/token` (mode `0600`).
- Header: `Authorization: Bearer <token>`.
- No token → `401`. Token is generated at first start.
- The API is **not** exposed beyond loopback; do not port-forward it.

### 3.3 IDs

| ID | Meaning |
|---|---|
| `sid` | Verdi session (one GUI process) |
| `wid` | nWave/design window handle (Verdi's internal id, e.g. `372eb2e0`) |
| `fid` | FSDB handle opened by the headless reader |
| `jid` | async job |

Window handles are **not** X ids; use `GET /sessions/{sid}/windows/{wid}` to obtain `xid`.

### 3.4 Time

All times are integers in the file's time unit unless `unit` is given.

```json
{"time": 100, "unit": "ns"}
```

Never assume ns. Query `GET /waves/{wid}/time-unit` first.

### 3.5 Errors

```json
{
  "error": {
    "code": "verdi_command_failed",
    "message": "invalid command name \"wvGetSignalList\"",
    "detail": {"tcl_result": "invalid command name ...", "command": "wvGetSignalList -win ..."},
    "retryable": false
  }
}
```

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_request` | malformed parameter |
| 401 | `unauthorized` | missing/bad token |
| 404 | `not_found` | sid/wid/fid unknown |
| 409 | `session_state` | session not up / window closed |
| 422 | `verdi_command_failed` | Tcl-level error (Verdi returned failure) |
| 429 | `busy` | per-session queue timeout |
| 500 | `internal` | broker/transport failure |
| 501 | `not_supported` | command not available in this Verdi version/DB |

A Tcl command that exists but returns an error is **422**, not 500.

---

## 4. Capability discovery

```
GET /capabilities
```

```json
{
  "verdi": {"version": "W-2024.09-SP1", "home": "/opt/synopsys/verdi/W-2024.09-SP1"},
  "features": {
    "session_control": "verified",
    "nwave_setup": "verified",
    "screenshot": "verified",
    "wave_value": "documented_only",
    "wave_transitions": "documented_only",
    "fsdb_reader": "documented_only",
    "design_trace": "untested",
    "schematic": "untested",
    "source_link": "untested",
    "events": "verified"
  },
  "design_db_loaded": null,
  "notes": ["design_trace requires an elaborated design DB"]
}
```

Clients MUST check this before promising a workflow.

---

## 5. Session API

Sessions are Verdi GUI processes launched with `-serverPort`.

### 5.1 List

```
GET /sessions
```

```json
[
  {
    "sid": "0352f7d7",
    "port": 11101,
    "pid": 2993308,
    "state": "up",
    "label": "rram-x-debug",
    "cwd": "/home/faye/work/ambiq/rram/t/sim",
    "fsdb": ["behav.fsdb"],
    "design": ["dut.f"],
    "display": "localhost:10.0",
    "started": "2026-10-17T03:41:07-07:00",
    "verdi_version": "W-2024.09-SP1"
  }
]
```

`state`: `up` | `starting` | `down` (port not listening) | `stale` (pid gone / cmdline mismatch).

**VERIFIED** by the PoC registry (`verdi-session list`).

### 5.2 Create

```
POST /sessions
{"label": "opt", "fsdb": "x.fsdb", "design": ["dut.f"], "args": ["+define+SIM"], "detach": true}
→ 201 {"sid": "...", "port": 11101, "state": "starting"}
```

Implementation: port allocator + `verdi -serverPort N <args>`; wait for port; health-check.
**VERIFIED** (launcher allocates 11000–11999, concurrent starts got distinct ports).

### 5.3 Get / Delete

```
GET    /sessions/{sid}        → full record
DELETE /sessions/{sid}        → graceful close (SIGTERM, verify pid+cmdline, then SIGKILL)
```

Only kills the process whose cmdline contains `-serverPort <port>` (**VERIFIED** guard).

### 5.4 Health

```
GET /sessions/{sid}/health
→ {"state":"up","latency_ms":3,"windows":2}
```

---

## 6. Generic command channel

Escape hatch for commands not yet wrapped. **Disabled by default**; enable per session with
`allow_raw_tcl: true`.

```
POST /sessions/{sid}/command
{"command": "wvGetAllWindows", "timeout_ms": 5000}
→ {"ok": true, "result": "35857850 372eb2e0", "elapsed_ms": 2}
```

- Executes one Tcl command in the session's interpreter.
- `ok=false` maps to **422** with the Tcl error string.
- No shell interpolation; the string is passed verbatim to `CmdCltCallCommand`.
- Audit log: `~/.local/state/verdi-web/audit.log` (one JSON line per command).

**VERIFIED** transport semantics: `CmdCltCallCommand` returns success/failure + result string.

---

## 7. Window API

```
GET  /sessions/{sid}/windows
→ [{"wid":"35857850","kind":"nWave","xid":"2000061","title":"MainWindow"},
   {"wid":"372eb2e0","kind":"nWave","xid":"20002e7"}]
```

| Method | Path | Tcl mapping | Status |
|---|---|---|---|
| GET | `/sessions/{sid}/windows` | `wvGetAllWindows` | VERIFIED |
| GET | `/sessions/{sid}/windows/{wid}` | `wvGetXWindowId -id {wid}` | VERIFIED |
| POST | `/sessions/{sid}/windows` | `wvCreateWindow` | VERIFIED |
| DELETE | `/sessions/{sid}/windows/{wid}` | `wvCloseWindow -win {wid}` | DOCUMENTED_ONLY |
| POST | `/sessions/{sid}/windows/{wid}/raise` | `wvRaiseWindow` / `sysRaiseWindow` | DOCUMENTED_ONLY |
| GET | `/sessions/{sid}/windows/{wid}/screenshot` | X11 `import -window 0x{xid}` | VERIFIED |

Screenshot:

```
GET /sessions/{sid}/windows/{wid}/screenshot?format=png
→ image/png
```

**VERIFIED** for an nWave window (2560×615 PNG).
Caveat: if the window is fully off-screen/unmapped, X capture fails; fall back to
`xwd`/WM move or return **409 `window_not_capturable`**.

---

## 8. Waveform API (nWave window scoped)

All paths below use `{wid}`.

### 8.1 Files

| Method | Path | Tcl | Status |
|---|---|---|---|
| GET | `/waves/{wid}/files` | `wvIsFileOpen`, active file | PARTIAL |
| POST | `/waves/{wid}/files` `{"path": "...", "time_unit": "ns"}` | `wvOpenFile` | VERIFIED |
| DELETE | `/waves/{wid}/files` `{"path": "..."}` | `wvCloseFile` | DOCUMENTED_ONLY |
| POST | `/waves/{wid}/files/reload` | `wvReloadFile` | DOCUMENTED_ONLY |
| GET | `/waves/{wid}/time-unit` | `wvGetFileTimeUnit` / `wvGetWindowTimeUnit` | VERIFIED |
| PUT | `/waves/{wid}/time-range` `{"begin":0,"end":1227}` | `wvSetFileTimeRange` | DOCUMENTED_ONLY |

### 8.2 Signals

| Method | Path | Tcl | Status |
|---|---|---|---|
| GET | `/waves/{wid}/signals?scope=/system` | `wvGetSignalsByScope` | DOCUMENTED_ONLY |
| GET | `/waves/{wid}/signals/search?name=acc` | `wvFindSignal` | DOCUMENTED_ONLY |
| POST | `/waves/{wid}/signals` `{"signals":["/system/CYCLE"]}` | `wvAddSignal` | VERIFIED |
| DELETE | `/waves/{wid}/signals` `{"signals":[...]}` | `wvDeleteSignal` | DOCUMENTED_ONLY |
| DELETE | `/waves/{wid}/signals/all` | `wvClearAll` | DOCUMENTED_ONLY |
| GET | `/waves/{wid}/signals/dump?file=/tmp/list.txt` | `wvDumpSignalListToFile` | VERIFIED |
| GET | `/waves/{wid}/signals/{path}/exists` | `wvIsSignalExistInWaveform` | DOCUMENTED_ONLY |

`POST /waves/{wid}/signals` returns the per-command result (Verdi returns `1` on success).

**VERIFIED** events: `wvAddSignal`, `wvAddSignalByIdCode` (with signal idcodes).

### 8.3 Cursor / markers / zoom

| Method | Path | Tcl | Status |
|---|---|---|---|
| PUT | `/waves/{wid}/cursor` `{"time":100}` | `wvSetCursor` | VERIFIED |
| GET | `/waves/{wid}/cursor` | `wvGetCurValueString` | DOCUMENTED_ONLY |
| PUT | `/waves/{wid}/zoom` `{"value":...}` | `wvZoomValue` | DOCUMENTED_ONLY |
| POST | `/waves/{wid}/cursor/center` | `wvCenterCursor` | DOCUMENTED_ONLY |

**VERIFIED** `wvCursorTimeChange` + `debCursorTimeChange` events after `wvSetCursor`.

### 8.4 Value queries — the critical gap

| Method | Path | Backend | Status |
|---|---|---|---|
| GET | `/waves/{wid}/value?signal={path}&time={t}` | `wvGetSigValueByTime` | NOT_TESTED |
| GET | `/waves/{wid}/value?signal={path}` (cursor) | `wvGetCurValueString` | NOT_TESTED |
| GET | `/waves/{wid}/transitions?signal={path}&from={a}&to={b}` | FSDB Reader (`ffrCreateVCTrvsHdl`, `ffrGetTransVal`) | NOT_TESTED |

Response model:

```json
{
  "signal": "/system/R_W",
  "time": 100,
  "unit": "ns",
  "value": "1",
  "xz": {"has_x": false, "has_z": false, "unknown_bits": []},
  "width": 1,
  "radix": "bin"
}
```

Vector example with partial unknown:

```json
{"signal":"/system/data[7:0]","time":520,"unit":"ns","value":"10X1ZZ00",
 "xz":{"has_x":true,"has_z":true,"unknown_bits":[5,2,1,0]}}
```

**Do not promise this endpoint until it is executed against a real FSDB.**
If `wvGetSigValueByTime` proves unusable, fall back to the headless FSDB Reader.

### 8.5 X/Z scan

```
POST /waves/{wid}/scan-xz
{"scope":"/system/i_cpu","from":500,"to":1000,"include_z":true,"max_results":200}
→ {"candidates":[{"signal":"/system/i_cpu/acc[3]","first_time":512,"kind":"x"}],
   "truncated":false,"scanned":1240}
```

Backend: FSDB Reader traversal (preferred) or nWave value queries (fallback).
**NOT_TESTED.** Must never silently drop X registers / Z nets — report them with kind.

---

## 9. FSDB API (headless, no GUI)

Backend: `$VERDI_HOME/share/FsdbReader` (`ffrAPI.h`, `libnffr.so`).
All calls are read-only and do not consume a GUI session.

| Method | Path | Backend (documented) | Status |
|---|---|---|---|
| POST | `/fsdb` `{"path":"..."}` | `ffrObject`/`ffrCheckFSDB` | DOCUMENTED_ONLY |
| DELETE | `/fsdb/{fid}` | `ffrClose` | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/info` | `ffrGetFSDBInfo` | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/scopes` | `ffrGetScopeSeparator` + traversal | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/signals?scope=...` | `ffrGetVarIdcode` | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/value?signal=...&time=...` | `ffrCreateVCTrvsHdl` + `ffrGetTransVal` | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/transitions?signal=...&from=...&to=...` | `ffrGetTransInfo` | DOCUMENTED_ONLY |
| GET | `/fsdb/{fid}/xz?signal=...&from=...&to=...` | `ffrGetXTag`, `ffrGetXTagType` | DOCUMENTED_ONLY |

Advantages: parallel, no license/GUI contention, safe for sweeps.
Limitation: no design connectivity, no source, no schematic.

---

## 10. Design API (requires a design DB)

These queries are only meaningful when Verdi elaborated the design (`-f filelist`) or a KDB
exists. Server must report `design_db_loaded` in `/capabilities`.

| Method | Path | Tcl | Status |
|---|---|---|---|
| GET | `/design/scopes?root=/` | `debIterTopScope`, `debIterChildScope` | DOCUMENTED_ONLY |
| GET | `/design/signals?scope=...` | scope iteration | DOCUMENTED_ONLY |
| GET | `/design/drivers?signal=...` | `schTraceDriver`, `schDriverCount` | NOT_TESTED |
| GET | `/design/loads?signal=...` | `schTraceLoad`, `schLoadCount` | NOT_TESTED |
| GET | `/design/fanin?signal=...&levels=N` | `schTraceFanInByLevel` | NOT_TESTED |
| GET | `/design/fanout?signal=...&levels=N` | `schTraceFanOutByLevel` | NOT_TESTED |
| GET | `/design/connectivity?signal=...` | `schTraceConnectivity` | NOT_TESTED |
| GET | `/design/cone?from=...&to=...` | `schTrace2Signals` | NOT_TESTED |
| GET | `/design/source?signal=...` | `srcGetCaretFile` | NOT_TESTED |

Response for drivers (proposed):

```json
{
  "signal": "/system/i_cpu/acc[3]",
  "drivers": [
    {"signal": "/system/i_cpu/u_alu/out[3]", "kind": "instance_port", "depth": 1}
  ],
  "complete": true,
  "design_db": "elaborated"
}
```

**Without a design DB** the server MUST return **501 `not_supported`** for these endpoints,
and clients must fall back to time-correlation candidates (see §12).

---

## 11. Schematic / source / UI

| Method | Path | Tcl | Status |
|---|---|---|---|
| POST | `/schematic/windows` `{"signal":...}` | `schCreateWindow` | NOT_TESTED |
| GET | `/schematic/windows` | `schGetAllWindows` | NOT_TESTED |
| POST | `/schematic/windows/{id}/trace-driver` | `schTraceDriver` | NOT_TESTED |
| POST | `/schematic/windows/{id}/trace-fanin` | `schTraceFanIn` | NOT_TESTED |
| POST | `/schematic/windows/{id}/trace-x` | `schTraceX` | NOT_TESTED |
| POST | `/source/windows` `{"file":..., "line":...}` | `srcCreateWindow`, `srcCompile` | NOT_TESTED |
| POST | `/ui/highlight` `{"signals":[...]}` | `verdiHighlightSignal` | NOT_TESTED |
| POST | `/ui/raise` | `sysRaiseWindow` / `wvRaiseWindow` | DOCUMENTED_ONLY |
| GET | `/ui/screenshot` | X11 capture | VERIFIED (window-scoped) |

All schematic/source calls require the GUI; none are expected to work headless.

---

## 12. Events

### 12.1 SSE

```
GET /sessions/{sid}/events?reasons=wvCursorTimeChange,wvAddSignal
Accept: text/event-stream
```

```
event: wvCursorTimeChange
data: {"time":100,"signal":"NULL","file":"/path/x.fsdb","ts":"2026-10-17T..."}

event: wvAddSignal
data: {"delim":"/","count":3,"signals":["/system/CYCLE","/system/R_W","/system/VMA"]}
```

- Backend: `CmdCltAddEventCallback(AllEvents)` + `CmdCltCheckForEvents` pump.
- **VERIFIED** that these events are delivered to the connected client.
- Broadcast semantics to multiple clients are **NOT_TESTED**; the broker is the only client,
  so it fans out to all SSE subscribers itself.

### 12.2 WebSocket (optional)

```
WS /sessions/{sid}/ws
{"op":"exec","request_id":"r1","command":"wvGetAllWindows"}
← {"request_id":"r1","ok":true,"result":"..."}
← {"event":"wvCursorTimeChange","data":{...}}
```

Useful for low-latency agent loops; same serialization rules as REST.

---

## 13. Long-running jobs

Commands that may exceed the sync timeout (large dumps, X/Z scans) return:

```
POST /waves/{wid}/scan-xz → 202 {"jid":"j_01"}
GET  /jobs/{jid} → {"state":"running","progress":{"scanned":523,"total":1240}}
DELETE /jobs/{jid} → cancel
```

Rule: **only read-only operations may be async.** GUI mutations stay synchronous so the
caller knows the view changed.

---

## 14. Data models

### Session
`sid, port, pid, state, label, cwd, fsdb[], design[], display, started, verdi_version, allow_raw_tcl`

### Window
`wid, kind(nWave|nSchema|source), xid, title, size{width,height}`

### SignalRef
`path (full hierarchical name), idcode?, width?, type(logic|wire|reg|...), fsdb?`

### Value
`signal, time, unit, value (binary/hex string), width, radix, xz{has_x,has_z,unknown_bits[]}`

### TraceNode
`signal, kind(driver|load|port|net), depth, via?`

---

## 15. Safety & policy

| Rule | Enforcement |
|---|---|
| Loopback only | bind `127.0.0.1`; refuse non-loopback config |
| Token auth | `0600` token file; constant-time compare |
| No raw Tcl by default | `allow_raw_tcl=false`; must be enabled per session |
| Destructive commands blocked | denylist: `debExit`, `wvExit` on user sessions, file deletes, `schExport` overwrite, `wvCloseFile` without explicit confirm |
| Never touch other sessions | only PIDs whose cmdline matches `-serverPort <port>` |
| Audit | every command logged with sid, command, ok, elapsed, caller |
| Data egress | API returns signal names/values only; never uploads RTL/FSDB; no file-write endpoints outside `/tmp` |
| Limits | max concurrent commands per session = 1; queue timeout 30 s; response size cap 8 MB |

Explicitly **not exposed**: shell execution, arbitrary file read/write, license queries,
process kill by pid, network access.

---

## 16. Underlying Tcl command map (quick index)

| Area | Commands |
|---|---|
| Session/window | `wvCreateWindow`, `wvCloseWindow`, `wvGetAllWindows`, `wvGetCurrentWindow`, `wvGetXWindowId`, `wvRaiseWindow`, `wvResizeWindow`, `wvSetCurrentWindow`, `wvTileWindow`, `wvSplitWindow`, `wvSyncWindow` |
| Files | `wvOpenFile`, `wvCloseFile`, `wvReloadFile`, `wvIsFileOpen`, `wvSetActiveFile`, `wvGetFileTimeUnit`, `wvGetWindowTimeUnit`, `wvSetFileTimeRange`, `wvShiftFileTime` |
| Signals | `wvAddSignal`, `wvAddAllSignals`, `wvDeleteSignal`, `wvClearAll`, `wvFindSignal`, `wvGetScope`, `wvGetSignalsByScope`, `wvDumpSignalListToFile`, `wvIsSignalExistInWaveform`, `wvRenameSignal`, `wvSaveSignal`, `wvSaveSignalRC`, `wvSelectSignal`, `wvSelectAll`, `wvDeselectAll`, `wvSelectStuckSignals`, `wvExtractSelSignals`, `wvSignalReport`, `wvReportSelSignals` |
| Cursor/time | `wvSetCursor`, `wvCenterCursor`, `wvCenterMarker`, `wvZoomValue`, `wvGetCurValueString`, `wvGetSigValueByTime`, `wvGetAttributeValue` |
| Design | `debImport`, `debReload`, `debCloseAllWindows`, `debIterTopScope`, `debIterChildScope`, `srcCreateWindow`, `srcCompile`, `srcGetCaretFile`, `srcGetCurrentValue`, `srcDumpVariableValue`, `srcTraceDriver`, `srcTraceFanIn`, `srcTraceFanOut`, `srcSetXpropLogFile`, `srcSetXpropOption` |
| Schematic | `schCreateWindow`, `schCompile`, `schGetAllWindows`, `schSetScope`, `schTraceDriver`, `schTraceFanIn`, `schTraceFanOut`, `schTraceConnectivity`, `schTrace2Signals`, `schTraceX`, `schDriverCount`, `schLoadCount`, `schTraceReport`, `schDumpTracedLeafPin`, `schExport`, `schCapture` |
| UI/system | `verdiSetActWin`, `verdiGetActWin`, `verdiHighlightSignal`, `verdiDockWidgetSetCurTab`, `sysRaiseWindow`, `sysGetEnv`, `sysPutEnv` |
| FSDB reader | `ffrObject`, `ffrCheckFSDB`, `ffrGetFSDBInfo`, `ffrCreateVCTrvsHdl`, `ffrCreateTimeBasedVCTrvsHdl`, `ffrGetTransInfo`, `ffrGetTransVal`, `ffrGetXTag`, `ffrGetXTagType`, `ffrGetVarIdcode`, `ffrGetScopeSeparator`, `ffrGetScaleUnit`, `ffrClose` |

All names above were found in the local docs (`$VERDI_HOME/doc/verdi_tcl.pdf`,
`verdi_fsdb_reader.pdf`). Existence in docs ≠ verified behavior.

---

## 17. Concurrency and multi-user

- **One broker per session** holds the only connection; commands are serialized FIFO.
- Multiple agents talk to the broker (Unix socket / HTTP), not to Verdi directly.
- The server's "any number of clients" claim is documented but **its concurrent response
  semantics are unproven**; an ad-hoc two-client test produced mismatched results.
- **Multi-user**: each OS user runs their own web API and own sessions. Do not share one
  Verdi GUI across users; do not expose the API beyond loopback.
- Port allocation: registry + reservation files, range 11000–11999 for Verdi,
  12000–12999 for the web API (avoid ephemeral 32768–60999). **VERIFIED** for Verdi sessions.

---

## 18. What this API will NOT solve

1. **Undumped signals** — if it is not in the FSDB, no endpoint can return it.
2. **Causality without a design DB** — tracing degrades to time-correlated candidates. The API
   must say so (`501 not_supported`) rather than pretend.
3. **Protocol semantics** — AXI/AHB/APB handshake meaning lives in the client/agent rules, not
   in Verdi. The API exposes signals; the caller interprets them.
4. **Root-cause certainty** — propagated X vs undriven vs uninitialized vs tri-state requires
   extra evidence (X-prop log, driver count, waveform history). The API can expose the inputs,
   not the verdict.

---

## 19. Implementation roadmap

| Phase | Deliverable | Acceptance |
|---|---|---|
| 1 | Broker + session registry + `/sessions`, `/command`, `/windows`, screenshot | matches VERIFIED PoC behavior |
| 2 | Waveform value/transition endpoints | executed against a real FSDB; X/Z vectors documented |
| 3 | Headless FSDB API (parallel, no GUI) | value parity with nWave on the same signal/time |
| 4 | Design/source endpoints | works with `-f filelist`; returns 501 without DB |
| 5 | X/Z scan + evidence report | bounded scan, no dropped X/Z, reproducible |
| 6 | SSE/WS + job queue | two agents concurrently, no response mismatch |

---

## 20. Reference: minimal request sequence

```bash
# 1. discover
curl -H "Authorization: Bearer $T" http://127.0.0.1:12000/api/v1/sessions

# 2. open FSDB in an nWave window and add signals
curl -X POST .../sessions/$SID/windows -d '{}'
curl -X POST .../waves/$WID/files -d '{"path":"/tmp/x.fsdb"}'
curl -X POST .../waves/$WID/signals -d '{"signals":["/system/CYCLE","/system/R_W"]}'

# 3. move the cursor and read values (phase 2)
curl -X PUT .../waves/$WID/cursor -d '{"time":500}'
curl .../waves/$WID/value?signal=/system/R_W\&time=500

# 4. capture what the engineer sees
curl -o view.png .../sessions/$SID/windows/$WID/screenshot
```
