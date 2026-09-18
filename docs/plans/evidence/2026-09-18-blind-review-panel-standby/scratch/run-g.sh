#!/usr/bin/env bash
# usage: run-g.sh <generation>
G="$1"; S=/tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c2b
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node scripts/dispatch-plan-review.js --repo-root "$PWD" --plan-file docs/plans/2026-09-18-blind-review-panel-standby.md --rubric-file docs/plans/2026-09-18-blind-review-panel-standby.rubric.md --ticket blind-review-panel-standby-2026-09-18 --session-id c2b-g$G-$(date +%s) --generation "$G" ${DISP:+--disposition-file $DISP} --manifest-file docs/plans/2026-09-18-blind-review-panel-standby.plan-review-manifest.json --timeout 20m > $S/g$G-artifact.json 2> $S/g$G.err
echo "rc=$?" >> $S/g$G.err
