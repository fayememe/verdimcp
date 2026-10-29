#!/bin/bash
# Build the headless Verdi command client (libnclt).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${VERDI_HOME:?set VERDI_HOME to your Verdi installation (or source your site EDA env)}"
LIB="$VERDI_HOME/share/libcmd"
gcc -O0 -g -I"$LIB" "$HERE/cmdclient.c" -L"$LIB/linux64" -lnclt -lnsys -o "$HERE/cmdclient"
echo "built: $HERE/cmdclient"
