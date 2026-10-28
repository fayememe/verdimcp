#!/bin/bash
# Session lifecycle through MCP: start -> inspect -> raise -> stop.
# Starts and stops only the session labelled mcp-lifecycle.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUN="${BUN:-$(command -v bun || echo /home/faye/.bun/bin/bun)}"
cd "$REPO_ROOT"
exec "$BUN" run mcp/test/lifecycle.ts
