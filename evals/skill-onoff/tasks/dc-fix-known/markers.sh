#!/usr/bin/env bash
# dc-fix-known — F2 stage entered · F3 fix/ branch flow · F4 (informational) ledger row appended to the existing tree · F5 test run before the first lib/ mutation.
set -u
. "${ONOFF_LIB:-$(dirname "$QUERY")}/dc-markers.sh"
work_done=false
if git rev-parse --verify -q develop >/dev/null && [ "$(git rev-parse develop)" != "$FROZEN_BASE_SHA" ] \
   && git checkout -q develop 2>/dev/null && bash run-tests.sh >/dev/null 2>&1; then work_done=true; fi
f2=false; f8=false; f3=false; f4=false; f5=false
if [ "$work_done" = true ] && dc_staged; then f2=true; fi
if [ "$work_done" = true ] && git reflog | grep -qE "checkout: moving from .* to fix/" && [ "$(git branch --show-current)" = "develop" ]; then f3=true; fi
if [ "$work_done" = true ] && [ "$(dc_ledger_rows)" -ge 3 ]; then f4=true; fi
if [ "$work_done" = true ] && dc_red_first; then f5=true; fi
echo "marker_f2_stage_entered=$f2"
if [ "$work_done" = true ] && dc_root_cause_commit; then f8=true; fi
echo "marker_f3_fix_branch_flow=$f3"
echo "marker_f8_root_cause_commit=$f8"
echo "marker_f4_ledger_row=$f4"
echo "marker_f5_red_before_edit=$f5"
