#!/bin/bash
# Live-FSDB behaviour: query an FSDB while the simulation is still writing it.
#
# Starts demo/writing/simv, samples the growing FSDB with the one-shot NPI worker,
# and records what the reader sees (max_time, is_completed, change counts, errors).
# Evidence: poc/evidence/writing-fsdb/
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
EVID="$REPO_ROOT/poc/evidence/writing-fsdb"
mkdir -p "$EVID"

CYCLES="${CYCLES:-15000000}"
INTERVAL="${INTERVAL:-5}"
SAMPLES="${SAMPLES:-8}"

export VERDI_HOME="${VERDI_HOME:-/opt/synopsys/verdi/W-2024.09-SP1}"
export SNPSLMD_LICENSE_FILE="${SNPSLMD_LICENSE_FILE:-27010@127.0.0.1}"
export PYTHONPATH="$VERDI_HOME/share/NPI/python:${PYTHONPATH:-}"
export LD_LIBRARY_PATH="$VERDI_HOME/share/NPI/lib/linux64:$VERDI_HOME/platform/linux64/lib/Qt5/lib:${LD_LIBRARY_PATH:-}"

cd "$REPO_ROOT/demo/writing"
make simv >"$EVID/compile.log" 2>&1
rm -f growing.fsdb

echo "starting simv +cycles=$CYCLES"
./simv +cycles="$CYCLES" >"$EVID/sim.log" 2>&1 &
SIM_PID=$!
trap 'kill "$SIM_PID" 2>/dev/null || true' EXIT

python3 "$REPO_ROOT/scripts/live_fsdb_probe.py" \
    --fsdb "$REPO_ROOT/demo/writing/growing.fsdb" \
    --pid "$SIM_PID" \
    --interval "$INTERVAL" \
    --samples "$SAMPLES" >"$EVID/samples.jsonl"

wait "$SIM_PID"
trap - EXIT

# One final sample after the simulation has closed the file.
python3 "$REPO_ROOT/scripts/live_fsdb_probe.py" \
    --fsdb "$REPO_ROOT/demo/writing/growing.fsdb" \
    --pid 0 \
    --interval 0 \
    --samples 1 >"$EVID/samples-after.jsonl"

python3 - "$EVID" <<'PY'
import json
import os
import sys

evid = sys.argv[1]
rows = []
for name in ("samples.jsonl", "samples-after.jsonl"):
    path = os.path.join(evid, name)
    if not os.path.exists(path):
        continue
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))

opens = [row for row in rows if row.get("info_ok")]
during = [row for row in rows if row.get("sim_alive")]
summary = {
    "samples": len(rows),
    "during_simulation": len(during),
    "opened_while_writing": sum(1 for row in during if row.get("info_ok")),
    "query_failures": sum(1 for row in rows if not row.get("info_ok")),
    "max_time_ticks": [(row.get("info") or {}).get("max_time_ticks") for row in rows],
    "is_completed": [(row.get("info") or {}).get("is_completed") for row in rows],
    "fsdb_bytes": [row.get("fsdb_bytes") for row in rows],
    "ok": len(opens) > 0,
}
with open(os.path.join(evid, "summary.json"), "w", encoding="utf-8") as handle:
    json.dump(summary, handle, indent=2)
    handle.write("\n")

with open(os.path.join(evid, "summary.md"), "w", encoding="utf-8") as handle:
    handle.write("# Live FSDB sampling\n\n")
    handle.write("| sample | sim alive | bytes | info ok | max_time | completed | changes |\n")
    handle.write("|---|---|---|---|---|---|---|\n")
    for row in rows:
        info = row.get("info") or {}
        stats = (row.get("stats") or {}).get("stats") or [{}]
        handle.write(
            "| {s} | {alive} | {size} | {ok} | {mt} | {done} | {chg} |\n".format(
                s=row.get("sample"),
                alive=row.get("sim_alive"),
                size=row.get("fsdb_bytes"),
                ok=row.get("info_ok"),
                mt=info.get("max_time_ticks"),
                done=info.get("is_completed"),
                chg=stats[0].get("count"),
            )
        )
print(json.dumps(summary, indent=2))
PY

echo "evidence: $EVID"
