#!/usr/bin/env bash
# usage: DISP=<disposition-file> run-g.sh <generation>
G="$1"; S=/tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node scripts/dispatch-plan-review.js --repo-root "$PWD" --plan-file docs/plans/2026-09-18-blind-review-panel-station.md --rubric-file docs/plans/2026-09-18-blind-review-panel-station.rubric.md --ticket blind-review-panel-station-2026-09-18 --session-id c2c-g$G-$(date +%s) --generation "$G" ${DISP:+--disposition-file $DISP} --manifest-file docs/plans/2026-09-18-blind-review-panel-station.plan-review-manifest.json --timeout 20m > $S/g$G-artifact.json 2> $S/g$G.err
echo "rc=$?" >> $S/g$G.err
