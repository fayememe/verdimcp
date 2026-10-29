# Getting started

## Prerequisites

| Component | Why | Notes |
|---|---|---|
| Synopsys Verdi with `libnclt` | the `-serverPort` command channel | verified against `W-2024.09-SP1` |
| Bun ≥ 1.1 | runs the MCP server | `bun` on `PATH` |
| Python 3 + `pynpi` | headless FSDB reader | ships with Verdi under `$VERDI_HOME/share/NPI/python` |
| An X display | half the tools drive a real GUI | `DISPLAY` + readable `XAUTHORITY` |
| A Verdi license | Verdi itself | supplied by your site environment |

## Environment

The repository contains **no vendor paths, no license server address, no hostnames**. Source your own
environment first; the scripts stop if it is missing.

```bash
source /path/to/your/env.rc          # sets VCS, Verdi, VERDI_HOME, license variables
export VERDI_HOME                    # must be set; the tools derive everything else from it
echo "$DISPLAY"                      # must be non-empty for GUI tools
```

The server derives from `VERDI_HOME`, per call:

- `share/NPI/python` on `PYTHONPATH`
- `share/NPI/lib/linux64` and `platform/linux64/lib/Qt5/lib` on `LD_LIBRARY_PATH`
- `share/libcmd/linux64` for the `libnclt` client

If `VERDI_HOME` is unset, NPI tools return `not_supported` with a hint instead of guessing a path.

## Build and install

```bash
bash bin/build.sh          # compiles the libnclt client (cmdclient)
bash bin/install.sh        # -> ~/.local/libexec/verdi-session/ + ~/.local/bin/verdi-session
```

`verdi-session` is a small CLI that owns the session registry and serializes access:

```bash
verdi-session start --detach --label demo -- -f demo/sim/filelist.f -ssf demo/sim/sync_fifo.fsdb
verdi-session list --json
verdi-session exec --id <sid> --json 'wvGetAllWindows'
verdi-session stop --label demo
```

## Register the MCP server

Any stdio MCP client works. The command is portable — no absolute paths:

```json
{
  "mcpServers": {
    "verdi": {
      "command": "bun",
      "args": ["run", "mcp/src/server.ts"],
      "cwd": "/path/to/verdimcp"
    }
  }
}
```

For opencode, put the same block under `mcp.verdi` in `opencode.json`.

The server must inherit the environment you sourced: `VERDI_HOME`, `DISPLAY`, `XAUTHORITY`, `PATH`.

## First run

```bash
# 1. Start a design-aware session (needed for design trace and cones).
verdi-session start --detach --label demo -- \
  -f demo/sim/filelist.f -top tb_sync_fifo -ssf demo/sim/sync_fifo.fsdb -nologo
```

Then, from the agent:

```
verdi_capabilities          → engines and verified tools
verdi_sessions_list         → pick the session
verdi_windows_list          → nWave window id
verdi_value_get {signal: "/tb_sync_fifo/rst_n", time: 40, unit: "ns"}
verdi_xz_scan  {signals: ["/tb_sync_fifo/rd_data[7:0]"], start: 0, end: 240, unit: "ns"}
```

Three session flavours, and the argument decides what is possible:

```
-ssf <fsdb>                      waveforms only        (no driver trace, no cones)
-f filelist.f -top <top>         design library via sources
-dbdir simv.daidir               design library via KDB (needs VCS_HOME)
```

## Run the demo end to end

```bash
cd demo/sim && make sim          # VCS -> sync_fifo.fsdb
cd demo/sim && make verdi-server # open it in Verdi with a command port
```

## Verify the whole stack

```bash
bash scripts/acceptance.sh
```

This starts its own Verdi session (label `acceptance`), runs 97 checks through the MCP client, writes
evidence under `evidence/m1-m5/` (git-ignored), and stops only the session it started. It needs a display and a
license, and it opens a real GUI window — expect about two minutes.

Other checks:

```bash
bash scripts/lifecycle.sh     # start/stop timing
bash scripts/concurrency.sh   # 4 workers x 15 rounds against one session
bash scripts/writing-fsdb.sh  # read an FSDB while VCS is still writing it
bash scripts/remote-smoke.sh  # stdio MCP over a temporary sshd
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `VERDI_HOME is not set` | environment not sourced in the MCP client's shell | export it before starting the client |
| `no DISPLAY for the Verdi GUI` | non-interactive shell / SSH without `-X` | export `DISPLAY`; over SSH use `ssh -X` and check `echo $DISPLAY` |
| `session_not_found` | no session, or it died | `verdi-session list --json` |
| `ambiguous_session` | several sessions | pass `session_id` or `label` |
| `not_supported` + design-library hint | session started with `-ssf` only | restart with `-f` or `-dbdir` |
| `busy` / exit 75 | another agent holds the session lock | back off and retry in seconds |
| `connect to port ... failed` | the Verdi process died | see `skills/verdi-session-ops` |
