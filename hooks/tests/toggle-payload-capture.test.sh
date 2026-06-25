#!/usr/bin/env bash
# hooks/tests/toggle-payload-capture.test.sh — test toggle-payload-capture.js / wrapper.

set -uo pipefail

. "$(dirname "$0")/lib.sh"

# Set up sandbox structure
mkdir -p "$TEST_TMP/scripts"
mkdir -p "$TEST_TMP/hooks"

cp "$REPO_ROOT/scripts/toggle-payload-capture.js" "$TEST_TMP/scripts/toggle-payload-capture.js"
cat <<'EOF' > "$TEST_TMP/hooks/hooks.json"
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": []
      },
      {
        "matcher": "Read",
        "hooks": []
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": []
      },
      {
        "matcher": ".*",
        "hooks": []
      }
    ]
  }
}
EOF

# Test target
TEST_JS="$TEST_TMP/scripts/toggle-payload-capture.js"

# 1. Initial status check (should be DISABLED)
echo "Testing status..."
out=$(node "$TEST_JS" status)
assert_eq "$out" "Capture mode: DISABLED" "initial status is DISABLED"

# 2. Enable capture
echo "Testing enable..."
original_checksum=$(sha256sum "$TEST_TMP/hooks/hooks.json" | awk '{print $1}')
out_enable=$(node "$TEST_JS" enable)
assert_contains "$out_enable" "ENABLED — hooks.json wired with capture-payload entries." "enable message contains expected text"

# 3. Check status is now ENABLED
out_status_enabled=$(node "$TEST_JS" status)
assert_contains "$out_status_enabled" "Capture mode: ENABLED" "status is now ENABLED"

# 4. Verify hooks.json was modified correctly
hooks_content=$(cat "$TEST_TMP/hooks/hooks.json")
assert_contains "$hooks_content" "capture-payload.js pre-bash" "hooks.json contains pre-bash capture"
assert_contains "$hooks_content" "capture-payload.js post-star" "hooks.json contains post-star capture"

# 5. Check backup file exists
assert_file_exists "$TEST_TMP/hooks/hooks.json.capture-backup" "backup file created"

# 6. Try enabling again (should exit 1)
echo "Testing enable when already enabled..."
node "$TEST_JS" enable 2>&1
assert_exit_code "$?" 1 "exits with 1 when already enabled"

# 7. Disable capture
echo "Testing disable..."
out_disable=$(node "$TEST_JS" disable)
assert_eq "$out_disable" "DISABLED — hooks.json restored from backup." "disable output matches"

# 8. Check status is back to DISABLED and backup is gone
out_status_disabled=$(node "$TEST_JS" status)
assert_eq "$out_status_disabled" "Capture mode: DISABLED" "status is DISABLED again"
assert_file_absent "$TEST_TMP/hooks/hooks.json.capture-backup" "backup file deleted"

# 9. Verify hooks.json is identical to the original
restored_checksum=$(sha256sum "$TEST_TMP/hooks/hooks.json" | awk '{print $1}')
assert_eq "$restored_checksum" "$original_checksum" "hooks.json is restored byte-for-byte"

# 10. Test fail-open on unexpected error
echo "Testing fail-open on read error..."
echo "invalid json" > "$TEST_TMP/hooks/hooks.json"
out_err=$(node "$TEST_JS" enable 2>&1)
assert_exit_code "$?" 0 "fails open (exit 0) on exception"
assert_contains "$out_err" "[TogglePayloadCapture Warning]" "fail-open prints warning"

finalize_test
