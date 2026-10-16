#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-eval-sandbox.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "foreman candidate-surface suite passes"
assert_contains "$OUT" "assertions passed" \
  "sandbox suite covers shell, network-off, git-derived host records, and the candidate-owned ledger"

finalize_test
