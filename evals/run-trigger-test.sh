#!/usr/bin/env bash
# Autopilot Skill Trigger Tests
# Verifies skills trigger on correct prompts and don't trigger on incorrect ones.
# Requires: AUTOPILOT_EVAL_INTEGRATION=1, claude CLI
set -e

if [ "${AUTOPILOT_EVAL_INTEGRATION:-0}" != "1" ]; then
  echo "=== Trigger Tests SKIPPED (set AUTOPILOT_EVAL_INTEGRATION=1 to run) ==="
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="/tmp/autopilot-evals/$(date +%s)"
mkdir -p "$RESULTS_DIR"

echo "=== Autopilot Skill Trigger Tests ==="
echo "Plugin dir: $PLUGIN_DIR"
echo "Results: $RESULTS_DIR"
echo ""

PASS=0
FAIL=0

test_trigger() {
  local skill="$1"
  local prompt="$2"
  local label="$3"
  local outfile="$RESULTS_DIR/$(echo "$label" | tr ' /:' '___').json"

  timeout 120 claude -p "$prompt" \
    --plugin-dir "$PLUGIN_DIR" \
    --dangerously-skip-permissions \
    --max-turns 2 \
    --output-format stream-json \
    > "$outfile" 2>&1 || true

  if grep -q "\"$skill\"" "$outfile" 2>/dev/null; then
    echo "  PASS: $label (triggered $skill)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label (expected $skill but not triggered)"
    FAIL=$((FAIL + 1))
  fi
}

test_no_trigger() {
  local prompt="$1"
  local label="$2"
  local outfile="$RESULTS_DIR/$(echo "$label" | tr ' /:' '___').json"

  timeout 120 claude -p "$prompt" \
    --plugin-dir "$PLUGIN_DIR" \
    --dangerously-skip-permissions \
    --max-turns 2 \
    --output-format stream-json \
    > "$outfile" 2>&1 || true

  if grep -q '"autopilot:' "$outfile" 2>/dev/null; then
    echo "  FAIL: $label (autopilot skill triggered unexpectedly)"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $label (no autopilot skill triggered)"
    PASS=$((PASS + 1))
  fi
}

echo "--- Should Trigger ---"
while IFS='|' read -r skill prompt; do
  # Skip comments and empty lines
  [[ "$skill" =~ ^#.*$ || -z "$skill" ]] && continue
  skill=$(echo "$skill" | xargs)
  prompt=$(echo "$prompt" | xargs)
  test_trigger "$skill" "$prompt" "$skill: $(echo "$prompt" | cut -c1-50)"
done < "$SCRIPT_DIR/trigger-prompts/should-trigger.txt"

echo ""
echo "--- Should NOT Trigger ---"
while IFS= read -r prompt; do
  [[ "$prompt" =~ ^#.*$ || -z "$prompt" ]] && continue
  prompt=$(echo "$prompt" | xargs)
  test_no_trigger "$prompt" "no-trigger: $(echo "$prompt" | cut -c1-40)"
done < "$SCRIPT_DIR/trigger-prompts/should-not-trigger.txt"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo "Detailed output: $RESULTS_DIR"
[ "$FAIL" -eq 0 ] || exit 1
