# Skills

Twelve decision flows. Each one contains: scope (when it applies and when it does not), call order,
degradation when a prerequisite is missing, and the evidence label the conclusion deserves.

Skills are plain markdown. No code, and no protocol strings in verdimcp, so adding a protocol costs a
mapping and a paragraph.

## Routing

```
                        ┌─────────────┐
   any Verdi question ──►    verdi    │  (entry, safety, routing)
                        └──────┬──────┘
        ┌───────────┬──────────┼──────────┬───────────┬──────────┐
        ▼           ▼          ▼          ▼           ▼          ▼
   bus-debug    xz-debug   design-trace  waveform  temporal  regression
        │           │          │                     │          │
        └─────┬─────┴────┬─────┘                     │          │
              ▼          ▼                           ▼          ▼
        signal-map  cone-evidence              check_define  waveform_compare
              │          │
              └────┬─────┘
                   ▼
              evidence ◄── session-ops (gets you a session)
                   ▼
              performance (cost model)
```

## The twelve

| Skill | Applies to | Does not apply to |
|---|---|---|
| `verdi` | anything touching a live session | the analysis itself |
| `verdi-session-ops` | lifecycle, several sessions, remote display, a dead GUI | reading values |
| `verdi-waveform` | values, edges, cursor, signal lists, bounded renders | interpreting X/Z or handshakes |
| `verdi-signal-map` | binding roles to paths, reusing profiles | protocol legality |
| `verdi-bus-debug` | a blocked or misordered handshake | X/Z on the bus, performance |
| `verdi-xz-debug` | X/Z taxonomy, first occurrence, root cause | clean 0/1 functional bugs |
| `verdi-design-trace` | driver / load / fan-in / fan-out / source | cone images, protocol rules |
| `verdi-cone-evidence` | producing and reading a cone artifact | numbers that a query could give |
| `verdi-temporal-pattern` | "A then B", sustained conditions, frozen checks | protocol decoders |
| `verdi-regression-diff` | this run vs the previous run | formal equivalence |
| `verdi-evidence` | packaging an investigation | making a weak conclusion look strong |
| `verdi-performance` | slow queries, big FSDB, engine choice | throughput/latency/outstanding (no tools) |

## What a decision flow looks like

`verdi-xz-debug`, condensed:

1. **Classify before tracing.** Undriven / uninitialized / tri-state / propagation. "X at time 0" and
   "X appeared at 1.2 µs" have different causes.
2. **Find the first occurrence.** `xz_scan` (NPI) over the signal or scope; read `fsdb.is_completed`.
3. **Trace the cone.** `cone_capture(mode: "x", time)` — nSchema at that timestamp, `schTraceX`, PNG.
4. **Say what is missing.** No design library → time correlation only, conclusion labelled INFERRED, and name
   the structural question you could not answer.
5. **Report in a fixed shape.** signal / first X / category / cone / root cause / what is not proven.

That last line matters: the skill forbids collapsing observation, category and cause into one sentence.

## Protocol grounding

`verdi-bus-debug` carries rule text for five protocols — AXI4 and AXI4-Lite, AXI4-Stream, APB, AHB/AHB-Lite,
Wishbone — with a note that these rules are prompt knowledge, not MCP code, and that a rule outside the
system documents must be labelled `likely`/`uncertain`.

The mechanics are protocol-agnostic:

```
signal_map_put(name, {clock, valid, ready, data, id})
handshake_beats(channel)             → completed beats with payload
window_scan("valid && !ready")       → first stall, optionally min_duration
check_define(name, predicate)        → freeze the rule, re-run deterministically
```

Adding a protocol means adding a mapping and a paragraph. Nothing in `mcp/` changes.

## Evidence discipline

Every skill ends with the same requirement: state the label.

| Label | Means |
|---|---|
| `VERIFIED` | you called a tool and read the result |
| `INFERRED` | you concluded from an image, a cone, or a correlation |
| `DOCUMENTED_ONLY` | a document says it; you did not run it |
| `NOT_TESTED` | nobody ran it |

A cone image is VERIFIED evidence about pixels and INFERRED evidence about logic. Skills say this
explicitly because it is the mistake most likely to waste a reviewer's afternoon.

## Extending the library

1. Check the routing table — is this a new *decision*, or a paragraph inside an existing skill?
2. A new skill must add a judgement the primitives cannot make. If it only re-lists tools, do not add it.
3. Every skill needs a "do not" section. Skills that only say what to do get followed into walls.
4. Keep protocol knowledge in the skill, never in `mcp/`.
