# Verdi Interactive Debug Agent — Feasibility Report

Date: 2026-10-17
Host: f29 (10.3.9.99), user `faye`
Scope: research + minimal PoC (not a production MCP server)
PoC artifacts: `/tmp/opencode/verdi_poc/` (`cmdclient.c`, `build.sh`, `run_poc.sh`, `FINDINGS.md`, `poc_output.txt`, `signals.txt`, `nwave.png`, `verdi.log`)

Evidence labels: **VERIFIED** (executed on this host), **DOCUMENTED_ONLY** (found in local docs, not executed), **INFERRED**, **UNSUPPORTED**, **NOT_TESTED**.

---

## 1. Executive verdict

| Capability | Verdict | Basis |
|---|---|---|
| Live GUI control of an already-running Verdi | **FEASIBLE — VERIFIED** | External headless process connected over `-serverPort`, executed Tcl synchronously, got return values and event callbacks; nWave window visibly changed (screenshot). |
| Waveform queries | **LIKELY FEASIBLE — NOT_TESTED** | Two independent documented paths exist: nWave Tcl (`wvGetSigValueByTime`, `wvGetCurValueString`, `wvGetScope`, `wvGetSignalsByScope`) and a standalone FSDB Reader C API (`ffrGetTransVal`, `ffrGetXTag`, `ffrCreateVCTrvsHdl`). Neither was executed. |
| Driver / fan-in / logic-cone tracing | **PARTIALLY FEASIBLE, DEPENDENCY UNKNOWN — NOT_TESTED** | Commands documented (`schTraceDriver`, `schTraceFanIn/Out`, `schTraceX`, `schTrace2Signals`, `srcTraceDriver`), but they likely require a design/debug database beyond an FSDB. Not tested. |
| Keeping the engineer able to take over | **VERIFIED (by construction)** | The bridge drives the same live GUI; no separate batch model. Everything done in the PoC remained visible and usable. |

Bottom line for the success criterion: **a separate agent process CAN query data and programmatically update an already-open Verdi GUI** — the transport half is proven. The remaining risk is not control, it is whether the specific waveform/tracing queries an X-debug flow needs are exposed with enough structure.

---

## 2. Environment — VERIFIED unless noted

| Item | Value |
|---|---|
| Verdi executable | `/opt/synopsys/verdi/W-2024.09-SP1/bin/verdi` |
| Version/build | `Version W-2024.09-SP1 for linux64 - Nov 30, 2024` |
| Other installed versions | `T-2022.06-SP1`, `Verdi_O-2018.09-SP1` |
| Default selection | `/opt/synopsys/env.synopsys.rc`'s `getVersion` picks `W-2024.09-SP1` |
| License | `SNPSLMD_LICENSE_FILE=27010@127.0.0.1`; `snpslmd` listening (lmstat: features present, 0 in use) |
| Display | SSH X forwarding: `DISPLAY=localhost:10.0`, `XAUTHORITY=~/.Xauthority` (`xdpyinfo` OK) |
| Tcl docs | `$VERDI_HOME/doc/verdi_tcl.pdf` — *Verdi and Siloti Tcl Reference*, W-2024.09-SP1, December 2024; text extract at `$VERDI_HOME/doc/.verdi_tcl.txt.gz` (grep-able) |
| Command docs | `$VERDI_HOME/doc/verdi_command_ref.pdf` |
| FSDB docs | `$VERDI_HOME/doc/verdi_fsdb_reader.pdf` (symlink into `share/FsdbReader/doc/`) |
| Client libs | `$VERDI_HOME/share/libcmd/linux64/libnclt.{a,so}`, `libnsys.{a,so}`; header `share/libcmd/cmdclt.h` |
| FSDB reader | `$VERDI_HOME/share/FsdbReader/` — `ffrAPI.h`, `libnffr.so`, many examples |
| NPI | `$VERDI_HOME/share/NPI/inc/npi_fsdb.h` etc. |
| Demo data | `$VERDI_HOME/demo/verilog/behav/` — `behav.fsdb`, `cpu.v`, `system.v` |
| Tooling gaps | no `tclsh`/`wish`, no python tkinter, no `javac` (JRE 17 only), `gcc` 12 available |

Scripting entry points (DOCUMENTED_ONLY, all in the Tcl Reference):
1. `verdi -tkName <name>` + Tk `send <name> {cmd}` — requires a Tk app, same X server, `xauth`.
2. `verdi -serverPort <port>` + client library `libnclt` — socket interface.
3. `verdi -play <file>` — startup/batch Tcl playback.
4. Command history recording/replay (tutorial chapter).

---

## 3. Capability matrix

| Feature | Documented | Verified | API / command | Limitations | Evidence |
|---|---|---|---|---|---|
| Discover Tcl command space | yes | yes | `$VERDI_HOME/doc/.verdi_tcl.txt.gz` | PDF text only; page numbers ≠ command semantics | file exists, 40+ `wv*` commands listed |
| External control of live GUI | yes | **yes** | `verdi -serverPort <port>` + `CmdClt*` | no auth; server picks/binds port; port must be known by the client | port listening; commands executed |
| Sync command + result | yes | **yes** | `CmdCltCallCommand(c, cmd, 0, &rv)` | return >0 = command exists/executed; Tcl error also yields 0 | `OK wvAddSignal ... 1`; `ERR debGetEnv invalid command name` |
| Async events | yes | **yes** | `CmdCltAddEventCallback` + `CmdCltCheckForEvents` | must pump events; no polling thread in PoC | `wvAddSignal`, `wvCursorTimeChange` events received |
| Create nWave window | yes | **yes** | `wvCreateWindow` → internal win id | internal id ≠ X id | `372eb2e0`; X id `0x20002e7` |
| Get X window id | yes | **yes** | `wvGetXWindowId -id <win>` | returned hex without `0x` | `20002e7` → xwininfo OK |
| Open FSDB in nWave | yes | **yes** | `wvOpenFile [-win id] [-time_unit u] <file>` | none observed | `wvOpenFSDBFile`, `wvViewRangeChanged` events |
| Enumerate signals | yes | **yes** | `wvDumpSignalListToFile -win id -signal -file f` | dumps FSDB, not window contents; text file | 40 signals written |
| Add signals to waveform | yes | **yes** | `wvAddSignal -win id <sig...>` | hierarchical names must match FSDB | `wvAddSignal`/`wvAddSignalByIdCode` events; screenshot shows 3 waveforms |
| Move cursor | yes | **yes** | `wvSetCursor -win id <time>` | time in file time unit | `wvCursorTimeChange 100`; screenshot cursor at 100 ns |
| Signal value at time | yes | NOT_TESTED | `wvGetSigValueByTime` (p.652), `wvGetCurValueString` (p.648) | 4-state/vector semantics unknown until tested | TOC only |
| Scope enumeration | yes | NOT_TESTED | `wvGetScope`, `wvGetSignalsByScope` | — | TOC only |
| Find signal | yes | NOT_TESTED | `wvFindSignal`, `wvIsSignalExistInWaveform` | — | TOC only |
| Driver / fan-in / fan-out | yes | NOT_TESTED | `schTraceDriver`, `schTraceFanIn`, `schTraceFanOut`, `schDriverCount`, `*ByLevel` | needs design/schematic DB; KDB/elab dependency unknown | TOC only |
| X propagation trace | yes | NOT_TESTED | `schTraceX`, `srcSetXpropLogFile`, `srcSetXpropOption` | likely needs X-prop dump/log, not plain FSDB | TOC only |
| Source file/line | yes | NOT_TESTED | `srcGetCaretFile`, `srcCreateWindow`, `srcCompile` | needs compiled source DB | TOC only |
| FSDB value/transitions (no GUI) | yes | NOT_TESTED | `ffrCreateVCTrvsHdl`, `ffrCreateTimeBasedVCTrvsHdl`, `ffrGetTransVal`, `ffrGetTransInfo` | separate C program; license/feature unknown | FSDB Reader TOC |
| Four-state / X-Z detection | yes | NOT_TESTED | `ffrGetXTag`, `ffrGetXTagType`, `ffrGetVarIdcodeXTagVCSeqNum` | encoding semantics must be verified on real data | FSDB Reader TOC |
| Tk `send` control | yes | NOT_TESTED | `-tkName` + `send` | no Tcl/Tk on host; xauth required; xhost unsupported | doc p.63 |
| Batch/startup scripting | yes | NOT_TESTED | `verdi -play file` | not interactive; no return channel | doc p.97 |

---

## 4. Minimal reproducible PoC (VERIFIED)

### 4.1 What was run

```
cd /tmp/opencode/verdi_poc
./build.sh
PORT=11066 DISPLAY=localhost:10.0 XAUTHORITY=$HOME/.Xauthority ./run_poc.sh
```

The script:
1. refuses to run if the port is already occupied (prevents attaching to a user session),
2. copies the shipped demo (`behav.fsdb`) to `/tmp`,
3. starts `verdi -serverPort $PORT -ssf behav.fsdb` under `setsid nohup`,
4. waits for the port,
5. drives nWave from the external client,
6. screenshots the nWave X window,
7. kills only the process whose command line contains `-serverPort $PORT`.

Client build (no Motif/X11 needed):
```
gcc -I$VERDI_HOME/share/libcmd cmdclient.c \
    -L$VERDI_HOME/share/libcmd/linux64 -lnclt -lnsys -o cmdclient
LD_LIBRARY_PATH=$VERDI_HOME/share/libcmd/linux64 ./cmdclient 11065 ...
```

### 4.2 Expected vs observed

| Step | Expected | Observed |
|---|---|---|
| Server starts | port listening | `127.0.1.1:11065` LISTEN (VERIFIED) |
| Connect | success | connected (VERIFIED) |
| Bad command | error surfaced | `ERR debGetEnv invalid command name "debGetEnv"` (VERIFIED) |
| Create window | window id | `OK wvCreateWindow 372eb2e0` (VERIFIED) |
| Open FSDB | file loaded | `OK wvOpenFile ...`, `wvOpenFSDBFile` event (VERIFIED) |
| Add signals | 3 waveforms | `OK ... 1`, `wvAddSignal / 3 {/system/CYCLE} ...` (VERIFIED) |
| Move cursor | time 100 | `wvCursorTimeChange 100` (VERIFIED) |
| Dump signals | text file | 40 lines (VERIFIED) |
| GUI evidence | window + waveforms | `xwininfo`: `"MainWindow" 2560x615`, Map State IsViewable; screenshot shows CYCLE/R_W/VMA + 100 ns cursor (VERIFIED) |
| Existing sessions | untouched | PIDs 1192542, 2938719 alive after PoC (VERIFIED) |

### 4.3 Gotchas found (all VERIFIED)

1. **License**: without `SNPSLMD_LICENSE_FILE=27010@127.0.0.1`, Verdi falls back to
   `/usr/local/flexlm/licenses/license.dat` and fails with
   `[SCL] Checkout denied Verdi 2024.09`. This is *not* a seat shortage.
2. **`-serverPort` is undocumented in `verdi -help`** — it is only in the Tcl Reference (p.98).
3. **Window ids are handles, not X ids**: use `wvGetXWindowId -id <handle>`; prepend `0x`
   before passing to X tools.
4. **`-ssf` restores/creates a window that already owns the FSDB.** A fresh
   `wvCreateWindow` is empty; `wvDumpSignalListToFile` fails on it until `wvOpenFile` is called.
5. **Events are delivered on `CmdCltCheckForEvents`**, so a bridge must pump them (timer/thread).

### 4.4 Proposed PoC not tested

X-debug scenario from the request (identify signals entering X/Z after 500 ns, trace fan-in,
open waveform/schematic/source) was **NOT_TESTED**: the shipped demo has an FSDB but the
X-propagation walkthrough needs a design with intentional X and, for tracing, a design/
debug database. No authorized test design was provided.

---

## 5. X-debug walkthrough

Status: **NOT_TESTED**.

What the docs suggest would be needed:
- Waveform scan: `wvGetSigValueByTime` / `wvGetCurValueString`, or FSDB Reader
  `ffrCreateVCTrvsHdl` + `ffrGetTransVal` / `ffrGetXTag` (4-state aware).
- Distinguishing undriven vs uninitialized vs tri-state vs propagated X: no single
  documented "classify" command was found; must be built from 4-state values, driver
  count (`schDriverCount`), and waveform history. **INFERRED** — needs empirical work.
- Tracing: `schTraceDriver` / `schTraceFanIn` plus `schGetScope`; whether these work with
  only an FSDB or require KDB/elaboration data is unknown (**NOT_TESTED**).
- Where automation stops: likely at "defensible root cause" vs "candidate upstream
  signals" — time-specific causality is not the same as structural connectivity
  (**INFERRED**).

---

## 6. Architecture recommendation

**Recommended smallest bridge: OpenCode → local helper process → `libnclt` socket → Verdi Tcl.**

- No need for MCP packaging yet. A small CLI (like the PoC's `cmdclient`) plus a session
  registry (JSON: PID, port, FSDB, cwd, started-by) is enough for an agent to:
  `list sessions` → `exec <session> "<tcl cmd>"` → read JSON result/events.
- Rationale: it is the only channel verified end-to-end here, needs no Tk/X client
  libraries, and drives the exact GUI the engineer is watching.
- Keep the FSDB Reader path separate and read-only: it avoids occupying the GUI and is
  better for bulk scans (X/Z sweeps), while nWave Tcl is better for "show me".
- MCP wrapper: optional later; it adds no capability over a CLI.

Operational rules the bridge must enforce:
- Never attach to a Verdi process unless the caller owns the port/session record.
- Bind/port policy: Verdi binds `127.0.1.1` here; treat the socket as unauthenticated
  local IPC and do not expose it.
- Every mutating command should be logged with (session, command, result) for audit.

---

## 7. Open questions and blockers

1. **Value-query semantics**: `wvGetSigValueByTime` output format for vectors, X/Z bits,
   and time units — NOT_TESTED.
2. **Design DB dependency for tracing**: do `schTrace*` / `srcTrace*` work with FSDB only?
   Likely not; need a test design with KDB/source DB.
3. **X-prop source**: `srcSetXpropLogFile` suggests a separate X-propagation log; whether
   X origin can be recovered from waveform alone is unknown.
4. **Session discovery / concurrency**: random ports; no built-in registry. A port file per
   launch is INFERRED as sufficient.
5. **Security**: unauthenticated socket; same-user access assumed.
6. **Performance**: latency of sync commands and cost of dumping large hierarchies — not measured.
7. **Version drift**: commands were checked against W-2024.09 only; the host also has
   T-2022.06 and O-2018.09 with different command sets.

---

## 8. Next steps

| # | Step | Effort | Acceptance criteria |
|---|---|---|---|
| 1 | Verify waveform value queries on demo FSDB (`wvGetSigValueByTime`, `wvGetCurValueString`, `wvGetScope`) | 0.5 day | Exact-time value for a scalar and a vector returned as structured text; X/Z cases documented |
| 2 | Build a read-only FSDB Reader probe (`ffrGetTransVal` / `ffrGetXTag`) | 1 day | Enumerates transitions for one signal; X/Z and partial-unknown vectors classified |
| 3 | X/Z sweep prototype over a bounded scope/time window | 1 day | Produces a candidate list with evidence, no GUI scraping |
| 4 | Test tracing commands with an authorized design + KDB | 1–2 days | `schTraceDriver`/`schTraceFanIn` return usable data or a documented blocker |
| 5 | Session registry + JSON CLI wrapper | 0.5 day | Agent can list/exec/screenshot a session without hard-coded ids |
| 6 | Decide MCP packaging | after 1–5 | Only if a stable API surface exists |

---

## Appendix A — PoC client (verbatim)

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cmdclt.h"

static void EventCB(char* event, void* clientData, char* callData) {
    (void)clientData;
    printf("EVENT\t%s\t%s\n", event, callData ? callData : "");
    fflush(stdout);
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <port> <cmd> [cmd...]\n", argv[0]);
        return 64;
    }
    int port = atoi(argv[1]);
    CMDCLT c = CmdCltCreate(1);
    if (!CmdCltConnect(c, port, NULL, 20)) {
        fprintf(stderr, "connect to port %d failed\n", port);
        return 2;
    }
    CmdCltAddEventCallback(c, (char*)"AllEvents", (CmdCltEventCB)EventCB, NULL);
    int rc = 0;
    for (int i = 2; i < argc; i++) {
        char* rv = NULL;
        char ok = CmdCltCallCommand(c, argv[i], 0, &rv);
        printf("%s\t%s\t%s\n", ok ? "OK" : "ERR", argv[i], rv ? rv : "(null)");
        fflush(stdout);
        CmdCltCheckForEvents(c);
        if (!ok) rc = 1;
    }
    CmdCltDestroy(c);
    return rc;
}
```

## Appendix B — Evidence locations

- Build + driver: `/tmp/opencode/verdi_poc/build.sh`, `run_poc.sh`
- Command transcript: `/tmp/opencode/verdi_poc/poc_output.txt`
- Signal dump: `/tmp/opencode/verdi_poc/signals.txt` (40 lines)
- GUI screenshot: `/tmp/opencode/verdi_poc/nwave.png`
- Server log: `/tmp/opencode/verdi_poc/verdi.log`
- Detailed PoC notes: `/tmp/opencode/verdi_poc/FINDINGS.md`

> Note: `/tmp` is ephemeral. Copy the directory somewhere durable if it should survive reboot.
