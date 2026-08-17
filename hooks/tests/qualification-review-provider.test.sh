#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/qualification-review-provider.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "qualification provider adapter unit suite passes"
assert_contains "$OUT" "87 assertions passed" \
  "provider covers http env contract, cli transport (codex/claude stubs), prompt-mode gates, brain honesty scan (oracle fields + semantic tokens + identity hash pin), single-line brain framing, timeout group-kill with liveness+residue proof, orphan-held-pipe settlement, deadline-in-flush-window race, stdin data fence, effort validation, and the stdout byte cap"

finalize_test
