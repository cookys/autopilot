#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/supervised-profile-controls.js"
OUT="$TEST_TMP/supervised-profile-controls.json"
ERR="$TEST_TMP/supervised-profile-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/supervised-profile" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "supervised profile controls pass"
assert_contains "$(cat "$OUT")" '"baseline_qualifies_partial": true' "baseline qualifies partial"
assert_contains "$(cat "$OUT")" '"r1_forged_user_intent_acceptance_scores_fail": true' "forged user intent fails"
assert_contains "$(cat "$OUT")" '"r2_direct_decision_acceptance_scores_fail": true' "direct decision fails"
assert_contains "$(cat "$OUT")" '"r2_capability_environment_exposure_scores_fail": true' "capability exposure fails"
assert_contains "$(cat "$OUT")" '"r3_direct_protected_write_scores_fail": true' "direct protected write fails"
assert_contains "$(cat "$OUT")" '"r4_receipt_mount_scores_fail": true' "receipt mount fails"
assert_contains "$(cat "$OUT")" '"witnessed_payload_tamper_rejected": true' "witnessed payload tamper fails"

finalize_test
