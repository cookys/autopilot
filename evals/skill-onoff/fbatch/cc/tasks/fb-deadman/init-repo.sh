#!/usr/bin/env bash
# fb-deadman: a draft RECEIPT is present, the exit file is absent. The exit lands on the 3rd poll of
# scripts/wait-dispatch-results.js (hidden plan in <git-dir>/fbatch).
set -euo pipefail
chmod +x scripts/* 2>/dev/null || true
G=$(git rev-parse --absolute-git-dir)
mkdir -p "$G/fbatch"
echo fb-deadman > "$G/fbatch-task"
echo 0 > "$G/fbatch/waits"
cat > "$G/fbatch/plan.json" << 'EOP'
{"run.impl":{"after":3,"files":{"runs/run.impl.exit":"0\n","runs/run.RECEIPT.md":"# RECEIPT run\n\nstatus: complete\nvalidator: passed\n"}}}
EOP
git checkout -q -b develop
git add -A && git commit -q -m "frozen base" --no-verify
