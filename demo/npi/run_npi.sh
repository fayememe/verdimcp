#!/bin/bash
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FSDB=${1:-"$ROOT/demo/sim/sync_fifo.fsdb"}

if [ ! -r "$FSDB" ]; then
    echo "ERROR: FSDB not found: $FSDB" >&2
    echo "Run: make -C $ROOT/demo/sim sim" >&2
    exit 1
fi

if [ -z "${VERDI_HOME:-}" ]; then
    echo "ERROR: VERDI_HOME is not set (source your site EDA environment first)" >&2
    exit 1
fi

cd "$HERE"
exec bash -c '
    export PYTHONPATH="$VERDI_HOME/share/NPI/python:${PYTHONPATH:-}"
    export LD_LIBRARY_PATH="$VERDI_HOME/share/NPI/lib/linux64:$VERDI_HOME/platform/linux64/lib/Qt5/lib:${LD_LIBRARY_PATH:-}"
    exec python3 "$1" "$2"
' _ "$HERE/npi_smoke.py" "$FSDB"
