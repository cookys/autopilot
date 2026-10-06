#!/usr/bin/env bash
# markers (stage-graph eval) — see lib/stage-graph-markers.sh. Conjunction with work_done; no-op cell => all false.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/stage-graph-markers.sh"
sg_markers stage-graph-m-feature
