#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/local-engine-probe.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "local deployment fingerprint/probe suite passes"
assert_contains "$OUT" "50 assertions passed" \
  "local probe covers identity, capacity, TLS/auth, containment, schemas, and leases"

finalize_test
