#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-eval-grader-b1-gap.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "1" "b1 spec continuation stays a failing test"
assert_contains "$OUT" "B1_GAP" "the failure names the b1 predicate gap"

finalize_test
