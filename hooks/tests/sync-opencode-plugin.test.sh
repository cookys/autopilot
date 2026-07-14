#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

SYNC="$REPO_ROOT/scripts/sync-opencode-plugin.sh"
TARGET="$REPO_ROOT/.opencode/plugin-package"
BACKUP="$TEST_TMP/plugin-package"
cp -a "$TARGET" "$BACKUP"

restore_payload() {
  rm -rf "$TARGET"
  cp -a "$BACKUP" "$TARGET"
}
trap 'restore_payload; cleanup_test_tmp' EXIT

OUT="$(bash "$SYNC" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "clean generated payload passes drift check"
assert_contains "$OUT" "in sync" "clean drift check reports success"

printf '\nsmoke-drift\n' >> "$TARGET/autopilot.ts"
OUT="$(bash "$SYNC" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "tampered generated payload fails drift check"
assert_contains "$OUT" "drift detected" "drift check reports mismatch"

OUT="$(bash "$SYNC" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "sync repairs generated payload"
OUT="$(bash "$SYNC" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "repaired payload passes drift check"

restore_payload
finalize_test
