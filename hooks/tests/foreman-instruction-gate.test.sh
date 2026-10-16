#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Spec Amendment 1 instruction gate through the runner, effect attribution,
# and C's by-hand restore (BL-0010 steps 2 and 3).
OUT="$(node "$REPO_ROOT/scripts/foreman-instruction-gate.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "foreman instruction-gate suite passes"
assert_contains "$OUT" "assertions passed" \
  "suite covers the b1 gate, effect attribution and the by-hand restore"

finalize_test
