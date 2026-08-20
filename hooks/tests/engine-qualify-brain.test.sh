#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/engine-qualify-brain.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "brain qualification suite passes"
assert_contains "$OUT" "43 assertions passed" \
  "brain qualifier covers golden pass, standing (no TTL), strike fold + re-baseline, per-family deviant candidates, malformed fail-closed, insufficient_budget no-row, schema validation, forced brain-seat scope"

finalize_test
