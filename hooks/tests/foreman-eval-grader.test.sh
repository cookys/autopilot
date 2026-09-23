#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-eval-grader.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "foreman grader acceptance suite passes"
assert_contains "$OUT" "assertions passed" \
  "grader covers one fixture per check plus campaigns the spec calls correct"

ROUT="$(node "$REPO_ROOT/scripts/foreman-eval-runner.test.js" 2>&1)"
RRC=$?
assert_exit_code "$RRC" "0" "foreman runner refusal suite passes"
assert_contains "$ROUT" "assertions passed" \
  "runner covers preconditions, transport abort, and the anti-rerun rule"

finalize_test
