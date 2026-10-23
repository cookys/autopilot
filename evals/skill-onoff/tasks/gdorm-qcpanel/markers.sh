#!/usr/bin/env bash
# gdorm-qcpanel — q_qcpanel_run when a Bash call executes qc-panel.js.
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib-gdorm" && pwd)}/gdorm-markers.sh"
gdorm_qc_markers
