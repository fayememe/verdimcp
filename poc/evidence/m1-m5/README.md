# M1–M5 acceptance evidence

> 2026-10-18 · f29 · Verdi W-2024.09-SP1 · demo `sync_fifo`

## Command

```bash
cd /home/faye/mydrv/aiwork/verdimcp
bash scripts/acceptance.sh
```

The script starts its own Verdi session (`label=acceptance`), runs the MCP acceptance client, captures evidence, and stops only that session.

## Result

- **ACCEPTANCE PASSED**, exit code 0, **56 checks**.
- Session: `1632fa17`, port `11898`, pid `3145409`, cwd `demo/sim`, display `localhost:10.0`.
- FSDB: `demo/sim/sync_fifo.fsdb` (time unit `1ps`).
- Design library: `-f demo/sim/filelist.f -top tb_sync_fifo` (design trace succeeded).

## Files

| File | Content |
|---|---|
| `summary.json` | machine-readable checks (`ok: true`, 56 entries) |
| `mcp-smoke.log` | timestamped tool calls and envelopes |
| `mcp-smoke.console.log` | stdout of the acceptance run |
| `session.json` | full session entry (`verdi-session info`) |
| `sessions.json` | registry snapshot during the run |
| `start.log` / `stop.log` | session lifecycle |
| `screenshot.png` | nWave window, 2560×615, 22,788 bytes, sha256 `c1a59106…` |

## Highlights

- `verdi_value_get /tb_sync_fifo/rst_n @40ns` → `1`.
- `verdi_transitions_get /tb_sync_fifo/clk` → 49 transitions in 0–240 ns (NPI).
- `verdi_xz_scan /tb_sync_fifo/rd_data[7:0]` → `XX` at 0 ns (NPI).
- `verdi_drivers_get tb_sync_fifo.clk` → 2 leaf pins; `fanin` and `fanout` also succeeded.
- `verdi_source_get` by signal → `demo/tb/tb_sync_fifo.v:6`; by file → `demo/rtl/sync_fifo.v`.
- Screenshot returned both a file and inline MCP image content.

## Safety

- Only the `acceptance` label was started/stopped; no other Verdi sessions were touched.
- After the run, `verdi-session list --json` is `[]` and no `-serverPort` Verdi process remains.
- Audit log: `~/.local/state/verdi-mcp/audit.jsonl` (cumulative; 109 entries at the final run).

## Notes

- This is a demo FSDB. Large FSDB, NPI P1, multi-agent concurrency, and SSH remote mode remain **NOT_TESTED**.
- The screenshot path in `summary.json` points at `~/.local/state/verdi-mcp/screenshots/`; `screenshot.png` is a copy for the repo.
