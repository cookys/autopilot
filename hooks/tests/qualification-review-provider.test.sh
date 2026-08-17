#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/qualification-review-provider.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "qualification provider adapter unit suite passes"
assert_contains "$OUT" "70 assertions passed" \
  "provider covers http env contract, cli transport (codex/claude stubs), prompt-mode gates, brain honesty scan, single-line brain framing, and timeout tree-kill"

finalize_test
