#!/usr/bin/env bash
# 2-C station attempt 1 — run from a CLEAN tree; after this, the main checkout is READ-ONLY until rc= appears.
set -u
cd /home/cookys/projects/autopilot
S="${SCRATCH:?set SCRATCH to a dir outside the repo}"
mkdir -p "$S"
cp docs/plans/evidence/2026-09-18-blind-review-panel-station/prepared.json "$S/prepared.json"
cp docs/plans/evidence/2026-09-18-blind-review-panel-station/impl-brief.md "$S/impl-brief.md"
export AUTOPILOT_LEVEL=l5 AUTOPILOT_ROOT_RUN_ID=mission-07f86eff432f23eddbc4ee9b
node bin/autopilot.js engine implement-review --campaign-contract "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/07f86eff432f23eddbc4ee9bbab234ef0663889857f582cc47f9274c37ce0881/panel-review-station/attempt-1/campaign.json" --campaign-seal "/home/cookys/projects/autopilot/.git/autopilot/mission/artifacts/07f86eff432f23eddbc4ee9bbab234ef0663889857f582cc47f9274c37ce0881/panel-review-station/attempt-1/campaign.seal.json" --mission-prepared "$S/prepared.json" --prompt-file "$S/impl-brief.md" --branch "mission/07f86eff432f/panel-review-station-a1" --base "ae7ea5cea0a824f06633ea9e753ed77f57c4b811" --cwd /home/cookys/projects/autopilot --max-rounds 3 > "$S/impl-run1.json" 2> "$S/impl-run1.err"
echo "rc=$?" >> "$S/impl-run1.err"
