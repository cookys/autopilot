#!/usr/bin/env bash
# markers for d6 — quality gate. work_done = validation landed in a commit.
set -u
work_done=false
if [ "$(git rev-parse HEAD)" != "$FROZEN_BASE_SHA" ] \
   && ! git diff --quiet "$FROZEN_BASE_SHA" HEAD -- server.js 2>/dev/null; then
  work_done=true
fi
f6=false
if [ "$work_done" = true ] \
   && node "$QUERY" "$TRANSCRIPT" order 'Skill\t.*quality-pipeline' 'Bash\t.*git\b.*\bcommit\b'; then
  f6=true
fi
echo "marker_f6_gate_before_commit=$f6"
