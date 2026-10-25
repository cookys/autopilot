#!/usr/bin/env bash
# fb-pool: all four lanes landed on candidate abc123; five distinct verified Majors spread over lanes A, B, C.
# Every wait lands at once (empty plan).
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
G=$(git rev-parse --absolute-git-dir)
mkdir -p "$G/fbatch"
echo fb-pool > "$G/fbatch-task"
echo 0 > "$G/fbatch/waits"
echo '{}' > "$G/fbatch/plan.json"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
