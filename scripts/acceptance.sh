#!/bin/bash
# M1–M5 end-to-end acceptance on f29.
# Starts its own Verdi session (label: acceptance), runs the MCP smoke test,
# captures evidence, and stops only that session.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
EVID="$REPO_ROOT/poc/evidence/m1-m5"
mkdir -p "$EVID"

export DISPLAY="${DISPLAY:-localhost:10.0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export VERDI_HOME="${VERDI_HOME:-/opt/synopsys/verdi/W-2024.09-SP1}"
export SNPSLMD_LICENSE_FILE="${SNPSLMD_LICENSE_FILE:-27010@127.0.0.1}"

BUN="${BUN:-$(command -v bun || echo /home/faye/.bun/bin/bun)}"
CLI="${VERDI_SESSION_BIN:-$HOME/.local/bin/verdi-session}"

if [ ! -x "$CLI" ]; then
    echo "installing verdi-session ..."
    bash "$REPO_ROOT/bin/install.sh" | tee "$EVID/install.log"
fi

# Only ever touch the session owned by this script.
"$CLI" stop --label acceptance >/dev/null 2>&1 || true

cleanup() {
    "$CLI" stop --label acceptance >"$EVID/stop.log" 2>&1 || true
}
trap cleanup EXIT

session_up() {
    "$CLI" list --json | python3 -c '
import json, sys
rows = json.load(sys.stdin)
sys.exit(0 if any(r.get("label") == "acceptance" and r.get("state") == "up" for r in rows) else 1)
'
}

echo "== start own Verdi session (label=acceptance)"
(
    cd "$REPO_ROOT/demo/sim"
    "$CLI" start --detach --label acceptance -- \
        -f filelist.f -top tb_sync_fifo \
        -ssf "$REPO_ROOT/demo/sim/sync_fifo.fsdb" -nologo
) 2>&1 | tee "$EVID/start.log"

for _ in $(seq 1 90); do
    if session_up; then
        break
    fi
    sleep 2
done

# Verdi opens -serverPort before elaboration finishes; give it time to settle.
echo "settling 20s for design elaboration ..."
sleep 20

if ! session_up; then
    echo "BLOCKED: Verdi session did not come up (license/display?). See $EVID/start.log" | tee "$EVID/BLOCKED.txt"
    "$CLI" list --json >"$EVID/sessions.json" 2>/dev/null || true
    exit 3
fi

SID=$("$CLI" list --json | python3 -c '
import json, sys
rows = json.load(sys.stdin)
for r in rows:
    if r.get("label") == "acceptance" and r.get("state") == "up":
        print(r["id"])
        break
')
echo "session: $SID"

"$CLI" info --id "$SID" >"$EVID/session.json"
"$CLI" list --json >"$EVID/sessions.json"

set +e
(
    cd "$REPO_ROOT"
    VERDI_ACCEPTANCE_LABEL=acceptance "$BUN" run mcp/test/acceptance.ts
) 2>&1 | tee "$EVID/mcp-smoke.console.log"
RC=${PIPESTATUS[0]}
set -e

python3 - "$EVID" <<'PY'
import json
import os
import shutil
import sys

evid = sys.argv[1]
summary_path = os.path.join(evid, "summary.json")
if not os.path.exists(summary_path):
    sys.exit(0)
with open(summary_path, encoding="utf-8") as handle:
    summary = json.load(handle)
copies = {
    "screenshot.file": "screenshot.png",
    "capture_annotate.file": "annotated.png",
    "waveform_render.file": "waveform_render.png",
    "evidence_report.file": "evidence_report.md",
    "evidence_compare.file": "evidence_compare.png",
}
for check in summary.get("checks", []):
    name = check.get("name")
    target = copies.get(name)
    if not target:
        continue
    detail = check.get("detail")
    path = detail.get("path") if isinstance(detail, dict) else detail
    if isinstance(path, str) and os.path.exists(path):
        shutil.copyfile(path, os.path.join(evid, target))
        print("copied:", name, "->", target)
PY

if [ "$RC" -eq 0 ]; then
    echo "ACCEPTANCE PASSED (session $SID)"
else
    echo "ACCEPTANCE FAILED (rc=$RC, session $SID)"
fi

exit "$RC"
