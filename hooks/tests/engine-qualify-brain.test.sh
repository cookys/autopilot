#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/engine-qualify-brain.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "brain qualification suite passes"
assert_contains "$OUT" "53 assertions passed" \
  "brain qualifier covers golden pass, standing (no TTL), strike fold + re-baseline, per-family deviant candidates, malformed fail-closed, insufficient_budget no-row, transport_fail abort (no row, first dead round only, transport_ok in raw), schema validation, forced brain-seat scope"

finalize_test
