#!/usr/bin/env bash
# fb-pool: all four lanes landed on candidate abc123; five distinct verified Majors spread over lanes A, B, C.
# Every wait lands at once (empty plan).
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
. "$(dirname "$0")/../_lib/fixture.sh"
fb_state fb-pool
echo '{}' > "$G/fbatch/plan.json"
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
fb_lanes A B C D
fb_summaries
fb_snapshot_repo
