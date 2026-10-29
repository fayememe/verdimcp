#!/bin/bash
# Concurrency semantics check for one Verdi session.
#
# 1. N workers race N rounds of `expr {unique}` through verdi-session exec; every
#    result must echo its own command (detects interleaved/mismatched replies).
# 2. A long-running exec (--hold) makes a second exec with a short lock timeout
#    fail with exit code 75 (busy) instead of corrupting the stream.
# 3. The same second exec with a long lock timeout succeeds after the waiter.
#
# Usage: scripts/concurrency.sh [session_id]
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
CLI="${VERDI_SESSION_BIN:-$HOME/.local/bin/verdi-session}"
OUT="$REPO_ROOT/evidence/concurrency"
mkdir -p "$OUT"

WORKERS="${WORKERS:-4}"
ROUNDS="${ROUNDS:-15}"
SID="${1:-}"

if [ -z "$SID" ]; then
    SID=$("$CLI" list --json | python3 -c '
import json, sys
rows = json.load(sys.stdin)
up = [r for r in rows if r.get("state") == "up"]
if len(up) != 1:
    sys.exit("need exactly one up session, or pass a session id")
print(up[0]["id"])
')
fi

echo "session: $SID  workers: $WORKERS  rounds: $ROUNDS"

result_of() {
    python3 -c '
import json, sys
value = None
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"):
        continue
    row = json.loads(line)
    if row.get("type") == "result":
        value = row.get("result")
print(value if value is not None else "")
'
}

worker() {
    local id="$1"
    local round want got
    for round in $(seq 1 "$ROUNDS"); do
        want=$((id * 1000 + round))
        got=$("$CLI" exec --id "$SID" --json --lock-timeout 60 -- "expr {$want}" | result_of)
        if [ "$got" != "$want" ]; then
            echo "MISMATCH worker=$id round=$round want=$want got=$got"
            return 1
        fi
    done
    return 0
}

echo "== parallel workers"
fail=0
pids=()
for id in $(seq 1 "$WORKERS"); do
    worker "$id" >"$OUT/worker-$id.log" 2>&1 &
    pids+=($!)
done
for pid in "${pids[@]}"; do
    if ! wait "$pid"; then fail=1; fi
done
if [ "$fail" -ne 0 ]; then
    echo "PARALLEL: FAIL (see $OUT/worker-*.log)"
    exit 1
fi
echo "PARALLEL: PASS ($((WORKERS * ROUNDS)) serialized calls, no mismatched results)"

echo "== busy / lock timeout"
"$CLI" exec --id "$SID" --hold 4 -- 'expr {111}' >"$OUT/hold.log" 2>&1 &
HOLD_PID=$!
sleep 0.8

set +e
"$CLI" exec --id "$SID" --json --lock-timeout 0.2 -- 'expr {222}' >"$OUT/busy.json" 2>"$OUT/busy.err"
BUSY_RC=$?
set -e
"$CLI" exec --id "$SID" --json --lock-timeout 30 -- 'expr {333}' >"$OUT/waited.json" 2>"$OUT/waited.err"
WAIT_RC=$?
wait "$HOLD_PID" || true

if [ "$BUSY_RC" -ne 75 ]; then
    echo "BUSY: FAIL expected rc=75, got $BUSY_RC"
    exit 1
fi
if ! grep -q '"code": "busy"\|"code":"busy"' "$OUT/busy.json"; then
    echo "BUSY: FAIL no busy error payload"
    cat "$OUT/busy.json"
    exit 1
fi
echo "BUSY: PASS (rc=75 + busy payload)"

if [ "$WAIT_RC" -ne 0 ]; then
    echo "WAIT: FAIL rc=$WAIT_RC"
    exit 1
fi
WAITED_VALUE=$(result_of <"$OUT/waited.json")
if [ "$WAITED_VALUE" != "333" ]; then
    echo "WAIT: FAIL got '$WAITED_VALUE'"
    exit 1
fi
echo "WAIT: PASS (serialized after the lock was released)"

cat >"$OUT/summary.json" <<JSON
{
  "session_id": "$SID",
  "workers": $WORKERS,
  "rounds": $ROUNDS,
  "calls": $((WORKERS * ROUNDS)),
  "mismatched_results": 0,
  "busy_rc": $BUSY_RC,
  "waited_rc": $WAIT_RC,
  "ok": true
}
JSON
echo "CONCURRENCY PASSED (evidence: $OUT)"
