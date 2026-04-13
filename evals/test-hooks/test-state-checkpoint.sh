#!/usr/bin/env bash
# Unit test for state-checkpoint.sh (PreCompact hook)
# Tests: state file creation, permissions, content structure
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_PATH="$(cd "$SCRIPT_DIR/../../hooks" && pwd)/state-checkpoint.sh"
STATE_DIR="${HOME}/.autopilot"
STATE_FILE="${STATE_DIR}/compaction-state.md"

PASS=0
FAIL=0

test_case() {
  local name="$1"
  shift
  if "$@"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

cleanup() {
  rm -f "$STATE_FILE" 2>/dev/null || true
}

echo "=== state-checkpoint.sh Unit Tests ==="
echo ""

# Test 1: Hook produces output (injection text)
cleanup
OUTPUT=$(bash "$HOOK_PATH" 2>/dev/null)
test_case "Hook produces stdout injection" [ -n "$OUTPUT" ]

# Test 2: State file is created
test_case "State file created" [ -f "$STATE_FILE" ]

# Test 3: State file has correct permissions (600)
if [ "$(uname)" = "Darwin" ]; then
  PERMS=$(stat -f '%Lp' "$STATE_FILE")
else
  PERMS=$(stat -c '%a' "$STATE_FILE")
fi
test_case "State file permissions are 600" [ "$PERMS" = "600" ]

# Test 4: State file contains machine-written timestamp
test_case "State file contains timestamp" grep -q "Timestamp:" "$STATE_FILE"

# Test 5: State file contains failure counter
test_case "State file contains failure counter" grep -q "Failure counter:" "$STATE_FILE"

# Test 6: Injection text mentions "compaction"
if echo "$OUTPUT" | grep -qi "compaction"; then
  echo "  PASS: Injection mentions compaction"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Injection mentions compaction"
  FAIL=$((FAIL + 1))
fi

# Test 7: Injection text instructs to use Edit tool
if echo "$OUTPUT" | grep -qi "Edit\|append"; then
  echo "  PASS: Injection instructs Edit tool usage"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Injection instructs Edit tool usage"
  FAIL=$((FAIL + 1))
fi

# Test 8: State directory has 700 permissions
if [ "$(uname)" = "Darwin" ]; then
  DIR_PERMS=$(stat -f '%Lp' "$STATE_DIR")
else
  DIR_PERMS=$(stat -c '%a' "$STATE_DIR")
fi
test_case "State directory permissions are 700" [ "$DIR_PERMS" = "700" ]

cleanup

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
