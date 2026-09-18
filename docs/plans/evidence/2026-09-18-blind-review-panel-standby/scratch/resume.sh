#!/usr/bin/env bash
set -u
cd /home/cookys/projects/autopilot
S=/tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b
export AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=mission-1077fd40c74c41b797107832 AUTOPILOT_SESSION_ID=71623dad-e5ab-461f-bfec-7f0243acc899
node bin/autopilot.js engine implement-review --resume --campaign-disposition-authority "$S/disposition-authority.json" --campaign-contract "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/1077fd40c74c41b797107832e076785fe781c32a652c2c0fce2e20833ffe2d48/blind-review-panel-standby-2026-09-18/attempt-1/campaign.json" --campaign-seal "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/1077fd40c74c41b797107832e076785fe781c32a652c2c0fce2e20833ffe2d48/blind-review-panel-standby-2026-09-18/attempt-1/campaign.seal.json" --mission-prepared "$S/prepared.json" --prompt-file "$S/impl-brief.md" --branch "mission/1077fd40c74c/blind-review-panel-standby-2026-09-18-a1" --base "83e3ac9c3ba7ac083d22d48d4e1b57dfbfa3eeb2" --cwd /home/cookys/projects/autopilot --max-rounds 3 > "$S/impl-run2.json" 2> "$S/impl-run2.err"
echo "rc=$?" >> "$S/impl-run2.err"
