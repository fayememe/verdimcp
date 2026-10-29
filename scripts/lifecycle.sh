#!/bin/bash
# Session lifecycle through MCP: start -> inspect -> raise -> stop.
# Starts and stops only the session labelled mcp-lifecycle.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUN="${BUN:-$(command -v bun || true)}"
if [ -z "$BUN" ]; then echo "ERROR: bun not found on PATH (export BUN=/path/to/bun)" >&2; exit 1; fi
cd "$REPO_ROOT"
exec "$BUN" run mcp/test/lifecycle.ts
