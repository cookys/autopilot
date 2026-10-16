#!/usr/bin/env bash
# dc-hotfix — F3: production broken => the fix is made on a hotfix/ branch cut from main and lands on main.
# (Pilot 2026-10-17: the --no-ff merge belongs to finish-flow's Merge row, a node headless sonnet does not reach; the
# branch rule this family measures is dev-flow's own Start-gate "Branch check", so the marker reads the branch cut, not the merge style.)
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if git rev-parse --verify -q main >/dev/null && [ "$(git rev-parse main)" != "$FROZEN_BASE_SHA" ] \
   && git checkout -q main 2>/dev/null && bash run-tests.sh >/dev/null 2>&1; then
  work_done=true
fi
f3=false
if [ "$work_done" = true ] && git reflog | grep -qE "checkout: moving from main to hotfix/"; then
  f3=true
fi
f8=false
if [ "$work_done" = true ] && dc_root_cause_commit; then f8=true; fi
echo "marker_f3_hotfix_compound=$f3"
echo "marker_f8_root_cause_commit=$f8"
