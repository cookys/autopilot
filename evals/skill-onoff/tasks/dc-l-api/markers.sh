#!/usr/bin/env bash
# dc-l-api — F1 a public-API change across parser/CLI/docs is sized L before the first edit/commit · i7 (informational) the L gates exist.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if grep -rq 'registerPlugin' lib/ 2>/dev/null; then work_done=true; fi
f1=false; i7=false
if [ "$work_done" = true ] && dc_sized 'L|XL'; then f1=true; fi
if [ "$work_done" = true ] \
   && [ -f .claude/session-start-sha ] && [ "$(cat .claude/session-start-sha 2>/dev/null)" = "$FROZEN_BASE_SHA" ] \
   && ls docs/plans/*.md >/dev/null 2>&1 \
   && grep -rlq 'Success criteria' docs/projects/*/README.md 2>/dev/null && grep -rlq 'Project Goal' docs/projects/*/README.md 2>/dev/null; then
  i7=true
fi
echo "marker_f1_l_sized=$f1"
echo "marker_i7_l_gates=$i7"
