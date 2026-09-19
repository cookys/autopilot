#!/usr/bin/env bash
cd "$1" || exit 1; out="$2"; : > "$out"
suites=(
 hooks/tests/autopilot-engine-repair-branch.test.sh
 hooks/tests/campaign-dispatch-projection.test.sh
 hooks/tests/migrate-backlog-entries.test.sh
 hooks/tests/check-backlog-entries.test.sh
 hooks/tests/campaign-intake-rejection-release.test.sh
 hooks/tests/mission-grant-open-claim.test.sh
 hooks/tests/campaign-claim-resolve.test.sh
 hooks/tests/mission-routing-campaign-bridge.test.sh
 hooks/tests/mission-convergence.test.sh
 hooks/tests/mission-enforce-failclosed.test.sh
 hooks/tests/implementation-campaign-routing.test.sh
 hooks/tests/implementation-campaign-state.test.sh
 hooks/tests/autopilot-engine.test.sh
 hooks/tests/autopilot-engine-park-reserve.test.sh
 hooks/tests/autopilot-engine-boundary-resume.test.sh
 hooks/tests/autopilot-engine-wall-expiry.test.sh
 hooks/tests/mission-runtime-v2.test.sh
 hooks/tests/mission-icc-runtime.test.sh
 hooks/tests/mission-convergence-integration.test.sh
 hooks/tests/dispatch-detached-campaign-authority.test.sh
)
for s in "${suites[@]}"; do t0=$(date +%s); env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" > "$out.$(basename $s).log" 2>&1 < /dev/null; echo "rc=$? $(( $(date +%s)-t0 ))s $s" >> "$out"; done
env -u CLAUDE_CODE_SESSION_ID bash scripts/sync-codex-plugin-skills.sh --check > "$out.sync.log" 2>&1 < /dev/null; echo "rc=$? sync-check" >> "$out"
node scripts/check-js-syntax.js > "$out.syntax.log" 2>&1; echo "rc=$? check-js-syntax" >> "$out"
node scripts/secret-scan-diff.js --range ed3d8b4b..HEAD > "$out.secret.log" 2>&1; echo "rc=$? secret-scan-range" >> "$out"
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md > "$out.backlog.log" 2>&1; echo "rc=$? backlog-gate" >> "$out"
node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json > "$out.migrate.log" 2>&1; echo "rc=$? migrate-dry" >> "$out"
echo DONE >> "$out"
