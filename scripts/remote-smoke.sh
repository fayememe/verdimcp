#!/bin/bash
# Remote-mode smoke test: MCP server behind an SSH stdio hop.
#
# By default this starts a throwaway sshd on 127.0.0.1:2222 with ephemeral keys
# under /tmp/opencode/sshtest and drives the server through it, so the test needs
# no changes to ~/.ssh. Set REMOTE_HOST (and optionally REMOTE_PORT/REMOTE_KEY)
# to run the same client against a real host instead.
#
# What this proves: the server's stdout is protocol-clean (ssh prints no banners
# into the MCP stream) and every tool call survives the extra process hop.
# What it does not prove: display/licence environment on the remote host — set
# DISPLAY/XAUTHORITY there (e.g. ~/.ssh/environment) for GUI tools.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
EVID="$REPO_ROOT/evidence/remote"
mkdir -p "$EVID"
BUN="${BUN:-$(command -v bun || true)}"
if [ -z "$BUN" ]; then echo "ERROR: bun not found on PATH (export BUN=/path/to/bun)" >&2; exit 1; fi

SSH_DIR=/tmp/opencode/sshtest
SSHD_PID=""

cleanup() {
    if [ -n "$SSHD_PID" ]; then
        kill "$SSHD_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

if [ -n "${REMOTE_HOST:-}" ]; then
    HOST="$REMOTE_HOST"
    PORT="${REMOTE_PORT:-22}"
    KEY_ARG=()
    if [ -n "${REMOTE_KEY:-}" ]; then KEY_ARG=(-i "$REMOTE_KEY"); fi
    echo "using existing host: $HOST:$PORT"
else
    HOST=faye@127.0.0.1
    PORT=2222
    KEY_ARG=(-i "$SSH_DIR/clientkey")
    mkdir -p "$SSH_DIR"
    [ -f "$SSH_DIR/hostkey" ] || ssh-keygen -q -t ed25519 -N "" -f "$SSH_DIR/hostkey"
    [ -f "$SSH_DIR/clientkey" ] || ssh-keygen -q -t ed25519 -N "" -f "$SSH_DIR/clientkey"
    cp "$SSH_DIR/clientkey.pub" "$SSH_DIR/authorized_keys"
    chmod 600 "$SSH_DIR/authorized_keys"
    cat >"$SSH_DIR/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $SSH_DIR/hostkey
AuthorizedKeysFile $SSH_DIR/authorized_keys
PidFile $SSH_DIR/sshd.pid
StrictModes no
UsePAM no
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers $USER
LogLevel ERROR
AcceptEnv DISPLAY XAUTHORITY VERDI_HOME LD_LIBRARY_PATH
EOF
    /usr/sbin/sshd -f "$SSH_DIR/sshd_config" -E "$SSH_DIR/sshd.log"
    SSHD_PID=$(cat "$SSH_DIR/sshd.pid")
    for _ in $(seq 1 20); do
        if ss -ltn | grep -q ":$PORT "; then break; fi
        sleep 0.3
    done
    echo "started throwaway sshd on 127.0.0.1:$PORT (pid $SSHD_PID)"
fi

SSH_ARGS=(
    ssh -p "$PORT" "${KEY_ARG[@]}"
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o BatchMode=yes
    -o LogLevel=ERROR
    -T
    "$HOST"
    "$BUN" run "$REPO_ROOT/mcp/src/server.ts"
)

export MCP_REMOTE_JSON=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${SSH_ARGS[@]}")

cd "$REPO_ROOT"
set +e
"$BUN" run mcp/test/remote.ts 2>&1 | tee "$EVID/remote.console.log"
RC=${PIPESTATUS[0]}
set -e

if [ -x /usr/sbin/sshd ] && [ -f "$SSH_DIR/sshd.pid" ]; then
    cp "$SSH_DIR/sshd_config" "$EVID/sshd_config" 2>/dev/null || true
fi
exit "$RC"
