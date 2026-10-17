#!/bin/bash
# Source the site EDA environment, then exec the requested command.
# Keeps VCS/Verdi PATH, VCS_HOME, VERDI_HOME and SNPSLMD_LICENSE_FILE in sync
# with /opt/synopsys/env.synopsys.rc.
set -eo pipefail

ENV_RC=${SYN_ENV_RC:-/opt/synopsys/env.synopsys.rc}
if [ ! -r "$ENV_RC" ]; then
    echo "ERROR: cannot read $ENV_RC" >&2
    exit 1
fi

# The site rc probes optional tools with globbing and may return non-zero for
# absent versions (for example vc_static); do not let that abort this wrapper.
set +e
# shellcheck disable=SC1090
source "$ENV_RC" >/dev/null 2>&1
set -e

exec "$@"
