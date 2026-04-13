#!/usr/bin/env bash
# Run all autopilot eval tests.
# Unit tests run by default. Integration tests require AUTOPILOT_EVAL_INTEGRATION=1.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo "====================================="
echo "  Autopilot Eval Suite"
echo "====================================="
echo ""

# --- Unit tests (always run, no API cost) ---
echo "--- Hook Unit Tests ---"
echo ""

echo "[1/3] failure-escalation.js"
node "$SCRIPT_DIR/test-hooks/test-failure-escalation.js" || FAIL=$((FAIL + 1))
echo ""

echo "[2/3] state-checkpoint.sh"
bash "$SCRIPT_DIR/test-hooks/test-state-checkpoint.sh" || FAIL=$((FAIL + 1))
echo ""

echo "[3/3] hooks.json validity"
bash "$SCRIPT_DIR/test-hooks/test-hooks-json-valid.sh" || FAIL=$((FAIL + 1))
echo ""

# --- Integration tests (opt-in) ---
if [ "${AUTOPILOT_EVAL_INTEGRATION:-0}" = "1" ]; then
  echo "--- Integration Tests (API calls) ---"
  echo ""

  echo "[4] Trigger tests"
  bash "$SCRIPT_DIR/run-trigger-test.sh" || FAIL=$((FAIL + 1))
  echo ""

  echo "[5] Behavior tests"
  bash "$SCRIPT_DIR/test-behavior.sh" || FAIL=$((FAIL + 1))
  echo ""
else
  echo "--- Integration Tests SKIPPED ---"
  echo "(set AUTOPILOT_EVAL_INTEGRATION=1 to run)"
  echo ""
fi

echo "====================================="
if [ "$FAIL" -eq 0 ]; then
  echo "  ALL TESTS PASSED"
else
  echo "  $FAIL test suite(s) FAILED"
fi
echo "====================================="

exit "$FAIL"
