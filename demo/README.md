# demo — sync_fifo

A minimal DUT for exercising verdimcp: a synchronous FIFO with a valid/ready handshake and one
deliberate X scenario. It exists so that "start a session → open the FSDB → add signals → move the cursor →
read values/transitions/X-Z → capture" has a stable input.

## Layout

```
demo/
├── rtl/sync_fifo.v          # DUT: parameterised synchronous FIFO (DATA_WIDTH=8, DEPTH=4)
├── tb/tb_sync_fifo.v        # self-checking testbench + FSDB dump
├── sim/                     # filelist.f, Makefile (sim / verdi / verdi-server / clean)
├── npi/                     # headless FSDB reader smoke test
├── bigfsdb/                 # generator for a large multi-signal FSDB
└── writing/                 # long-running simulation that writes an FSDB while you read it
```

## Test scenario

1. reset;
2. `rd_data` reads from an uninitialised memory while the FIFO is empty → **X** (the X/Z case);
3. write 2 entries, check `count`;
4. fill it, check `full` and `wr_ready=0`;
5. a write while full is rejected, `count` unchanged;
6. read 2 entries, check data and `count`;
7. simultaneous read + write, `count` unchanged;
8. drain, check `empty` and `rd_valid=0`.

## Signals worth looking at

| Signal | Use |
|---|---|
| `clk` / `rst_n` | time base |
| `wr_valid` / `wr_ready` / `wr_data` | write handshake |
| `rd_valid` / `rd_ready` / `rd_data` | read handshake / the X case |
| `full` / `empty` / `count` | state and boundaries |
| `dut.mem` | memory array; uninitialised entries are X |

## Running

There is no site configuration in this repo. Either source your EDA environment before invoking `make`, or
point `SYN_ENV_RC` at your own rc script:

```bash
export SYN_ENV_RC=/path/to/your/env.rc     # VCS, Verdi, VERDI_HOME, license variables
```

### Compile and simulate

```bash
cd demo/sim
make clean
make sim
```

Expected output:

```
[40.0 ns] OK: rd_data is X while empty (xx)
TEST PASSED
$finish at simulation time 240.0 ns
```

This writes `sync_fifo.fsdb` (~9.7 KB).

### Verdi

```bash
cd demo/sim
make verdi                      # open design + FSDB
make verdi-server PORT=11066    # same, plus a command port for libnclt / verdimcp
make verdi-dbdir                # use the KDB from a -kdb build instead of re-elaborating
```

The GUI needs `DISPLAY` (and `XAUTHORITY` if it is not the default). The Makefile fails loudly when
`DISPLAY` is unset.

### Driving it with libnclt

```bash
cd demo/sim && make verdi-server PORT=11066
```

```
wvGetAllWindows
wvCreateWindow                                     # note the returned window id
wvOpenFile -win <WIN> <repo>/demo/sim/sync_fifo.fsdb
wvAddSignal -win <WIN> /tb_sync_fifo/clk /tb_sync_fifo/rst_n /tb_sync_fifo/rd_data
wvSetCursor -win <WIN> 40000
wvGetFileTimeUnit -win <WIN>                       # 1ps
```

**Gotcha:** the window opened by `-ssf` is not necessarily the window you want to drive. Call
`wvCreateWindow`, then `wvOpenFile` on that new window, then add signals.

The FSDB time unit is **1ps**, so a 40 ns cursor is `40000`, not `40`.

## Headless NPI query

```bash
cd demo/npi
./run_npi.sh
```

Expect `NPI SMOKE PASSED`, with `scale_unit=1ps`, `rd_data @ 40ns = XX`, `clk vc_count 0..240ns = 49`.
A one-shot NPI process costs ~3 s, most of it `npisys.init()`; the MCP server keeps a reader resident to
amortise that.

## Expected waveform landmarks

- `~0 ns`: `rd_data` is X (empty FIFO over uninitialised memory);
- after the first fill: `full=1`, `wr_ready=0`;
- a write attempt while full: `wr_valid=1`, `wr_ready=0`, `count` stays 4;
- simultaneous read and write: `rd_data=0xA3`, `count` stays 2;
- end: `TEST PASSED`, `empty=1`.
