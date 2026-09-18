#!/usr/bin/env bash
# 2-B attempt 1 — run from a CLEAN tree; after this, the main checkout is READ-ONLY until rc= appears.
# Usage: SCRATCH=<dir outside the repo> bash docs/plans/evidence/2026-09-18-blind-review-panel-standby/scratch/dispatch.sh
set -u
cd /home/cookys/projects/autopilot
S="${SCRATCH:?set SCRATCH to a dir outside the repo}"
mkdir -p "$S"
cp docs/plans/evidence/2026-09-18-blind-review-panel-standby/prepared.json "$S/prepared.json"
cp docs/plans/evidence/2026-09-18-blind-review-panel-standby/impl-brief.md "$S/impl-brief.md"
export AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=mission-1077fd40c74c41b797107832
node bin/autopilot.js engine implement-review --campaign-contract "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/1077fd40c74c41b797107832e076785fe781c32a652c2c0fce2e20833ffe2d48/blind-review-panel-standby-2026-09-18/attempt-1/campaign.json" --campaign-seal "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/1077fd40c74c41b797107832e076785fe781c32a652c2c0fce2e20833ffe2d48/blind-review-panel-standby-2026-09-18/attempt-1/campaign.seal.json" --mission-prepared "$S/prepared.json" --prompt-file "$S/impl-brief.md" --branch "mission/1077fd40c74c/blind-review-panel-standby-2026-09-18-a1" --base "83e3ac9c3ba7ac083d22d48d4e1b57dfbfa3eeb2" --cwd /home/cookys/projects/autopilot --max-rounds 3 > "$S/impl-run1.json" 2> "$S/impl-run1.err"
echo "rc=$?" >> "$S/impl-run1.err"
