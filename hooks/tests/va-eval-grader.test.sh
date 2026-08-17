#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/va-eval-grader.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "VA declared-plan grader unit suite passes"
assert_contains "$OUT" "29 assertions passed" \
  "grader covers perfect-qualifies, every grader-local deviant row (malformed shapes, vacuous, budget, surface/domain, unsupported values, over-strict, defect-imitating, happy-path-only, stateful pass), taxonomy precedence + depth caps + oracle-divergence infra routing, infra abort semantics, twin-invocation counting, and the discriminating delete-the-gate mutation control"

finalize_test
