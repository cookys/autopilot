#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/brain-eval-grader.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "brain grader acceptance suite passes"
assert_contains "$OUT" "40 assertions passed" \
  "grader covers golden pass, per-rule red fixtures (anti-paranoia, uniform leniency, citation validity, pair invariance, containment floor, F5/F2/F12, fuse spend, economy), three distinct early-end outcomes, and forged-telemetry immunity"

finalize_test
