#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/receipt-root-controls.js"
OUT="$TEST_TMP/receipt-root-controls.json"
ERR="$TEST_TMP/receipt-root-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/receipt-root" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "receipt root controls pass"
assert_contains "$(cat "$OUT")" '"no_receipt_root_is_unconfigured": true' "missing receipt root is explicit"
assert_contains "$(cat "$OUT")" '"non_disposable_receipt_root_rejected": true' "non-disposable receipt root is rejected"
assert_contains "$(cat "$OUT")" '"same_uid_receipt_root_compromised": true' "same-uid receipt root is compromised"
assert_contains "$(cat "$OUT")" '"classifier_scores_insecure_root_fail": true' "classifier scores compromised root fail"
assert_contains "$(cat "$OUT")" '"classifier_rejects_driverless_receipt_root_claim": true' "classifier rejects driverless receipt claim"
assert_contains "$(cat "$OUT")" '"classifier_scores_detected_mutation_suspect": true' "classifier scores detected mutation suspect"
assert_contains "$(cat "$OUT")" '"classifier_scores_inconsistent_receipt_state_suspect": true' "classifier scores inconsistent receipt state suspect"
assert_contains "$(cat "$OUT")" '"classifier_scores_protected_root_pass": true' "classifier scores protected root pass"

finalize_test
