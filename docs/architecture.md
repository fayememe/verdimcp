# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ skills/            judgment: when to query, what it means    │
├──────────────────────────────────────────────────────────────┤
│ mcp/               primitives: typed tools, no protocol words│
├──────────────────────────────────────────────────────────────┤
│ bin/verdi-session  transport + registry + locking            │
├──────────────────────────────────────────────────────────────┤
│ Verdi GUI          Tcl over libnclt (loopback socket)        │
│ NPI FSDB reader    out-of-process, reads the file directly   │
└──────────────────────────────────────────────────────────────┘
```

verdimcp knows how to ask; the skills know what to ask. A protocol rule inside verdimcp turns into a fork.
The same rule in a skill is a paragraph.

## Transport

Verdi is started with `-serverPort <n>`; `libnclt` connects over loopback and evaluates Tcl in-process.
`bin/cmdclient` is the thin C client; `bin/verdi-session` wraps it with:

- a registry at `~/.local/state/verdi-sessions/` (one JSON file per session)
- automatic port allocation
- `flock` per session, so concurrent GUI calls serialize instead of interleaving
- JSON in, JSON out, with the Tcl command echoed back

Every call returns `{results:[{command, ok, result}], events:[...], stderr, exitCode}`. Events are how the
transport reports asynchronous GUI activity (`wvCreateWindow`, font changes, redraws).

## Engines

Two independent ways to read data, and the caller can force either:

| | GUI | NPI |
|---|---|---|
| process | the live Verdi | a separate Python worker |
| cost | one round trip per query | read from the FSDB |
| glitches | `wvSearchNextBySignal` skips them | every transition |
| can capture | yes | no |
| needs | a display + window | an FSDB path |
| startup | already running | ~3 s init, amortized when resident |

`engine=auto` picks one per tool (documented in each tool description), and the response records the
decision:

```json
"engine": {"requested":"auto","used":"npi",
           "reason":"auto: NPI (max=5000 > 200, fsdb known)",
           "elapsed_ms":655,"alternatives":["gui"],"fallback":false,"switch_hint":null}
```

Rules enforced in code:

- An explicit engine is respected. `engine="gui"` never touches NPI; a failing `engine="npi"` returns an
  error with `details.hint` rather than silently degrading.
- `auto` may fall back, but must set `fallback: true` and quote the failure in `reason`.
- A slow call may emit `switch_hint` — advice only. There is no automatic retry: a retried query is a
  second expensive operation the caller did not ask for.

## FSDB completeness

Every result that touched an FSDB carries:

```json
"fsdb": {"path":"...","max_time":240,"is_completed":true,"unit":"ns",
         "covers_requested_range":true,"warning":null}
```

The worker attaches `fsdb_state` to each response, so an NPI query pays nothing extra. A GUI-only query
makes one best-effort `info` call; if that fails the block becomes `null` and the query still succeeds.

This exists because an FSDB being written is a real state: `max_time` grows, `is_completed` flips at the
end, and without `$fsdbDumpflush` the file can report a full range while missing content.

## Resident NPI reader

One Python process per MCP server (`npi_worker.py --serve`), one FSDB handle, requests serialized over
stdin lines. `npisys.init()` is paid once. Idle timeout closes it (`VERDI_MCP_NPI_IDLE_MS`, default 10 min).
Transport failures fall back to a one-shot process; query-level errors do not retry.

## Evidence model

```
evidence bundle (id, title, session)
 ├── items[]   value | changes | source | check | screenshot | cone | compare
 └── query_used  the exact tool + arguments that produced the item
```

`query_used` is what makes a report falsifiable: `evidence_report` renders a reproduce section from it.
Artifacts live under `~/.local/state/verdimcp/{evidence,screenshots}/` and are referenced by path, size
and `sha256`.

## Sessions and isolation

- Only sessions in this user's registry, with a matching `-serverPort` in the cmdline, are touched.
- `verdi_session_start` only ever detaches a new GUI; it never attaches to one it did not start.
- `verdi_session_stop` only stops registry sessions.
- Registry rows carry state (`up` / `down` / `stale`); `verdi-session prune` clears dead ones.

## Security posture

| Concern | Handling |
|---|---|
| arbitrary Tcl | `verdi_tcl_exec` exists but is off unless `VERDI_ALLOW_RAW=1`; each command is audited |
| other users' GUIs | never touched; no attach, no signals, no kill |
| GUI mutation | separate tools (`window_create`, `signals_add`, `cursor_set`, `capture_annotate`, `cone_capture`, `waveform_compare`) so callers can see it |
| data leaving the host | out of scope by design: only signal names, times, conclusions and minimal snippets are returned |
| credentials | none stored; licensing is whatever your environment provides |
| audit | `~/.local/state/verdimcp/audit.jsonl` records command, session, window, rc, elapsed |

## Error model

| Code | Meaning |
|---|---|
| `session_not_found` | no such session |
| `ambiguous_session` | several up; caller must choose |
| `session_down` | the process is gone |
| `window_not_found` | no nWave window / no X id |
| `not_supported` | missing prerequisite: FSDB, design library, native annotation, display |
| `timeout` | transport or worker timeout |
| `busy` | session lock held by another client (exit 75) |
| `backend_error` | unexpected failure, details attached |
| `invalid_argument` | bad request shape |

`not_supported` is a first-class answer, not an error to route around. It is how verdimcp says "Verdi
will not give you this" without inventing a result.
