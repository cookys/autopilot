#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-eval-generator.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "foreman generator acceptance suite passes"
assert_contains "$OUT" "34 assertions passed" \
  "generator covers corpus shape, determinism, variant coverage, A6 self-test (positive+negative+exemption), vocabulary projection, and the leak scan"

finalize_test
