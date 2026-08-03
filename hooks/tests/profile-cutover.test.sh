#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/profile-cutover.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "profile cutover gate suite passes"
assert_contains "$OUT" "assertions passed" \
  "profile cutover holds without live evidence and admits only the complete verified case"

finalize_test
