#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/brain-eval-generator.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "brain generator acceptance suite passes"
assert_contains "$OUT" "44 assertions passed" \
  "generator covers determinism, corpus pin, renderer rotation, placement, world-table invariants, validator red cases, and leak scan"

finalize_test
