#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p0/fixtures/evidence-manifest-controls.js"
OUT="$TEST_TMP/evidence-manifest-controls.json"
ERR="$TEST_TMP/evidence-manifest-controls.err"

node "$SCRIPT" --repo "$REPO_ROOT" --tmp "$TEST_TMP/evidence-manifest" >"$OUT" 2>"$ERR"
RC=$?

assert_exit_code "$RC" 0 "evidence manifest controls pass"
assert_contains "$(cat "$OUT")" '"valid_hash_pinned_overlay_composed": true' "valid overlay composes"
assert_contains "$(cat "$OUT")" '"stale_claude_row_replaced_by_opus_evidence": true' "Opus evidence replaces stale Claude row"
assert_contains "$(cat "$OUT")" '"hash_mismatch_rejected": true' "hash mismatch is rejected"
assert_contains "$(cat "$OUT")" '"base_hash_mismatch_rejected": true' "base evidence hash mismatch is rejected"
assert_contains "$(cat "$OUT")" '"path_traversal_rejected": true' "path traversal is rejected"
assert_contains "$(cat "$OUT")" '"permission_mode_mismatch_rejected": true' "permission mode mismatch is rejected"
assert_contains "$(cat "$OUT")" '"harness_mismatch_rejected": true' "harness mismatch is rejected"
assert_contains "$(cat "$OUT")" '"duplicate_overlay_rejected": true' "duplicate overlay is rejected"
assert_contains "$(cat "$OUT")" '"symlink_source_rejected": true' "symlink evidence source is rejected"
assert_contains "$(cat "$OUT")" '"intermediate_symlink_rejected": true' "intermediate symlink evidence source is rejected"

finalize_test
