#!/usr/bin/env bash
# 2-C shared-packet attempt 1 — run from a CLEAN tree; the main checkout is READ-ONLY until rc= appears.
set -u
cd /home/cookys/projects/autopilot
S=/tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p
export AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=mission-b33ff20c07e9e811978fa09c
node bin/autopilot.js engine implement-review --campaign-contract "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/b33ff20c07e9e811978fa09ce1b660f23dee29ef7b1d6a672c5ab41773bb3bb7/shared-packet/attempt-1/campaign.json" --campaign-seal "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/b33ff20c07e9e811978fa09ce1b660f23dee29ef7b1d6a672c5ab41773bb3bb7/shared-packet/attempt-1/campaign.seal.json" --mission-prepared "$S/prepared.json" --prompt-file "$S/impl-brief.md" --branch "mission/b33ff20c07e9/shared-packet-a1" --base "fd4ea3a6c061f336034ee8db109ceed5d364d8cb" --cwd /home/cookys/projects/autopilot --max-rounds 3 > "$S/impl-run1.json" 2> "$S/impl-run1.err"
echo "rc=$?" >> "$S/impl-run1.err"
