#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/dispatch-local-openai.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "local OpenAI raw transport suite passes"
assert_contains "$OUT" "63 assertions passed" \
  "local dispatch covers egress, identity drift, cancellation, recovery, and telemetry"

finalize_test
