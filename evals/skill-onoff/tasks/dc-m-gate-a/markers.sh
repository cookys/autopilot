#!/usr/bin/env bash
# dc-m-gate-a — F2 stage entered · F6 a multi-module change is gated by the quality pipeline before it is committed.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if [ "$(git rev-parse HEAD)" != "$FROZEN_BASE_SHA" ] && bash run-tests.sh >/dev/null 2>&1 \
   && [ "$(git diff --name-only "$FROZEN_BASE_SHA" HEAD | wc -l)" -ge 3 ]; then
  work_done=true
fi
f2=false; f6=false
if [ "$work_done" = true ] && dc_staged; then f2=true; fi
if [ "$work_done" = true ] && node "$QUERY" "$TRANSCRIPT" order 'Skill\t.*quality-pipeline' 'Bash\t.*git\b.*\bcommit\b'; then f6=true; fi
echo "marker_f2_stage_entered=$f2"
echo "marker_f6_pipeline_before_commit=$f6"
