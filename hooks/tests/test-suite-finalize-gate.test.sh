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
# RED at 8a338ccb (new fixtures against the old recognizer):
#   FAIL recognizer accepts the trapbare shape: expected '1', got '0'
#   FAIL recognizer accepts the trapsq shape / trapdq shape (same)
#   FAIL recognizer rejects the ownxheredoc look-alike: expected '0', got '1'
#   FAIL recognizer rejects the ownxfunc look-alike / ownxecho look-alike (same)
#   FAIL [test-suite-finalize-gate] 14 passed, 6 failed
TEST_NAME="test-suite-finalize-gate"
. "$(dirname "$0")/lib.sh"

# Measured 2026-10-03 at 4c3b7a71 (every suite run, tails read). The 10 suites that finalize
# through their own harness (a last-command `[ "$FAIL" -eq 0 ]`, `... || exit 1`, or an exiting
# fail()) left this list: `finalizes()` below recognizes those shapes.
ALLOWLIST="
codex-postcompact-production-live-driver.test.sh
orchestration-eval.test.sh
probe-mutation.test.sh
"
# ALWAYS-GREEN — needs finalize_test (assertions accumulate, no nonzero exit path):
#   autopilot-engine-boundary-resume   (prints green_reason=git worktree command exited with status 1
#                                       and asserts nothing on it)
# own harness, exits nonzero at its last line (a node driver whose catch sets process.exitCode = 1,
# the suite's final command) — the gate does not try to prove that shape:
#   codex-postcompact-production-live-driver
# mission-terminal-rollover finalizes, but exits 0 early (vacuous) when there is no Mission
# registry; it now prints `SKIP [mission-terminal-rollover] VACUOUS RUN` instead of a green summary.
# own harness, set -e + explicit `exit 1` on each check, no summary line the gate can match:
#   orchestration-eval (exit 1 at its check sites, e.g. lines 627-734)   probe-mutation (exit 1 at 129-202)

# A suite finalizes if it calls finalize_test, or ends in its own nonzero-on-failure path.
# Comment lines never count.
finalizes() {
  local code="$TEST_TMP/finalizes.code"
  grep -avE '^[[:space:]]*#' "$1" > "$code"
  grep -aqE '^[[:space:]]*finalize_test([[:space:]]|$)' "$code" && return 0
  # `trap finalize_test EXIT` (quoted or not) finalizes whenever the suite exits
  grep -aqE "^[[:space:]]*trap[[:space:]]+(finalize_test|'finalize_test'|\"finalize_test\")[[:space:]]+EXIT([[:space:]]|\$)" "$code" && return 0
  # own summary as the LAST command (only then does its status propagate): the bare
  # `[ "$FAIL" -eq 0 ]` or `[ "$FAIL" -eq 0 ] || exit 1`. The same text inside a heredoc stub
  # or an uncalled function is not at the end of the suite, so it never counts.
  # A trailing bare `exit 0` after the `|| exit 1` form is harmless (strike-writer-wiring), so
  # it is dropped before looking at the last command.
  grep -avE '^[[:space:]]*$' "$code" | { grep -avE '^[[:space:]]*exit 0[[:space:]]*$' || true; } | tail -n 1 \
    | grep -qE '^[[:space:]]*\[ "\$\{?FAIL\}?" -eq 0 \]([[:space:]]*\|\|[[:space:]]*exit 1)?[[:space:]]*$' && return 0
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
mk trapbare 'trap finalize_test EXIT
assert_eq 1 1 "accumulates"'
mk trapsq "trap 'finalize_test' EXIT
assert_eq 1 1 \"accumulates\""
mk trapdq 'trap "finalize_test" EXIT
assert_eq 1 1 "accumulates"'
mk traponother 'trap cleanup EXIT
assert_eq 1 1 "accumulates"'
mk trapcomment '# trap finalize_test EXIT
assert_eq 1 1 "accumulates"'
mk ownxexit0 '[ "$FAIL" -eq 0 ] || exit 1
exit 0'
mk ownxecho '[ "$FAIL" -eq 0 ] || exit 1
echo done
exit 0'
mk ownxheredoc 'cat > stub.sh <<EOF
[ "$FAIL" -eq 0 ] || exit 1
EOF
assert_eq 1 1 "accumulates"'
mk ownxfunc 'never_called() {
  [ "$FAIL" -eq 0 ] || exit 1
}
assert_eq 1 1 "accumulates"'
for n in fin own ownx ownxexit0 failexit trapbare trapsq trapdq; do
  finalizes "$TEST_TMP/$n.sh"; assert_eq "0" "$?" "recognizer accepts the $n shape"
done
for n in bare commented printonly ownmid stubexit traponother trapcomment ownxecho ownxheredoc ownxfunc; do
  finalizes "$TEST_TMP/$n.sh"; assert_eq "1" "$?" "recognizer rejects the $n look-alike"
done
finalize_test
