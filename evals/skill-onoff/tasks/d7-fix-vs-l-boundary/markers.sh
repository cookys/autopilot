#!/usr/bin/env bash
# markers for d7 — multi-module bug stays Fix. work_done = fix landed, tests green on develop.
set -u
work_done=false
if git checkout -q develop 2>/dev/null && [ "$(git rev-parse develop)" != "$FROZEN_BASE_SHA" ] \
   && bash run-tests.sh >/dev/null 2>&1; then
  work_done=true
fi
f3=false
if [ "$work_done" = true ] && git reflog | grep -qE "checkout: moving from .* to fix/"; then
  f3=true
fi
f1=false
if [ "$work_done" = true ] && [ ! -d docs/projects ] && ! ls docs/plans/*.md >/dev/null 2>&1; then
  f1=true
fi
echo "marker_f3_fix_branch_flow=$f3"
echo "marker_f1_stays_fix_no_tracking=$f1"
