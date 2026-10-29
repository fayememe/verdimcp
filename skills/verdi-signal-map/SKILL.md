---
name: verdi-signal-map
description: Use when binding protocol roles to concrete signal paths, or when reusing an existing role→path profile (valid/ready/data/id/last/strobe) so the protocol-agnostic primitives work without hardcoded protocol logic. Covers building, validating, and reusing profiles.
---

# Signal maps (role → path)

## Why this exists

The MCP server knows nothing about AXI, APB, AHB or Wishbone. The primitives
(`verdi_handshake_beats`, `verdi_window_scan`, `verdi_change_stats`) take **roles**, and you supply the
paths. The mapping is the only place protocol knowledge becomes concrete — and it lives with you, not in
the server.

## Tools

| Tool | Purpose |
|---|---|
| `verdi_signal_map_put {name, signals:{role: path}}` | create/replace a profile |
| `verdi_signal_map_get {name}` | recall it |
| `verdi_signal_map_list` | see what exists before inventing a new one |

Storage: `~/.local/state/verdimcp/signal-maps.json`. Profiles are per user, not per session — name them
after the design and interface, not after the bug.

## Building one

1. `verdi_signals_list {search, kind}` — resolve real paths from the FSDB. Never type a path from memory.
2. Choose roles. The primitives understand these by convention:
   `clock`, `valid`, `ready`, `data`, `id`, `last`, `strobe`.
   `data` may be a list (multiple buses). Any other role name is allowed but only you will read it.
3. Store with a name that says what it is: `axi_wr_ch0`, `apb_cfg_port`, `fifo_status`.
4. Verify before trusting it:

```
verdi_handshake_beats {channel: <roles from the map>, start, end, max}
```

If beats is empty, one of the roles is wrong — usually `valid`/`ready` swapped or a bus bit range.

## Naming trap

- The map stores GUI-style or NPI-style paths as given; the primitives normalize internally.
- A bus is one path with a range: `/tb/dut/wdata[31:0]` — not 32 bit paths.
- If `verdi_signals_list` shows `wdata[31:0]` under a different scope than you expected, the map is wrong
  even if the name "looks right". Trust the dump.

## Rules

- One profile per interface per design. Do not mutate an existing profile for a new bug — put a new name.
- Never infer a role from a signal name alone when the FSDB can tell you: a signal that never toggles is
  probably not `valid`.
- Record in the answer which profile you used (`signal_map: axi_wr_ch0`), so the run is reproducible.
- Profiles are not evidence. The beats/values produced with them are.

## Worked example

```
verdi_signal_map_put {
  name: "axi_wr_ch0",
  signals: {
    clock: "/tb/axi/aclk",
    valid: "/tb/axi/awvalid",
    ready: "/tb/axi/awready",
    data:  "/tb/axi/awaddr[31:0]",
    id:    "/tb/axi/awid[3:0]"
  }
}
verdi_handshake_beats {channel: axi_wr_ch0, start: 0, end: 5000, unit: "ns", max: 200}
```

Then interpret: 0 beats = the channel never completed an address transfer; >0 beats = it did, so the
failure is downstream (data/response), not the address handshake.
