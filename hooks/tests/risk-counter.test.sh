#!/usr/bin/env bash
# hooks/tests/risk-counter.test.sh — test risk-counter.js / wrapper.

set -uo pipefail

. "$(dirname "$0")/lib.sh"

# Set up test environment
export AUTOPILOT_STATE_DIR="$TEST_TMP/state"
mkdir -p "$AUTOPILOT_STATE_DIR"

# Test wrapper location
WRAPPER="$REPO_ROOT/scripts/risk-counter.sh"

# 1. Reset state
echo "Testing reset..."
out=$(bash "$WRAPPER" reset)
assert_contains "$out" "reset:" "reset output matches"

# 2. Check path
echo "Testing path..."
path_val=$(bash "$WRAPPER" path)
assert_contains "$path_val" "$AUTOPILOT_STATE_DIR" "path contains state dir"

# 3. Check initial status
echo "Testing status..."
status_val=$(bash "$WRAPPER" status)
assert_contains "$status_val" '"risk": 0' "initial risk is 0"
assert_contains "$status_val" '"fixes": 0' "initial fixes is 0"

# 4. Increment event reverted (+15)
echo "Testing increment reverted..."
inc_val=$(bash "$WRAPPER" increment --event reverted)
assert_contains "$inc_val" '"risk": 15' "reverted risk is 15"
assert_contains "$inc_val" '"fixes": 1' "reverted fixes count is 1"

# 5. Threshold-hit (should exit 0 because risk is 15 <= 20)
echo "Testing threshold-hit under 20..."
bash "$WRAPPER" threshold-hit
assert_exit_code "$?" 0 "exit code under threshold"

# 6. Increment event multi-file (+5) -> risk = 20 (still not > 20)
echo "Testing increment multi-file..."
inc_val2=$(bash "$WRAPPER" increment --event multi-file)
assert_contains "$inc_val2" '"risk": 20' "risk is now 20"
bash "$WRAPPER" threshold-hit
assert_exit_code "$?" 0 "exit code exactly at threshold"

# 7. Increment event late-fix (+1) -> risk = 21 (> 20)
echo "Testing increment late-fix..."
inc_val3=$(bash "$WRAPPER" increment --event late-fix)
assert_contains "$inc_val3" '"risk": 21' "risk is now 21"
bash "$WRAPPER" threshold-hit
assert_exit_code "$?" 1 "exit code above threshold"

# 8. Test fail-open on invalid state directory
echo "Testing fail-open on invalid directory..."
export AUTOPILOT_STATE_DIR="$TEST_TMP/not-a-dir"
touch "$AUTOPILOT_STATE_DIR"
out_err=$(bash "$WRAPPER" status 2>&1)
assert_exit_code "$?" 0 "exit code is 0 on error"
assert_contains "$out_err" "[RiskCounter Warning]" "warning is printed"

finalize_test
