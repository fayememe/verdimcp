#!/bin/bash
# Build the headless Verdi command client (libnclt).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VERDI_HOME=${VERDI_HOME:-/opt/synopsys/verdi/W-2024.09-SP1}
LIB="$VERDI_HOME/share/libcmd"
gcc -O0 -g -I"$LIB" "$HERE/cmdclient.c" -L"$LIB/linux64" -lnclt -lnsys -o "$HERE/cmdclient"
echo "built: $HERE/cmdclient"
