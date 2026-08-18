#!/usr/bin/env bash
# markers for d4 — H path. work_done = main is stable again.
set -u
work_done=false
if git rev-parse --verify -q main >/dev/null \
   && git checkout -q main 2>/dev/null && bash run-tests.sh >/dev/null 2>&1; then
  work_done=true
fi
f3=false
if [ "$work_done" = true ] \
   && git reflog | grep -qE "checkout: moving from .* to hotfix/" \
   && git log main --merges --format=%s | grep -qE "hotfix/"; then
  f3=true
fi
echo "marker_f3_hotfix_compound=$f3"
