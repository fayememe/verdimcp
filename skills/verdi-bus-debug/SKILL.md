---
name: verdi-bus-debug
description: Use when a bus/handshake is stuck or a transaction never arrives. Drives the protocol-agnostic primitives (signal map, handshake beats, change stats, window scan, declarative checks) and applies protocol rules from this skill's grounding text — the MCP server contains no protocol semantics.
---

# Bus / handshake debug

## Decision flow

1. **Identify the interface and protocol** from the system docs / user description. Record which channel(s) matter.
2. **Build a signal map** with `verdi_signal_map_put`: bind free-form roles (`clock`, `valid`, `ready`, `data`, `id`, `last`, `strobe`) to absolute paths. Reuse with `verdi_signal_map_get`.
3. **Measure** before reading raw data:
   - `verdi_change_stats` for volume (decide GUI vs NPI).
   - `verdi_handshake_beats` for every `valid && ready` cycle with data.
4. **Find the first violation** with `verdi_window_scan`, e.g. `valid && !ready` (optionally `min_duration`).
5. **Apply protocol rules** from the grounding text below, one rule at a time.
6. **Freeze a deterministic check** with `verdi_check_define`; re-run with `verdi_check_run` when the rule is validated.
7. **Produce evidence** with `verdi-evidence` (GUI capture + machine items).

## Tool notes

- `handshake_beats` needs a clock role for per-cycle beats; without a clock it samples at value-change times.
- `window_scan` samples at `bins` points; report `truncated` and the sampling step. It is a candidate finder, not a proof of every delta-cycle.
- NPI skips glitches; for exact delta-cycle claims use GUI transitions or state the limitation.
- Do not return a million transitions to the agent; use `change_stats` / `window_scan` first.

## Grounding text (protocol knowledge lives here, not in the server)

### AXI4 / AXI4-Lite (common checks)

- `AWVALID`/`AWREADY`, `WVALID`/`WREADY`, `BVALID`/`BREADY`, `ARVALID`/`ARREADY`, `RVALID`/`RREADY` are independent valid/ready pairs.
- Once `VALID` is asserted it must remain asserted until the corresponding `READY` (no withdrawal).
- A beat transfers only when `VALID && READY` on the same cycle.
- `WLAST` marks the final write beat; `RLAST` the final read beat.
- `B` must not precede the last `W` beat; response ordering follows the protocol.
- AXI4-Lite has no bursts; `AWLEN/AWSIZE/AWBURST` and `WLAST/RLAST` are not used.
- `AWID/BID/ARID/RID` pair responses to requests; check ID consistency.

### AXI4-Stream

- `TVALID`/`TREADY`; `TLAST` marks a packet boundary.
- `TVALID` must not be withdrawn before `TREADY`.
- `TKEEP`/`TSTRB` define valid bytes; check against `TDATA` width.

### APB

- `PSEL && PENABLE` marks the access phase; `PREADY` completes it.
- `PWRITE`, `PADDR`, `PWDATA`, `PRDATA` are sampled in the access phase.
- `PSLVERR` reports an error response; check it is captured.
- APB has no burst/ID; do not apply AXI rules.

### AHB / AHB-Lite

- `HTRANS` (`NONSEQ`/`SEQ`/`IDLE`/`BUSY`), `HREADY`, `HRESP` define address/data phases.
- A transfer completes when `HREADY` is high; wait states insert `HREADY=0`.
- `HRESP` error responses have a two-cycle response; check pipelining.
- `HBURST`/`HSIZE` define burst behavior; AHB-Lite has a single master.

### Wishbone

- `STB`/`ACK` (and optionally `CYC`) form the handshake; `WE`, `ADR`, `DAT` carry the operation.
- `ACK` must not be asserted without `STB`; check `CYC` framing.
- Classic vs pipelined variants differ in when `STB` may drop; state which variant you assume.

> These rules are prompt knowledge, not MCP code. If a rule is not in the system docs, label the conclusion `likely`/`uncertain` and cite the source.
