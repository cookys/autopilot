#!/usr/bin/env bash
# markers (P1W) — see lib/p1w-markers.sh. Conjunction with work_done; no-op cell => all false.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/p1w-markers.sh"
p1w_phase_markers "$(p1w_l_work_done runHooks)"
