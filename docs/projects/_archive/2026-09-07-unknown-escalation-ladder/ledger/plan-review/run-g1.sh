#!/usr/bin/env bash
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
node scripts/dispatch-plan-review.js \
  --repo-root "$PWD" \
  --plan-file docs/plans/2026-09-07-unknown-escalation-ladder.md \
  --rubric-file docs/plans/2026-09-07-unknown-escalation-ladder.rubric.md \
  --manifest-file docs/plans/2026-09-07-unknown-escalation-ladder.plan-review-manifest.json \
  --ticket unknown-escalation-ladder --session-id 6e53d2af-d5da-441e-bd3e-7a91f97a7aee --generation 1 \
  --timeout 20m > docs/projects/2026-09-07-unknown-escalation-ladder/ledger/plan-review/g1.stdout.json 2> docs/projects/2026-09-07-unknown-escalation-ladder/ledger/plan-review/g1.stderr.log
echo "rc=$?" > docs/projects/2026-09-07-unknown-escalation-ladder/ledger/plan-review/g1.rc
