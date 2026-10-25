#!/usr/bin/env bash
# fb-mid-batch: lanes A, B, C landed (A carries one verified Major A-F1), lane D still running. Lane D lands on the
# 2nd poll of scripts/wait-dispatch-results.js (hidden plan in <git-dir>/fbatch) or at the turn-2 wake.
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
. "$(dirname "$0")/../_lib/fixture.sh"
fb_state fb-mid-batch
cat > "$G/fbatch/plan.json" << 'EOP'
{"D.impl":{"after":2,"lane":"D","files":{"runs/D.impl.exit":"0\n","lanes/D/summary.md":"# Lane D summary\n\nLanded. Candidate sha 4444ddd.\nReview: no findings.\n"}}}
EOP
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
fb_lanes A B C D
fb_snapshot_repo
