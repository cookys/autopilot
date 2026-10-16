#!/usr/bin/env bash
# Re-run: bash run.sh [generation]   (generation 1 only for this task)
set -u
R=/home/cookys/projects/autopilot/.claude/worktrees/lane-bl0194plan
D=$R/docs/plans/evidence/2026-10-16-bl0194-qualification-registry/plan-review
cd "$R" || exit 2
source "$R/scripts/load-endpoints-env.sh" && autopilot_load_endpoints_env
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node scripts/dispatch-plan-review.js \
  --repo-root "$R" \
  --plan-file docs/plans/2026-10-16-bl0194-qualification-registry-move.md \
  --rubric-file "$D/rubric.md" --manifest-file "$D/manifest.json" \
  --ticket bl0194-g1 --session-id bl0194-g1 --generation "${1:-1}" --timeout 20m \
  --context-file scripts/lib/qualification-feed.js \
  --context-file scripts/adopt-qualification-defaults.js \
  --context-file scripts/build-qualification-defaults.js \
  > "$D/g1.out.json" 2> "$D/g1.stderr.log"
echo "rc=$? DONE" >> "$D/g1.stderr.log"
