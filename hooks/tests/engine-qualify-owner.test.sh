#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/engine-qualify-owner.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "owner qualification suite passes"
assert_contains "$OUT" "31 assertions passed" \
  "owner qualifier covers planted failures, clean controls, mutation, pins, live authority, and the transport_fail abort (no row, stops at the first dead case, never reported as a clean false positive)"

finalize_test
