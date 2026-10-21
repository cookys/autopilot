#!/usr/bin/env bash
# dcard markers — lib/dcard-markers.sh. a_decision_file is NOT conjoined with work_done.
set -u
. "${ONOFF_LIB:-$(cd "$(dirname "$0")/../../lib" && pwd)}/dcard-markers.sh"
dcard_markers
