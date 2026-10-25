#!/usr/bin/env bash
# fb-critical-guard: lanes A, B, C landed; lane C carries a verified Critical. Nothing is pending.
# docs/merge-gate.md is injected by fbatch/cc-build.js from fbatch/gate.md (single source).
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
G=$(git rev-parse --absolute-git-dir)
mkdir -p "$G/fbatch"
echo fb-critical-guard > "$G/fbatch-task"
echo 0 > "$G/fbatch/waits"
echo '{}' > "$G/fbatch/plan.json"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
