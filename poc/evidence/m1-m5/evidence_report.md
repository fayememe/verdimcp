# acceptance evidence

- evidence_id: `e5294521-a15c-41ef-b815-7ccc8d25d9aa`
- session: `55171e58`
- created: 2026-10-28T04:31:55.757Z
- conclusion: (not set)
- confidence: uncertain

## Items

### screenshot `8a1f378e-1d0f-4de3-9b95-845eed8780de`

```json
{
  "screenshot": {
    "path": "/home/faye/.local/state/verdi-mcp/screenshots/55171e58-4bf08700-1793161921442.png",
    "width": 2560,
    "height": 615,
    "bytes": 40252,
    "sha256": "29245a19c5b4637b024593f34045c5fb404c91926d385f2bffca416b767f24db",
    "xid": "0x2e0054d"
  },
  "annotations": [
    {
      "type": "marker",
      "time": 40000,
      "label": "agent_m1",
      "applied": true
    },
    {
      "type": "comment",
      "time": 0,
      "end": 80000,
      "label": "agent: window",
      "row_id": "4d64c4b0",
      "applied": true
    },
    {
      "type": "highlight",
      "signal": "/tb_sync_fifo/clk",
      "label": "clk",
      "color": "ID_BLUE3",
      "applied": true
    }
  ],
  "roi": {
    "signals": [
      "/tb_sync_fifo/clk",
      "/tb_sync_fifo/rst_n"
    ],
    "start": 0,
    "end": 240,
    "unit": "ns"
  }
}
```

Reproduce:
```json
{
  "tool": "verdi_capture_annotate",
  "arguments": {
    "evidence_id": "e5294521-a15c-41ef-b815-7ccc8d25d9aa",
    "session_id": "55171e58",
    "signals": [
      "/tb_sync_fifo/clk",
      "/tb_sync_fifo/rst_n"
    ],
    "start": 0,
    "end": 240,
    "unit": "ns",
    "annotations": [
      {
        "type": "marker",
        "time": 40,
        "label": "agent_m1"
      },
      {
        "type": "comment",
        "time": 0,
        "end": 80,
        "label": "agent: window"
      },
      {
        "type": "highlight",
        "signal": "/tb_sync_fifo/clk",
        "label": "clk",
        "color": "ID_BLUE3"
      }
    ]
  }
}
```

### waveform `8a112a23-828a-494e-b9ef-45f799207975`

```json
{
  "path": "/home/faye/.local/state/verdi-mcp/evidence/render-8070edfb-281b-4c0f-803e-882adf8e248a.png",
  "svg_path": "/home/faye/.local/state/verdi-mcp/evidence/render-8070edfb-281b-4c0f-803e-882adf8e248a.svg",
  "width": 680,
  "height": 88,
  "bytes": 13052,
  "signals": 2,
  "bins": 200,
  "source": "npi"
}
```

Reproduce:
```json
{
  "tool": "verdi_waveform_render",
  "arguments": {
    "evidence_id": "e5294521-a15c-41ef-b815-7ccc8d25d9aa",
    "session_id": "55171e58",
    "signals": [
      "/tb_sync_fifo/clk",
      "/tb_sync_fifo/rst_n"
    ],
    "start": 0,
    "end": 240,
    "unit": "ns",
    "bins": 200
  }
}
```

### value `6bd2711e-57d3-4e14-9d71-c17876b41050`

```json
{
  "signal": "/tb_sync_fifo/rst_n",
  "time": 40,
  "value": "1"
}
```

Reproduce:
```json
{
  "tool": "verdi_value_get",
  "arguments": {
    "signal": "/tb_sync_fifo/rst_n",
    "time": 40,
    "unit": "ns"
  }
}
```

