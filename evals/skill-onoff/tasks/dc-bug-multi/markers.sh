#!/usr/bin/env bash
# dc-bug-multi — F4 ledger row · F1 bug flag recorded and sized XS/S/M (never L/XL), untracked · F3 fix/ branch flow.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if git checkout -q develop 2>/dev/null && [ "$(git rev-parse develop)" != "$FROZEN_BASE_SHA" ] && bash run-tests.sh >/dev/null 2>&1; then work_done=true; fi
f3=false; f1=false; f4=false
if [ "$work_done" = true ] && git reflog | grep -qE "checkout: moving from .* to fix/"; then f3=true; fi
if [ "$work_done" = true ] && dc_sized 'XS|S|M' --bug && dc_no_tracking; then f1=true; fi
if [ "$work_done" = true ] && [ "$(dc_ledger_rows)" -ge 3 ]; then f4=true; fi
echo "marker_f3_fix_branch_flow=$f3"
echo "marker_f4_ledger_row=$f4"
echo "marker_f1_bug_sized_untracked=$f1"
