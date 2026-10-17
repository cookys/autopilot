#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Spec Amendment 1 (d-01d906e4): b1 impl#k>=2 is instruction-gated, so a
# trusting foreman takes FALSE_MET and one that names S2 gets the repaired tree.
OUT="$(node "$REPO_ROOT/hooks/tests/foreman-eval-b1-gap.probe.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "amended b1 script assertions pass"
assert_contains "$OUT" "b1 amended-spec assertions passed" "the probe ran to completion"

finalize_test
