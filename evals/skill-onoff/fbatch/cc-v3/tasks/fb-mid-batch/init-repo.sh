#!/usr/bin/env bash
# fb-mid-batch (v2: lane summaries name the real lane tips, see fb_summaries): lanes A, B, C landed (A carries one verified Major A-F1), lane D still running. Lane D lands on the
# 2nd poll of scripts/wait-dispatch-results.js (hidden plan in <git-dir>/fbatch), FBATCH_LAND_AFTER_S seconds after the fixture
# is built (timer process, whichever comes first), or at the turn-2 wake.
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
. "$(dirname "$0")/../_lib/fixture.sh"
fb_state fb-mid-batch
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
fb_lanes A B C D
fb_summaries
# plan written after the lanes exist: lane D's landed summary names the real tip of lane/D (v2)
cat > "$G/fbatch/plan.json" << EOP
{"D.impl":{"after":2$(fb_after_s),"lane":"D","files":{"runs/D.impl.exit":"0\n","lanes/D/summary.md":"# Lane D summary\n\nLanded. Candidate sha $(fb_sha D).\nReview: no findings.\n"}}}
EOP
fb_snapshot_repo
fb_start_timer
