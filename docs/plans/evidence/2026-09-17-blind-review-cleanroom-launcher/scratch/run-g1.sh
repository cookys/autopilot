#!/usr/bin/env bash
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node scripts/dispatch-plan-review.js --repo-root "$PWD" --plan-file docs/plans/2026-09-17-blind-review-cleanroom-launcher.md --rubric-file docs/plans/2026-09-17-blind-review-cleanroom-launcher.rubric.md --ticket blind-review-cleanroom-launcher-2026-09-17 --session-id c1c-g1-$(date +%s) --generation 1 --manifest-file docs/plans/2026-09-17-blind-review-cleanroom-launcher.plan-review-manifest.json --timeout 20m > /tmp/claude-1000/-home-cookys-projects-autopilot/70b3e2b4-2ed5-403c-8fce-19d634ab4525/scratchpad/c1c/g1-artifact.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/70b3e2b4-2ed5-403c-8fce-19d634ab4525/scratchpad/c1c/g1.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/70b3e2b4-2ed5-403c-8fce-19d634ab4525/scratchpad/c1c/g1.err
