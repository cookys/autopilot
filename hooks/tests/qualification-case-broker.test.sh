#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/qualification-case-broker.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "case-only broker unit and sandbox integration suite passes"
assert_contains "$OUT" "42 assertions passed" \
  "case-only broker covers bounds, identity, credentials, timeout, and one-shot state"

finalize_test
