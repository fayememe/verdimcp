# Documentation

Start at the repository [README](../README.md). This folder holds the parts that do not belong on a front
page.

| Document | Read it when |
|---|---|
| [getting-started.md](getting-started.md) | installing, registering the MCP server, troubleshooting |
| [architecture.md](architecture.md) | how the layers, engines, locks and error codes fit together |
| [tools.md](tools.md) | looking up one of the 39 tools: inputs, outputs, semantics |
| [skills.md](skills.md) | understanding or extending the 12 decision flows |
| [evidence.md](evidence.md) | building a bundle someone can falsify |
| [limits.md](limits.md) | a tool said `not_supported` and you want to know why |

## Conventions used here

- **Evidence labels.** `VERIFIED` (executed and observed), `INFERRED` (reasoned from evidence),
  `DOCUMENTED_ONLY` (a doc claims it), `NOT_TESTED`. Every claim in this folder carries one or is
  trivially obvious from the surrounding text.
- **Negative results are kept.** If Verdi will not hand something over, it is written down with the
  command that proved it. See [limits.md](limits.md).
- **No protocol semantics.** Nothing under `mcp/` names a bus protocol. If you are looking for AXI rules,
  they are in `skills/verdi-bus-debug/SKILL.md`, as text.

## Proving the docs

```bash
bash scripts/acceptance.sh     # 97 checks against a real Verdi GUI
```

The acceptance run is the only thing that turns a statement in these documents into `VERIFIED`.
