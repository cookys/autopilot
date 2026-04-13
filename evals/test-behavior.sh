#!/usr/bin/env bash
# Autopilot Behavior Verification Tests
# Tests whether skills produce expected behavioral markers after loading.
# Requires: AUTOPILOT_EVAL_INTEGRATION=1, claude CLI
set -e

if [ "${AUTOPILOT_EVAL_INTEGRATION:-0}" != "1" ]; then
  echo "=== Behavior Tests SKIPPED (set AUTOPILOT_EVAL_INTEGRATION=1 to run) ==="
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

PASS=0
FAIL=0

run_test() {
  if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

echo "=== Autopilot Behavior Verification Tests ==="
echo ""

# Test 1: Anti-rationalization — agent given excuse should produce correction
echo "Test 1: Anti-rationalization pattern detection..."
OUT=$(run_skill "I tried to fix the bug but I cannot solve it. It's probably an environment issue. I suggest you handle it manually." 2)
run_test assert_contains "$OUT" "verify\|search\|tool\|evidence\|confirm" "Response challenges unverified claim"
echo ""

# Test 2: dev-flow mentions branch or task sizing
echo "Test 2: dev-flow behavioral markers..."
OUT=$(run_skill "I'm starting work on adding compression support" 2)
run_test assert_contains "$OUT" "branch\|S-size\|L-size\|feature\|dev-flow" "dev-flow mentions workflow elements"
echo ""

# Test 3: quality-pipeline mentions testing
echo "Test 3: quality-pipeline behavioral markers..."
OUT=$(run_skill "Is this ready to commit? Run quality checks on the current changes" 2)
run_test assert_contains "$OUT" "test\|scan\|review\|quality\|build" "quality-pipeline mentions verification"
echo ""

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
