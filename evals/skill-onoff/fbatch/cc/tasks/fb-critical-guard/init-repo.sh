#!/usr/bin/env bash
# fb-critical-guard: lanes A, B, C landed; lane C carries a verified Critical. Nothing is pending.
# docs/merge-gate.md is injected by fbatch/cc-build.js from fbatch/gate.md (single source).
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
. "$(dirname "$0")/../_lib/fixture.sh"
fb_state fb-critical-guard
echo '{}' > "$G/fbatch/plan.json"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
fb_lanes A B C
fb_snapshot_repo
