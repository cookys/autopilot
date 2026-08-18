#!/usr/bin/env bash
# markers for d3 — Fix path. work_done = the fix landed on develop and tests are green.
set -u
work_done=false
if git rev-parse --verify -q develop >/dev/null \
   && [ "$(git rev-parse develop)" != "$FROZEN_BASE_SHA" ] \
   && git checkout -q develop 2>/dev/null && bash run-tests.sh >/dev/null 2>&1; then
  work_done=true
fi
f3=false
if [ "$work_done" = true ] \
   && git reflog | grep -qE "checkout: moving from .* to fix/" \
   && [ "$(git branch --show-current)" = "develop" ]; then
  f3=true
fi
f4=false
if [ "$work_done" = true ] \
   && grep -hqE '^\| *[0-9]{2}-[0-9]{2} *\| *[0-9a-f]{7,40} *\| *fix' docs/projects/ongoing-maintenance/*.md 2>/dev/null; then
  f4=true
fi
f5=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order 'Bash\t.*run-tests' '(Edit|Write)\t.*lib/'; then
  f5=true
fi
f6=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order 'Skill\t.*quality-pipeline' 'Bash\t.*git\b.*\bcommit\b'; then
  f6=true
fi
echo "marker_f3_fix_branch_flow=$f3"
echo "marker_f4_maintenance_ledger=$f4"
echo "marker_f5_red_before_edit=$f5"
echo "marker_f6_gate_before_commit=$f6"
