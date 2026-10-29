#!/bin/bash
# Run a command with the caller's EDA environment.
#
# This repo does not ship site configuration. Point SYN_ENV_RC at your own
# generated rc script (or source your environment before invoking make) so that
# VCS, Verdi and the license variables are present in non-interactive shells.
set -eo pipefail

if [ -z "${SYN_ENV_RC:-}" ]; then
    if command -v vcs >/dev/null 2>&1 && command -v verdi >/dev/null 2>&1; then
        exec "$@"
    fi
    echo "ERROR: no EDA environment." >&2
    echo "  Set SYN_ENV_RC=/path/to/your/env.rc, or source your environment first." >&2
    exit 1
fi

if [ ! -r "$SYN_ENV_RC" ]; then
    echo "ERROR: cannot read SYN_ENV_RC=$SYN_ENV_RC" >&2
    exit 1
fi

# Site rc files often probe optional tools and return non-zero for absent
# versions; do not let that abort the wrapper.
set +e
# shellcheck disable=SC1090
source "$SYN_ENV_RC" >/dev/null 2>&1
set -e

exec "$@"
