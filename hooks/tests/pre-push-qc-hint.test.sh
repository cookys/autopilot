#!/usr/bin/env bash
# RED at 792347b09: .githooks/pre-push QC-Verdict hint had the Fix / sample trailer / bypass lines and no sentence that the trailer must share the final paragraph with Co-Authored-By (assert_contains "same final paragraph" failed).
. "$(dirname "$0")/lib.sh"
HINT="$(sed -n '/qc-gate: protected-path push without review evidence/,/mode=warn/p' "$REPO_ROOT/.githooks/pre-push")"
assert_contains "$HINT" "Fix: run the qc gate (quality-pipeline / reviewer), then add a trailer to the landing commit:" "old fix line"
assert_contains "$HINT" "QC-Verdict: PASS (reviewer <id>" "old trailer sample"
assert_contains "$HINT" "Deliberate bypass (logged by git): git push --no-verify" "old bypass line"
assert_contains "$HINT" "same final paragraph of the commit message as Co-Authored-By" "same-paragraph hint"
assert_contains "$HINT" "no blank line between them" "no blank line"
finalize_test
