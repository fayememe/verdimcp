# Verdi socket-control PoC — findings

Date: 2026-10-17
Host: f29 (10.3.9.99), user faye
Verdi: W-2024.09-SP1 (`/opt/synopsys/verdi/W-2024.09-SP1`)
Artifacts: `/tmp/opencode/verdi_poc/` (`cmdclient.c`, `build.sh`, `run_poc.sh`, `poc_output.txt`, `signals.txt`, `nwave.png`, `verdi.log`)

## Verdict

**VERIFIED** — an external, headless process can connect to an already-running Verdi GUI
over the documented `-serverPort` socket, execute Tcl commands synchronously, get a
machine-readable return value, receive event callbacks, and make the existing GUI change.

Scope of this PoC: transport + basic nWave manipulation only. Waveform value queries,
driver/cone tracing, and schematic control were NOT tested here.

## How it works

1. Start Verdi as a command server:
   ```
   verdi -serverPort 11065 -ssf behav.fsdb
   ```
   Listening socket: `127.0.1.1:11065` (VERIFIED with `ss -ltn`).

2. Client links against the shipped library:
   - header: `$VERDI_HOME/share/libcmd/cmdclt.h`
   - libs: `$VERDI_HOME/share/libcmd/linux64/libnclt.{a,so}`, `libnsys.{a,so}`
   - The header's doc comment mentions `libcmd.a`; the installed library is `libnclt`.
   - Build: `gcc -I$LIB cmdclient.c -L$LIB/linux64 -lnclt -lnsys` — no Motif/X11 needed
     for a console client. Runtime needs `LD_LIBRARY_PATH=$LIB/linux64`.

3. API used (all VERIFIED):
   | function | purpose |
   |---|---|
   | `CmdCltCreate(0/1)` | create client |
   | `CmdCltConnect(c, port, NULL, 20)` | connect, 20 s timeout |
   | `CmdCltAddEventCallback(c, "AllEvents", cb, NULL)` | async event stream |
   | `CmdCltCallCommand(c, cmd, 0, &rv)` | sync command; returns 0 on failure, >0 on success |
   | `CmdCltCheckForEvents(c)` | pump events (needed after each command) |
   | `CmdCltDestroy(c)` | cleanup |

   Note: return value `>0` only means "command exists and was executed"; the Tcl result
   itself is the `returnString`. A Tcl-side error is reported as return value 0 — so
   callers must check both.

## Evidence

### Connect + create window
```
EVENT   wvCreateWindow          35857850          # window already restored by -ssf
EVENT   verdiMonoFontEvent      DejaVu Sans Mono,11
ERR     debGetEnv               invalid command name "debGetEnv"   # wrong name, expected
OK      wvCreateWindow          372eb2e0
```
`ERR` proves command errors are surfaced to the client instead of silently swallowed.

### Open FSDB, add signals, move cursor
```
OK  wvOpenFile -win 372eb2e0 /tmp/opencode/verdi_poc/demo/behav.fsdb   /tmp/.../behav.fsdb
EVENT wvOpenFSDBFile /tmp/opencode/verdi_poc/demo/behav.fsdb
EVENT wvViewRangeChanged 0.000000 1227.150000
OK  wvAddSignal -win 372eb2e0 /system/CYCLE /system/R_W /system/VMA     1
EVENT wvAddSignal / 3 {/system/CYCLE} {/system/R_W} {/system/VMA}
EVENT wvAddSignalByIdCode -idcode 3 {1 21 20}
OK  wvSetCursor -win 372eb2e0 100                                       1
EVENT wvCursorTimeChange 100 {NULL} /tmp/opencode/verdi_poc/demo/behav.fsdb
EVENT debCursorTimeChange 100
```
Events (`wvAddSignal`, `wvCursorTimeChange`, `debCursorTimeChange`) are emitted by the
GUI itself — this is the bidirectional half of the bridge.

### FSDB enumeration
```
OK  wvDumpSignalListToFile -win ... -signal -file signals.txt   1
$ wc -l signals.txt
40
/system/CYCLE
/system/R_W
/system/VMA
/system/addr[7:0]
...
```
40 signals exported to a text file — no GUI scraping needed.

### Independent GUI proof
`xwininfo -id 0x20002e7` → `"MainWindow" 2560x615`, Map State `IsViewable`.
Screenshot `nwave.png` shows the nWave window with CYCLE / R_W / VMA waveforms and the
cursor at 100 ns.

### Constraints observed
- `-serverPort` is not listed in `verdi -help`; it is documented in the Verdi/Siloti Tcl
  Reference (§ "Setup Verdi As a Server", p.98). It works (VERIFIED).
- License: must export `SNPSLMD_LICENSE_FILE=27010@127.0.0.1`. Without it Verdi falls back
  to `/usr/local/flexlm/licenses/license.dat` and fails with
  `Checkout denied Verdi 2024.09` (VERIFIED — first attempt failed for this reason).
- The GUI needs a working X display. This host uses SSH X forwarding
  (`DISPLAY=localhost:10.0`, `XAUTHORITY=~/.Xauthority`).
- Window may be created off-screen depending on WM state; nWave's X id is obtainable via
  `wvGetXWindowId -id <verdi-window-id>` (VERIFIED).
- No `tclsh`/`wish`/python-tkinter on this host, so the Tk `send` route was not tested.
  It is not needed: the socket route works without Tk.

## Not tested / open

- **P2 waveform queries**: `wvGetValue`-style API not yet located/tested; candidate paths
  are nWave Tcl commands and `$VERDI_HOME/share/FsdbReader` (`ffrAPI.h`, `libnffr.so`).
- **P3 tracing**: `schTraceDriver`, `schTraceFanIn`, `schTraceX`, `schTrace2Signals` are
  documented; they likely need a design/debug database (KDB/NPI), not just an FSDB.
- **Concurrency/session discovery**: server picks an arbitrary port per invocation; an
  agent needs a registry (port file per session) to avoid attaching to the wrong Verdi.
- **Security**: the socket has no authentication in this PoC setup; bind/port exposure
  must be considered (Verdi binds 127.0.1.1 by default here).
- **Performance**: not measured (command latency, large signal dumps).

## Reproduction

```
cd /tmp/opencode/verdi_poc
./build.sh
DISPLAY=localhost:10.0 XAUTHORITY=$HOME/.Xauthority ./run_poc.sh
```
`run_poc.sh` refuses to run if the port is already in use, kills only the process whose
command line contains `-serverPort <port>`, and leaves logs/screenshot in place.
