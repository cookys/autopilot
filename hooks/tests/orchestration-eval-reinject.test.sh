#!/usr/bin/env bash
# hooks/tests/orchestration-eval-reinject.test.sh — per-turn reinjection harness tests

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$REPO_ROOT/evals/orchestration"
TEST_TMP=$(mktemp -d -t "orchestration-eval-reinject-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT

export ORCH_TIMEOUT="1m"

STUB_BIN="$TEST_TMP/orch-stub.sh"
cat > "$STUB_BIN" << 'EOF'
#!/usr/bin/env bash
cat "$1" > /dev/null
EOF
chmod +x "$STUB_BIN"
export ORCH_STUB_BIN="$STUB_BIN"

echo "=== Running Orchestration Reinjection Tests ==="

OFF_OUT="$TEST_TMP/reinject-off"
mkdir -p "$OFF_OUT"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t14-constraint-horizon --arm on --runner stub --model test-model --out "$OFF_OUT" >> "$TEST_TMP/off.log" 2>&1

if grep -q "CONSTRAINTS REMINDER" "$OFF_OUT/turn_02.md"; then
  echo "ERROR: off-path should not include CONSTRAINTS REMINDER" >&2
  exit 1
fi
if grep -q '"reinject"' "$OFF_OUT/result.json"; then
  echo "ERROR: off-path result.json should not include reinject" >&2
  exit 1
fi

ON_OUT="$TEST_TMP/reinject-on"
mkdir -p "$ON_OUT"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t14-constraint-horizon --arm on --runner stub --model test-model --out "$ON_OUT" --reinject CONSTRAINTS.md >> "$TEST_TMP/on.log" 2>&1

if ! grep -q "CONSTRAINTS REMINDER" "$ON_OUT/turn_01.md"; then
  echo "ERROR: on-path turn_01.md should include CONSTRAINTS REMINDER" >&2
  exit 1
fi
if ! grep -q "CONSTRAINTS REMINDER" "$ON_OUT/turn_02.md"; then
  echo "ERROR: on-path turn_02.md should include CONSTRAINTS REMINDER" >&2
  exit 1
fi
if ! grep -q "tab-separated values" "$ON_OUT/turn_02.md"; then
  echo "ERROR: on-path turn_02.md should include verbatim constraint content" >&2
  exit 1
fi
if ! grep -q '"reinject":"CONSTRAINTS.md"' "$ON_OUT/result.json"; then
  echo "ERROR: on-path result.json should include reinject key" >&2
  exit 1
fi

FAIL_OUT="$TEST_TMP/reinject-single-fail"
mkdir -p "$FAIL_OUT"
set +e
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t1-fix-with-decoy --arm on --runner stub --model test-model --out "$FAIL_OUT" --reinject CONSTRAINTS.md >> "$TEST_TMP/fail.log" 2>&1
FAIL_STATUS=$?
set -e
if [ "$FAIL_STATUS" -ne 2 ]; then
  echo "ERROR: reinject on single-prompt task should fail with exit 2 (got $FAIL_STATUS)" >&2
  exit 1
fi

echo "=== Orchestration Reinjection Tests Passed ==="
exit 0
