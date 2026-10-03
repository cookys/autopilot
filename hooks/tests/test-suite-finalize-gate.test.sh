#!/usr/bin/env bash
# Gate: a hooks/tests/*.test.sh that sources lib.sh MUST end with finalize_test. Without it
# fail() only appends to an array, the suite exits 0 and prints no PASS/FAIL summary, so it is
# green by construction (campaign-resume-reviewing-phase.test.sh shipped that way).
#
# The allowlist below is the set of pre-existing violators at the time this gate landed. They
# are listed, not fixed, here (each needs its own review that its assertions can go red); the
# list may only shrink. A new suite must not be added to it.
TEST_NAME="test-suite-finalize-gate"
. "$(dirname "$0")/lib.sh"

ALLOWLIST="
autopilot-engine-boundary-resume.test.sh
autopilot-engine-repair-branch.test.sh
calendar-teeth-negative.test.sh
check-hands-commit.test.sh
codex-postcompact-production-live-driver.test.sh
implementation-campaign-state-boundary.test.sh
load-endpoints-env.test.sh
mission-terminal-rollover.test.sh
orchestration-eval.test.sh
pin-evidence-anchors.test.sh
probe-mutation.test.sh
qualify-scorecard-vocabulary.test.sh
resolve-knowledge-routing.test.sh
resolve-project-paths.test.sh
review-mvp-portfolio.test.sh
session-mode.test.sh
skill-onoff-markers.test.sh
strike-writer-wiring.test.sh
"

violators=""
stale=""
for f in "$REPO_ROOT"/hooks/tests/*.test.sh; do
  name="$(basename "$f")"
  [ "$name" = "test-suite-finalize-gate.test.sh" ] && continue
  # sources lib.sh (non-comment line) ...
  grep -avE '^[[:space:]]*#' "$f" | grep -qE '(^|[;&[:space:]])(\.|source)[[:space:]]+.*lib\.sh' || continue
  # ... and calls finalize_test as a command (non-comment line)
  if grep -avE '^[[:space:]]*#' "$f" | grep -qE '^[[:space:]]*finalize_test([[:space:]]|$)'; then
    printf '%s\n' "$ALLOWLIST" | grep -qx "$name" && stale="$stale $name"
    continue
  fi
  printf '%s\n' "$ALLOWLIST" | grep -qx "$name" || violators="$violators $name"
done

assert_eq "" "${violators# }" "every lib.sh suite calls finalize_test (or is on the frozen allowlist)"
assert_eq "" "${stale# }" "allowlist holds no suite that now calls finalize_test (shrink the list)"
finalize_test
