#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-seat-prompt-scan.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "the installed seat prompt passes the vocabulary scan"
assert_contains "$OUT" "seat prompt scan passed" "the scan reports a pass"

finalize_test
