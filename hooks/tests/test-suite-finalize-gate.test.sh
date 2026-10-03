#!/usr/bin/env bash
# Gate: a hooks/tests/*.test.sh that sources lib.sh MUST end with finalize_test. Without it
# fail() only appends to an array, the suite exits 0 and prints no PASS/FAIL summary, so it is
# green by construction (campaign-resume-reviewing-phase.test.sh shipped that way).
#
# The allowlist below is the set of pre-existing violators at the time this gate landed. They
# are listed, not fixed, here (each needs its own review that its assertions can go red); the
# list may only shrink. A new suite must not be added to it.
# RED at fdf52225 (negatives ownmid/stubexit, old recognizer):
#   FAIL recognizer rejects the ownmid look-alike: expected '0', got '1'
#   FAIL recognizer rejects the stubexit look-alike: expected '0', got '1'
# RED at 4c3b7a71: with the old 18-entry allowlist (session-mode, calendar-teeth-negative restored)
#   FAIL allowlist holds no suite that now finalizes (shrink the list): expected 'calendar-teeth-negative.test.sh session-mode.test.sh', got ''
#   FAIL [test-suite-finalize-gate] 9 passed, 1 failed
TEST_NAME="test-suite-finalize-gate"
. "$(dirname "$0")/lib.sh"

# Measured 2026-10-03 at 4c3b7a71 (every suite run, tails read). The 10 suites that finalize
# through their own harness (a last-command `[ "$FAIL" -eq 0 ]`, `... || exit 1`, or an exiting
# fail()) left this list: `finalizes()` below recognizes those shapes.
ALLOWLIST="
autopilot-engine-boundary-resume.test.sh
autopilot-engine-repair-branch.test.sh
codex-postcompact-production-live-driver.test.sh
implementation-campaign-state-boundary.test.sh
load-endpoints-env.test.sh
orchestration-eval.test.sh
probe-mutation.test.sh
review-mvp-portfolio.test.sh
"
# ALWAYS-GREEN — needs finalize_test (assertions accumulate, no nonzero exit path):
#   autopilot-engine-boundary-resume   (prints green_reason=git worktree command exited with status 1
#                                       and asserts nothing on it)
#   autopilot-engine-repair-branch     implementation-campaign-state-boundary
#   load-endpoints-env (prints "all assertions passed" unconditionally)   review-mvp-portfolio
# own harness, exits nonzero at its last line (a node driver whose catch sets process.exitCode = 1,
# the suite's final command) — the gate does not try to prove that shape:
#   codex-postcompact-production-live-driver
# mission-terminal-rollover finalizes, but exits 0 early (vacuous) when there is no Mission
# registry — a green here can mean nothing ran.
# own harness, set -e + explicit `exit 1` on each check, no summary line the gate can match:
#   orchestration-eval (exit 1 at its check sites, e.g. lines 627-734)   probe-mutation (exit 1 at 129-202)

# A suite finalizes if it calls finalize_test, or ends in its own nonzero-on-failure path.
# Comment lines never count.
finalizes() {
  local code="$TEST_TMP/finalizes.code"
  grep -avE '^[[:space:]]*#' "$1" > "$code"
  grep -aqE '^[[:space:]]*finalize_test([[:space:]]|$)' "$code" && return 0
  # own summary: `[ "$FAIL" -eq 0 ] || exit 1` anywhere ...
  grep -aqE '^[[:space:]]*\[ "\$\{?FAIL\}?" -eq 0 \][[:space:]]*\|\|[[:space:]]*exit 1[[:space:]]*$' "$code" && return 0
  # ... or a bare `[ "$FAIL" -eq 0 ]` as the LAST command (only then does its status propagate)
  grep -avE '^[[:space:]]*$' "$code" | tail -n 1 \
    | grep -qE '^[[:space:]]*\[ "\$\{?FAIL\}?" -eq 0 \][[:space:]]*$' && return 0
  # a fail() that itself exits nonzero
  grep -aqE '^fail\(\)[[:space:]]*\{.*exit 1' "$code" && return 0
  return 1
}

violators=""
stale=""
for f in "$REPO_ROOT"/hooks/tests/*.test.sh; do
  name="$(basename "$f")"
  [ "$name" = "test-suite-finalize-gate.test.sh" ] && continue
  # sources lib.sh (non-comment line) ...
  grep -avE '^[[:space:]]*#' "$f" | grep -qE '(^|[;&[:space:]])(\.|source)[[:space:]]+.*lib\.sh' || continue
  # ... and calls finalize_test as a command (non-comment line)
  if finalizes "$f"; then
    printf '%s\n' "$ALLOWLIST" | grep -qx "$name" && stale="$stale $name"
    continue
  fi
  printf '%s\n' "$ALLOWLIST" | grep -qx "$name" || violators="$violators $name"
done

assert_eq "" "${violators# }" "every lib.sh suite calls finalize_test (or is on the frozen allowlist)"
assert_eq "" "${stale# }" "allowlist holds no suite that now finalizes (shrink the list)"

# --- the recognizer itself: shapes that finalize, and look-alikes that do not -------------
mk() { printf '%s\n' "$2" > "$TEST_TMP/$1.sh"; }
mk fin 'finalize_test'
mk own '[ "$FAIL" -eq 0 ]'
mk ownx '[ "$FAIL" -eq 0 ] || exit 1'
mk failexit 'fail() { echo "FAIL: $*" >&2; exit 1; }'
mk ownmid '[ "$FAIL" -eq 0 ]
echo done'
mk stubexit 'cat > stub.js <<EOF
process.exitCode = 1;
EOF
assert_eq 1 1 "accumulates"'
mk bare 'assert_eq 1 1 "only accumulates"
echo "all assertions passed"'
mk commented '# finalize_test
#   [ "$FAIL" -eq 0 ]'
mk printonly 'printf "%d passed, %d failed\n" "$PASS" "$FAIL"'
for n in fin own ownx failexit; do
  finalizes "$TEST_TMP/$n.sh"; assert_eq "0" "$?" "recognizer accepts the $n shape"
done
for n in bare commented printonly ownmid stubexit; do
  finalizes "$TEST_TMP/$n.sh"; assert_eq "1" "$?" "recognizer rejects the $n look-alike"
done
finalize_test
