#!/usr/bin/env bash
# fb-mid-batch: lanes A, B, C landed (A carries one verified Major A-F1), lane D still running. Lane D lands on the
# 2nd poll of scripts/wait-dispatch-results.js (hidden plan in <git-dir>/fbatch) or at the turn-2 wake.
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
G=$(git rev-parse --absolute-git-dir)
mkdir -p "$G/fbatch"
echo fb-mid-batch > "$G/fbatch-task"
echo 0 > "$G/fbatch/waits"
cat > "$G/fbatch/plan.json" << 'EOP'
{"D.impl":{"after":2,"files":{"runs/D.impl.exit":"0\n","lanes/D/summary.md":"# Lane D summary\n\nLanded. Candidate sha 4444ddd.\nReview: no findings.\n"}}}
EOP
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
