#!/usr/bin/env bash
# dc-s-flag — F1 an additive one-module flag is sized XS/S, recorded before the first edit/commit, no tracking docs · F2 a stage was entered.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if [ "$(git rev-parse HEAD)" != "$FROZEN_BASE_SHA" ] && grep -q -- '--version' cli.js; then work_done=true; fi
f1=false; f2=false
if [ "$work_done" = true ] && dc_sized 'XS|S' && dc_no_tracking; then f1=true; fi
if [ "$work_done" = true ] && dc_staged; then f2=true; fi
echo "marker_f1_s_sized_untracked=$f1"
echo "marker_f2_stage_entered=$f2"
