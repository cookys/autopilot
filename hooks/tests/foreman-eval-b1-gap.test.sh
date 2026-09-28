#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/hooks/tests/foreman-eval-b1-gap.probe.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "1" "b1 spec continuation stays a failing test"
assert_contains "$OUT" "B1_GAP" "the failure names the b1 predicate gap"

finalize_test
