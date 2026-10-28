---
name: verdi-performance
description: Use only for throughput / latency / outstanding / bottleneck analysis. v2 — NOT implemented in this round; no MCP tools exist yet. Do not fabricate performance results.
---

# Performance debug (v2 — not implemented)

This skill is a placeholder for the v2 performance lever. **No MCP tool currently exists** for throughput, latency, outstanding transactions, or bottleneck attribution.

If the user asks for performance analysis today:

1. Use `verdi_change_stats` / `verdi_transitions_get` only for raw activity counts, clearly labeled as raw observations.
2. Do not claim throughput/latency/bottleneck conclusions from those counts.
3. State that the dedicated performance workflow is planned for v2 and is not implemented.

Planned v2 scope (design only): throughput/latency measurement, outstanding-transaction tracking, bottleneck attribution, clock-domain crossing summaries. Do not preload protocol-specific checkers in the server.
