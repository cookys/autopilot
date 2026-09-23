#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/foreman-seat-prompt-scan.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "1" "verbatim §7 prompt stays a failing vocabulary scan"
assert_contains "$OUT" "PROMPT_SCAN_GAP" "the failure names the prompt scan gap"

finalize_test
