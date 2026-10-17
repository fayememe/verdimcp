#!/bin/bash
# Reproducible PoC: start an isolated Verdi GUI with -serverPort,
# drive it from an external process via libnclt, capture evidence, clean up.
#
# Requires: DISPLAY + XAUTHORITY of an X session, VCS/Verdi license.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
V=${VERDI_HOME:-/opt/synopsys/verdi/W-2024.09-SP1}
PORT=${PORT:-11065}
DEMO="$HERE/demo"
LOG="$HERE/verdi.log"

export VERDI_HOME=$V
export PATH="$V/bin:$PATH"
export SNPSLMD_LICENSE_FILE=${SNPSLMD_LICENSE_FILE:-27010@127.0.0.1}
export LD_LIBRARY_PATH="$V/share/libcmd/linux64:${LD_LIBRARY_PATH:-}"
export DISPLAY=${DISPLAY:-localhost:10.0}
export XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}

# Refuse to attach to anything we did not start.
if ss -ltn | grep -q ":$PORT "; then
    echo "ERROR: port $PORT already in use; pick another PORT" >&2
    exit 1
fi

mkdir -p "$DEMO"
cp -f "$V/demo/verilog/behav/"{behav.fsdb,cpu.v,system.v,pram.v,run.f,cpu.alias} "$DEMO"/ 2>/dev/null || true
[ -x "$HERE/cmdclient" ] || "$HERE/build.sh"

cd "$DEMO"
setsid nohup verdi -serverPort "$PORT" -ssf behav.fsdb >"$LOG" 2>&1 </dev/null &
LAUNCH_PID=$!
cleanup() {
    # Kill only the PoC server, verified by its command line.
    local pid
    pid=$(ps -eo pid,args | grep -- "-serverPort $PORT" | grep -v grep | awk '{print $1}' | head -1 || true)
    if [ -n "${pid:-}" ] && ps -p "$pid" >/dev/null; then
        kill "$pid" 2>/dev/null || true
        sleep 2
        ps -p "$pid" >/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "waiting for port $PORT ..."
for _ in $(seq 1 60); do
    ss -ltn | grep -q ":$PORT " && break
    sleep 2
done
ss -ltn | grep -q ":$PORT " || { echo "ERROR: Verdi did not open port $PORT; see $LOG" >&2; exit 1; }

cd "$HERE"
: > poc_output.txt
echo "== create nWave window"
OUT=$(./cmdclient "$PORT" "wvCreateWindow")
printf '%s\n' "$OUT" | tee -a poc_output.txt
WIN=$(printf '%s\n' "$OUT" | awk -F'\t' '$1=="OK"{print $3}' | tail -1)
[ -n "$WIN" ] || { echo "ERROR: could not parse nWave window id" >&2; exit 1; }
echo "window id: $WIN"

echo "== open FSDB + add signals + move cursor"
./cmdclient "$PORT" \
    "wvOpenFile -win $WIN $DEMO/behav.fsdb" \
    "wvAddSignal -win $WIN /system/CYCLE /system/R_W /system/VMA" \
    "wvSetCursor -win $WIN 100" | tee -a poc_output.txt

echo "== dump FSDB signal list (machine-readable check)"
./cmdclient "$PORT" "wvDumpSignalListToFile -win $WIN -signal -file $HERE/signals.txt" | tee -a poc_output.txt
wc -l "$HERE/signals.txt"

echo "== screenshot (independent GUI evidence)"
XID=$(./cmdclient "$PORT" "wvGetXWindowId -id $WIN" | awk -F'\t' '$1=="OK"{print $3}' | tail -1)
if [ -n "${XID:-}" ]; then
    xwininfo -id "0x$XID" | sed -n '1,12p'
    import -window "0x$XID" "$HERE/nwave.png" 2>/dev/null && identify "$HERE/nwave.png" || true
fi

echo "done. evidence: poc_output.txt signals.txt nwave.png verdi.log"
