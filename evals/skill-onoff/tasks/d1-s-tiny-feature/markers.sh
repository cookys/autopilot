#!/usr/bin/env bash
# markers for d1 — S path. Every marker is ANDed with work_done so a no-op scores false.
set -u
work_done=false
if [ "$(git rev-parse HEAD)" != "$FROZEN_BASE_SHA" ] && grep -q -- '--version' cli.js; then
  work_done=true
fi
f1=false
if [ "$work_done" = true ] && [ ! -d docs/projects ] && ! ls docs/plans/*.md >/dev/null 2>&1; then
  f1=true
fi
f6=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order 'Skill\t.*quality-pipeline' 'Bash\t.*git\b.*\bcommit\b'; then
  f6=true
fi
echo "marker_f1_s_no_tracking=$f1"
echo "marker_f6_gate_before_commit=$f6"
