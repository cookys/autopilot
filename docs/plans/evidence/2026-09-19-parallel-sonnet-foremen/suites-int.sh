#!/usr/bin/env bash
# integrated verification: union of A/B/C/G verify lists + key enumerators, one suite at a time
cd "$1" || exit 1
out="$2"; : > "$out"
suites=(
 hooks/tests/autopilot-engine-wall-expiry.test.sh
 hooks/tests/implementation-campaign-state-wall.test.sh
 hooks/tests/autopilot-engine-boundary-resume.test.sh
 hooks/tests/implementation-campaign-state-boundary.test.sh
 hooks/tests/campaign-boundary-receipt-e2e.test.sh
 hooks/tests/implementation-campaign-state-park.test.sh
 hooks/tests/autopilot-engine-park-reserve.test.sh
 hooks/tests/implementation-campaign-state.test.sh
 hooks/tests/autopilot-engine.test.sh
 hooks/tests/implementation-campaign-receipt.test.sh
 hooks/tests/implementation-campaign-routing.test.sh
 hooks/tests/campaign-terminalize.test.sh
 hooks/tests/campaign-claim-resolve.test.sh
 hooks/tests/status-task.test.sh
 hooks/tests/dispatch-plan-review.test.sh
 hooks/tests/secret-scan-diff.test.sh
 hooks/tests/dispatch-author.test.sh
 hooks/tests/plan-review-transport-fallback.test.sh
 hooks/tests/plan-review-transport-fixes.test.sh
 hooks/tests/plan-review-panel-status.test.sh
 hooks/tests/mission-runtime-v2.test.sh
 hooks/tests/dispatch-detached-campaign-authority.test.sh
 hooks/tests/controller-execution-independent.test.sh
 hooks/tests/campaign-dispatch-projection.test.sh
 hooks/tests/implementation-campaign.test.sh
)
for s in "${suites[@]}"; do
  if [ ! -f "$s" ]; then echo "MISSING $s" >> "$out"; continue; fi
  t0=$(date +%s); env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" > "$out.$(basename $s).log" 2>&1; rc=$?
  echo "rc=$rc $(( $(date +%s)-t0 ))s $s" >> "$out"
done
env -u CLAUDE_CODE_SESSION_ID bash scripts/sync-codex-plugin-skills.sh --check > "$out.sync.log" 2>&1; echo "rc=$? sync-check" >> "$out"
node scripts/check-js-syntax.js > "$out.syntax.log" 2>&1; echo "rc=$? check-js-syntax" >> "$out"
node scripts/secret-scan-diff.js --range da5d9610..HEAD > "$out.secret.log" 2>&1; echo "rc=$? secret-scan-range" >> "$out"
echo DONE >> "$out"
