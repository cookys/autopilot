#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/va-eval-generator.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "VA declared-plan generator unit suite passes"
assert_contains "$OUT" "445 assertions passed" \
  "generator covers determinism, per-trial divergence, admission sweep, payload independence, clause inversion, admission red cases, DISCRIMINATING payload independence + per-family whole-twin leak injection, value algebra, and dual-path state semantics"

finalize_test
