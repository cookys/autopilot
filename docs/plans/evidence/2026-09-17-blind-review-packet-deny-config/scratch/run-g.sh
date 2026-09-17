#!/usr/bin/env bash
# usage: run-g.sh <generation>
G="$1"; S=/tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node scripts/dispatch-plan-review.js --repo-root "$PWD" --plan-file docs/plans/2026-09-17-blind-review-packet-deny-config.md --rubric-file docs/plans/2026-09-17-blind-review-packet-deny-config.rubric.md --ticket blind-review-packet-deny-config-2026-09-17 --session-id c1e-g$G-$(date +%s) --generation "$G" ${DISP:+--disposition-file $DISP} --manifest-file docs/plans/2026-09-17-blind-review-packet-deny-config.plan-review-manifest.json --timeout 20m > $S/g$G-artifact.json 2> $S/g$G.err
echo "rc=$?" >> $S/g$G.err
