#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-stub-fidelity.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "foreman stub fidelity and budget suite passes"
assert_contains "$OUT" "assertions passed" \
  "stub report table, G/F capability behaviour, and the §6 budget window are covered"

finalize_test
