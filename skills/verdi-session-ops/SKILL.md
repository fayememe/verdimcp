---
name: verdi-session-ops
description: Use when starting or stopping a Verdi session, when several sessions exist, when the GUI died or is unreachable, or when running over SSH. Covers the registry, the per-session flock, display handling, and crash recovery.
---

# Session operations

## Scope

**In:** lifecycle (start/stop), choosing among sessions, remote/SSH display problems, a dead or stuck GUI.
**Out:** the analysis itself — this skill only gets you a working session, then hands off.

## Ground rules

- The registry is `~/.local/state/verdi-sessions/`. Only sessions listed there, `state == "up"`, with a
  matching `-serverPort` in the cmdline, may be touched.
- **Never** attach to, signal, or kill a Verdi you did not start. On a shared host other engineers have
  GUIs without `-serverPort`; they are invisible to this tool and must stay untouched.
- All GUI calls go through a per-session `flock`. A second agent gets exit code 75 (`busy`) instead of
  corrupting results. That is correct behaviour, not an error to retry in a tight loop.

## Choosing a session

1. `verdi_sessions_list` → fields include `id`, `label`, `state`, `port`, `pid`, `fsdb`, `display`, `cwd`.
2. If exactly one is `up`, omit `session_id` everywhere.
3. If several are `up`, use `label` (started by a script) or the `fsdb` path to justify a choice, then say
   which one you picked. `ambiguous_session` means you must ask — never pick by guess.

## Starting

`verdi_session_start {label, args:[...], display?}` — always detach; it never attaches to an existing GUI.

The args matter more than the tool:

```
-f filelist.f -top tb -ssf run.fsdb          # design library via sources (design trace + cones work)
-dbdir simv.daidir -ssf run.fsdb             # KDB; needs VCS_HOME, matches the FSDB elaboration
-ssf run.fsdb                                # waveforms only — no driver trace, no cone
```

Startup is ~31 s including elaboration. `state: "up"` on the port does **not** mean elaboration finished;
wait ~20 s before the first design-trace call or it returns garbage/`not_supported`.

## Stopping

`verdi_session_stop {session_id|label}` — registry sessions only, ~0.6 s. Never `kill -9` a Verdi: the
FSDB handle and the X connection can be left in a bad state.

## Concurrency (measured)

4 workers × 15 rounds = 60 concurrent calls against one session: no result crossover, lock contention
surfaced as rc=75 `busy`, long waits serialized correctly. So: no broker is needed. If you see `busy`,
back off (seconds, not milliseconds) and retry.

## Remote / SSH

- A non-interactive SSH shell inherits no `DISPLAY`; GUI tools then fail with a screenshot or X error.
- Fix per call: `verdi_session_start {display: ":10"}` and `XAUTHORITY` must be readable by the server.
- Stdio MCP over SSH works (handshake 294 ms, all tools visible) — the MCP stream stays clean because all
  Verdi/NPI noise goes to stderr.
- Running a *query* remotely and a *capture* locally is fine; running captures over a slow link is not
  (each capture is a full-window PNG).

## Crash recovery

Symptoms: `session_down`, `connect to port <n> failed`, `backend_error` mid-call.

1. `verdi_sessions_list` — is the session still `up`?
2. `verdi-session prune` (CLI) cleans stale registry rows.
3. **Do not silently restart** a session someone else may be watching. Report the death, then ask.
4. Known reproducible crash cause: `verdi_waveform_compare` after nSchema windows were opened in the same
   session killed Verdi W-2024.09 once. If you must compare, use a fresh session, and do it before cone
   captures.
5. After a crash, the GUI user loses their window layout — say so explicitly instead of just retrying.

## Do not

- Do not start a session per query; each start costs ~31 s and a GUI window.
- Do not leave sessions running after a scripted task; stop what you started.
- Do not touch sessions whose `state` is `stale`/`down` other than to prune the registry entry.
