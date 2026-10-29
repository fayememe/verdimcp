---
name: verdi
description: Entry point for any Synopsys Verdi / nWave / FSDB work through the verdi MCP tools. Routes a symptom to the right skill, states the safety rules, and explains the GUI-vs-NPI cost model. Use when the user says Verdi, nWave, FSDB, waveform, simulation debug, signal is X, bus never arrived, or asks to prove what a simulation did.
---

# Verdi: entry and routing

Read this first. It decides which other skill to load.

## Scope

**In:** observe and operate a running Verdi/nWave session — query values, trace design structure, capture
visual evidence, build a reproducible report.
**Out:** editing RTL, re-running simulation, static lint, log parsing, power/CDC/coverage products.
Those are other tools' jobs; do not grow this MCP into them.

## Safety (non-negotiable)

- Only operate sessions in this user's `verdi-session` registry. Never attach to, signal, or kill another
  user's Verdi. On a shared host an engineer may be using that GUI right now.
- Read-only by default. These change the GUI: `window_create`, `signals_add/remove`, `cursor_set`,
  `fsdb_open`, `capture_annotate`, `cone_capture`, `waveform_compare`, `session_start/stop`.
  Name the target session before calling them when more than one is up.
- `verdi_tcl_exec` is disabled unless the server runs with `VERDI_ALLOW_RAW=1`. Do not ask for it to be
  enabled to work around a missing typed tool — say what is missing instead.
- No RTL or FSDB content leaves the machine. Quote signal names, times and conclusions, not source dumps.

## First three calls

1. `verdi_capabilities` — which engines exist, which tools are verified.
2. `verdi_sessions_list` — pick a session; if exactly one is `up`, `session_id` may be omitted everywhere.
3. `verdi_windows_list` — an nWave window must exist before most waveform work.

## Route by symptom

| Symptom | Skill |
|---|---|
| "signal is X or Z", "unknown value", "where did this X come from" | `verdi-xz-debug` |
| "this transfer never completed", "valid but no ready", "the bus never arrived" | `verdi-bus-debug` |
| "who drives this", "why is this value here" | `verdi-design-trace` |
| "show me the logic behind this", need a schematic artifact | `verdi-cone-evidence` |
| "it worked last run", "this changed / got slower" | `verdi-regression-diff` |
| "what values / edges does this signal have" | `verdi-waveform` |
| "find the cycle where A then B", a rule to re-run | `verdi-temporal-pattern` |
| "map AXI/APB signals onto tool roles" | `verdi-signal-map` |
| "start/stop a session", concurrency, remote display | `verdi-session-ops` |
| "package this into something I can send" | `verdi-evidence` |
| "rendering is slow", "128 signals", "big FSDB" | `verdi-performance` |

## Two engines, different physics

Every waveform query is served by one of two engines, and the response always says which
(`engine.used` + `engine.reason`):

- **NPI** — reads the FSDB directly, off-process. Every transition, no glitches skipped, no GUI needed.
  ~3 s init per call unless the resident reader is warm (then 0.1–1.3 s).
- **GUI** — drives the live nWave session. Can mutate and capture the window, but `wvSearchNextBySignal`
  skips glitches and every query is a round trip.

Measured at 903 MB / 128 signals: NPI full-window render 30.6 s, GUI same-window 9.7 s.
**NPI is not automatically faster.** Use `engine.auto` and obey `engine.switch_hint` — it appears only
when a call passed 15 s and the other engine is genuinely available.

## Read `fsdb` on every result

`verdi_transitions_get`, `verdi_xz_scan`, `verdi_change_stats` return:

```json
"fsdb": {"max_time": 9.47, "is_completed": false, "covers_requested_range": true, "warning": null}
```

- `is_completed: false` → the FSDB is still being written. Absence of hits **after `max_time`** proves
  nothing. Never report "never happened" from an incomplete FSDB.
- `covers_requested_range: false` → the request ran past the data; results are clipped.
- `max_time` at the full range while `is_completed: false` and the file is small → VCS buffering without
  `$fsdbDumpflush`; the file may be missing data its timestamps claim.

## Evidence labels (use them in every answer)

- **VERIFIED** — you called a tool and read the value/edge/image yourself.
- **INFERRED** — concluded from an image, a cone, or a correlation. Say so.
- **DOCUMENTED_ONLY** — a document says it; you did not run it.
- **NOT_TESTED** — nobody ran it.

A cone or screenshot is **VERIFIED evidence about pixels** and **INFERRED evidence about logic**.
Do not blur those two.

## Degradation ladder

1. Design library present → structure is available (`design-trace`, `cone-evidence`).
2. FSDB only → waveforms and time correlation; **no cone**. Say `not_supported`, do not draw a fake cone.
3. GUI unavailable → NPI still answers value/transition/XZ/stats; no capture, no annotation.
4. NPI unavailable → GUI sampling only; every XZ/scan result becomes a candidate list, `degraded: true`.

## Errors

`session_not_found` / `ambiguous_session` → list and ask; never pick by guess.
`session_down` → the process is gone; use `verdi-session-ops`.
`not_supported` → missing prerequisite (FSDB, design library, native annotation). Report it.
