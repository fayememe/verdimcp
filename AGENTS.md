# AGENTS.md — project constitution

> This file outranks your instincts. It applies to humans and AI agents equally.
> If it conflicts with `docs/`, the frozen design document wins and this file gets fixed.

## 0. A session is disposable, the document is not

Every working session may be interrupted and never resumed. Anything that exists only in a conversation is
lost. Therefore:

- **Write as you go.** Each decision, finding or dead end goes into `docs/` the moment it is settled.
- Assume the next contributor knows nothing about your conversation. They can read the repo; make that
  enough.
- Leave an open question in the docs rather than in your head.

## 1. The docs are the source of truth

Code implements the docs, not the other way around.

1. Change `docs/` first (or the tool description, which is the public contract).
2. Get it reviewed.
3. Then change code.

When behaviour changes, the doc changes in the same commit.

## 2. Evidence discipline

Every claim in a doc, a report or a commit message carries one of:

| Label | Means |
|---|---|
| `VERIFIED` | actually executed on a real installation and observed |
| `INFERRED` | reasoned from evidence, not directly observed |
| `DOCUMENTED_ONLY` | a document says so; nobody ran it |
| `NOT_TESTED` | nobody ran it and no document claims it |

Rules:

- Never upgrade a label without a new observation.
- A negative result is a result. Record it — the next person will otherwise spend a day rediscovering it.
- A screenshot is VERIFIED evidence about pixels and INFERRED evidence about logic.
- If a tool returned `not_supported`, write that. Do not paraphrase it into a result.

## 3. Hard rules

- **No type/error suppression.** No `as any`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`.
- **No silent failure.** No empty `catch`, no `except: pass`. Log it and degrade explicitly, or fail loudly.
- **No secrets in the repo.** No license strings, tokens, hostnames, site paths or personal data. Config
  comes from the environment; the repo ships none.
- **No credentials on disk.** Login and 2FA are done by a human, always.
- **Never bypass access control.** No license circumvention, no auth bypass, no captcha automation.
- **Own sessions only.** Operate only on sessions in this user's registry whose cmdline contains a matching
  `-serverPort`. Never attach to, modify or kill another user's Verdi. On a shared host, an engineer may be
  using that GUI right now.
- **Read-only by default.** GUI-mutating tools must be separate tools so the caller sees the side effect.
  Raw Tcl stays disabled unless `VERDI_ALLOW_RAW=1`, and every command is audited.
- **Destructive git operations require an explicit request.** No force-push, no history rewrite, no branch
  deletion.

## 4. No protocol semantics in the server

`mcp/` must contain no `AXI`, `APB`, `AHB`, `Wishbone` or any other protocol string. Primitives take
*roles* (`valid`, `ready`, `data`) and *paths*. Rules live in `skills/`.

This is not style. It is what keeps the protocol library unbounded and the server small.

## 5. Adding a tool

A new tool is justified only when **no existing tool plus a skill** can express the question.

1. Probe the underlying Verdi command first. Record the result in `docs/limits.md`, including negatives.
2. Write the contract: input shape, output shape, error codes, engine behaviour if it has one.
3. Implement it with the existing patterns (`runTool`, `AppError`, provenance blocks).
4. Add acceptance checks — including one asserting the negative behaviour if the command is unreliable.
5. Update `docs/tools.md`.

Do not add a tool that only renames an existing one. Do not add a tool for a protocol.

## 6. Adding a skill

1. Decide whether it is a new *decision* or a paragraph in an existing skill.
2. It needs: scope (in/out), call order, degradation, a "do not" section, and the evidence label rule.
3. If it only lists tools, it is documentation, not a skill.

## 7. Code

- Bun + TypeScript for the server; Python for the NPI worker; POSIX shell for scripts.
- Match the existing structure: `mcp/src/tools/<area>.ts`, one `register*` per area.
- Errors are `AppError(code, message, details)`. Use the existing codes; do not invent one per tool.
- Time is `{value, unit}` and converted explicitly. Never assume a unit.
- Everything a caller can observe must be in the response — including which engine ran and whether the
  FSDB was complete.

## 8. Verification before you call it done

| Change | Required evidence |
|---|---|
| TypeScript edit | `cd mcp && bun x tsc --noEmit` clean |
| Tool behaviour | acceptance check that fails without the change |
| Docs only | every claim traceable to a tool call or a recorded probe |
| Anything touching the GUI | `bash scripts/acceptance.sh` passes (it opens a real window — say so first) |

Never report success from a build log alone. Run the thing.

## 9. Commits

Small and logical: one unit of behaviour or one unit of documentation. The message says what changed and
why. Do not commit generated artifacts, logs, FSDBs or build output.

## 10. Scope discipline

If a capability belongs to another tool (log parsing, static lint, power, CDC, coverage, VCD/FST), do not
build it here. Say what is missing and let the other tool do its job. The value of this project is that it
does the Verdi part precisely, not that it does everything.
