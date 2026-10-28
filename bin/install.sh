#!/bin/bash
# Install verdi-session + cmdclient for the current user.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DEST="${VERDI_SESSION_LIBEXEC:-$HOME/.local/libexec/verdi-session}"
BIN="${VERDI_SESSION_BINDIR:-$HOME/.local/bin}"

"$HERE/build.sh"

install -d -m 700 "$DEST"
install -m 755 "$HERE/verdi-session" "$DEST/verdi-session"
install -m 755 "$HERE/cmdclient" "$DEST/cmdclient"

install -d -m 755 "$BIN"
ln -sfn "$DEST/verdi-session" "$BIN/verdi-session"

echo "installed: $DEST/verdi-session"
echo "installed: $DEST/cmdclient"
echo "symlink:   $BIN/verdi-session"
"$BIN/verdi-session" list --json
