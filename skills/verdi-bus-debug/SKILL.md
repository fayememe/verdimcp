---
name: verdi-bus-debug
description: Use when a bus/handshake is stuck or a transaction never arrives. Drives the protocol-agnostic primitives (signal map, handshake beats, change stats, window scan, declarative checks) and applies protocol rules from this skill's grounding text — the MCP server contains no protocol semantics.
---

# Bus / handshake debug

## Scope

**In:** "the write never landed", "valid is high but ready is not", "the response came back on the wrong ID",
"the bus never arrived". A handshake that is *blocked* or *misordered*.
**Out:** X/Z on the bus itself (→ `verdi-xz-debug`), performance/outstanding analysis (not implemented),
and any protocol decoder (there is none on purpose; see the must-not list).

## Decision flow

1. **Identify the interface and protocol** from the system docs or the user's description. Write down
   which channel(s) matter before touching a tool.
2. **Build a signal map** — `verdi_signal_map_put {name, signals:{role: path}}`, roles are free-form
   (`clock`, `valid`, `ready`, `data`, `id`, `last`, `strobe`). Reuse existing ones with
   `verdi_signal_map_list` / `verdi_signal_map_get`. Details: `verdi-signal-map`.
3. **Measure before reading raw data**
   - `verdi_change_stats` on the channel signals → volume, decide GUI vs NPI. Read `fsdb.is_completed`.
   - `verdi_handshake_beats {channel, clock, valid, ready, data?, id?, last?, start, end}` → every cycle
     where `valid && ready`, with the payload. This is the transaction list you actually reason about.
4. **Find the first violation** with `verdi_window_scan`, e.g. `valid && !ready`, optionally
   `min_duration`. Report `truncated`, the `step`, and that it is sampled.
5. **Apply the protocol rules** below, one rule at a time. Each rule either holds, fails at a stated time,
   or is not checkable with the available signals — say which.
6. **Freeze a deterministic check** once the rule proves useful:
   `verdi_check_define {name, predicate, params}` → `verdi_check_run {check_id}`.
7. **Produce evidence** with `verdi-evidence` (annotated capture + handshake beats + check result).

## Tool notes

- `handshake_beats` needs a `clock` role for per-cycle beats; without one it samples at value-change times
  and you must not call them "cycles".
- `engine.used` tells you whether the transition list can have skipped glitches (`gui` can, `npi` cannot).
- `change_stats` never returns the raw change stream. Do not try to reconstruct it from other calls.
- Never return a million transitions to the agent; aggregate first, then narrow.
- A blocked handshake proves a **stall**, not a **cause**. The cause is one hop upstream: go to
  `verdi-design-trace` or capture the cone with `verdi-cone-evidence`.

## Grounding text (protocol knowledge lives here, not in the server)

### AXI4 / AXI4-Lite

- `AWVALID`/`AWREADY`, `WVALID`/`WREADY`, `BVALID`/`BREADY`, `ARVALID`/`ARREADY`, `RVALID`/`RREADY` are
  independent valid/ready pairs.
- Once `VALID` asserts it must stay asserted until the matching `READY` (no withdrawal).
- A beat transfers only when `VALID && READY` in the same cycle.
- `WLAST` marks the final write beat; `RLAST` the final read beat.
- `B` must not precede the last `W` beat; response ordering follows the protocol.
- AXI4-Lite has no bursts: no `AWLEN/AWSIZE/AWBURST`, no `WLAST/RLAST`.
- `AWID/BID/ARID/RID` pair responses to requests — check ID consistency.

### AXI4-Stream

- `TVALID`/`TREADY`; `TLAST` marks a packet boundary.
- `TVALID` must not be withdrawn before `TREADY`.
- `TKEEP`/`TSTRB` define valid bytes; check them against the `TDATA` width.

### APB

- `PSEL && PENABLE` marks the access phase; `PREADY` completes it.
- `PWRITE`, `PADDR`, `PWDATA`, `PRDATA` are sampled during the access phase.
- `PSLVERR` reports an error response — check it is captured.
- APB has no burst/ID; do not apply AXI rules.

### AHB / AHB-Lite

- `HTRANS` (`NONSEQ`/`SEQ`/`IDLE`/`BUSY`), `HREADY`, `HRESP` define address/data phases.
- A transfer completes when `HREADY` is high; wait states insert `HREADY=0`.
- `HRESP` error responses take two cycles — check pipelining.
- `HBURST`/`HSIZE` define burst behaviour; AHB-Lite has a single master.

### Wishbone

- `STB`/`ACK` (optionally `CYC`) form the handshake; `WE`, `ADR`, `DAT` carry the operation.
- `ACK` must not assert without `STB`; check `CYC` framing.
- Classic vs pipelined differ in when `STB` may drop — state which variant you assume.

> These rules are prompt knowledge, not MCP code. If a rule is not in the system docs, label the
> conclusion `likely` / `uncertain` and cite where it came from.

## Must-not

- Do not add protocol strings to the MCP server, and do not ask for a protocol decoder tool.
- Do not apply one protocol's rules to another because the signal names look similar.
- Do not claim a protocol violation from sampled data alone.

## Reporting

```
channel:   wr (clock clk, valid wr_valid, ready wr_ready, data wr_data)
beats:     12 in 0..240 ns            (NPI, fsdb.completed=true, not truncated)
first bad: 115.43 ns  wr_valid=1, wr_ready=0   (VERIFIED sampled, step 0.48 ns)
stall len: >= 124 ns (to end of window)        (VERIFIED from transitions: wr_ready never rose)
upstream:  fifo_full held high since 84 ns     (VERIFIED via transitions_get)
rule:      AXI4 once-VALID-asserted — not violated; this is backpressure, not a protocol error (INFERRED)
check:     wr_stall (7dcf91b9) frozen for re-run
```
