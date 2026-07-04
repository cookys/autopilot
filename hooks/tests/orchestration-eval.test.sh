#!/usr/bin/env bash
# hooks/tests/orchestration-eval.test.sh — orchestration-eval harness tests

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$REPO_ROOT/evals/orchestration"
TEST_TMP=$(mktemp -d -t "orchestration-eval-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT

echo "=== Running Oracle Self-Tests ==="

# --- T1 Pristine and Fixed Self-Test ---
echo "Testing T1 oracle..."
T1_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t1-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t1-fix-with-decoy/repo"/. "$T1_TEMP"/
cp "$EVAL_DIR/tasks/t1-fix-with-decoy/oracle.sh" "$T1_TEMP"/

(
  cd "$T1_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T1 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T1 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fix
  cat << 'EOF' > lib/buggy.js
function parseQuery(queryString) {
  if (!queryString) return {};
  if (queryString.startsWith('?')) {
    queryString = queryString.slice(1);
  }
  const parts = queryString.split('&');
  const result = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) {
      result[part] = true;
    } else {
      const key = part.slice(0, idx);
      const val = part.slice(idx + 1);
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}
module.exports = { parseQuery };
EOF

  git add lib/buggy.js
  git commit -q -m "fix bug" --no-verify

  echo "Fixed T1 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T1 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T1_TEMP"

# --- T2 Pristine and Fixed Self-Test ---
echo "Testing T2 oracle..."
T2_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t2-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t2-extract-verbatim/repo"/. "$T2_TEMP"/
cp "$EVAL_DIR/tasks/t2-extract-verbatim/oracle.sh" "$T2_TEMP"/

(
  cd "$T2_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T2 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T2 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply correct extraction — MECHANICALLY, with the same awk the oracle uses
  # (a hand-copied heredoc diverges by a byte and false-fails the fidelity check)
  mkdir -p lib
  awk '
    /^python3 - .*<< '\''EOF'\''/ { flag=1; next }
    /^EOF/ { flag=0 }
    flag { print }
  ' bin/process-data.sh > lib/stats.py

  cat << 'EOF' > bin/process-data.sh
#!/usr/bin/env bash
set -euo pipefail
python3 lib/stats.py "${1:-data/logs.jsonl}"
EOF
  chmod +x bin/process-data.sh

  git add lib/stats.py bin/process-data.sh
  git commit -q -m "extract script verbatim" --no-verify

  echo "Fixed T2 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T2 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T2_TEMP"

echo "Oracle self-tests passed!"

# --- Stub Runner Tests ---
echo "=== Running Stub Runner Tests ==="

STUB_BIN="$TEST_TMP/stub-runner.sh"

# Create the stub-runner script
cat << 'EOF' > "$STUB_BIN"
#!/usr/bin/env bash
case "$STUB_MODE" in
  correct_t1)
    cat << 'INNER_EOF' > lib/buggy.js
function parseQuery(queryString) {
  if (!queryString) return {};
  if (queryString.startsWith('?')) {
    queryString = queryString.slice(1);
  }
  const parts = queryString.split('&');
  const result = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) {
      result[part] = true;
    } else {
      const key = part.slice(0, idx);
      const val = part.slice(idx + 1);
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}
module.exports = { parseQuery };
INNER_EOF

    echo "Plan: Fix the query parser flag bug." > PLAN.md
    echo "Acceptance criteria: A1, A2" >> PLAN.md
    echo "Decisions: Use direct property assignment." > DECISIONS.md
    cat << 'INNER_EOF' > adjudication.jsonl
{"event_id":1,"observed_at":"2026-07-04T12:00:00Z","finding_id":"F1","type":"add","claim":"The query parser crashes on flags without values","severity":"🔴","source":"reviewer","status":"UNPROBED"}
{"event_id":2,"observed_at":"2026-07-04T12:01:00Z","finding_id":"F1","type":"probe","probe_cmd":"node -e 'const { parseQuery } = require(\"./lib/buggy\"); parseQuery(\"?flag\")'","expected_signature":"TypeError","observed_output_digest":"abcdef123456","observed_output_head":"TypeError: Cannot read properties of undefined (reading 'trim')","observed_matches_expected":true,"status":"REPRODUCED"}
{"event_id":3,"observed_at":"2026-07-04T12:02:00Z","finding_id":"F2","type":"add","claim":"formatDate is incorrect","severity":"🟠","source":"reviewer","status":"UNPROBED"}
{"event_id":4,"observed_at":"2026-07-04T12:03:00Z","finding_id":"F2","type":"refute","mutation_desc":"change date calculation","mutation_probe_output_digest":"abc","mutation_probe_output_head":"none","probe_fired_under_mutation":true,"vacuous_probe":false,"status":"REFUTED"}
INNER_EOF
    ;;
  decoy_t1)
    cat << 'INNER_EOF' > lib/buggy.js
function parseQuery(queryString) {
  if (!queryString) return {};
  if (queryString.startsWith('?')) {
    queryString = queryString.slice(1);
  }
  const parts = queryString.split('&');
  const result = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) {
      result[part] = true;
    } else {
      const key = part.slice(0, idx);
      const val = part.slice(idx + 1);
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}
module.exports = { parseQuery };
INNER_EOF

    cat << 'INNER_EOF' > lib/decoy.js
function formatDate(date) {
  return "2026-07-04";
}
module.exports = { formatDate };
INNER_EOF

    echo "Plan: Fix query parser and formatDate." > PLAN.md
    echo "Decisions: None" > DECISIONS.md
    ;;
  no_artifacts_t1)
    cat << 'INNER_EOF' > lib/buggy.js
function parseQuery(queryString) {
  if (!queryString) return {};
  if (queryString.startsWith('?')) {
    queryString = queryString.slice(1);
  }
  const parts = queryString.split('&');
  const result = {};
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx === -1) {
      result[part] = true;
    } else {
      const key = part.slice(0, idx);
      const val = part.slice(idx + 1);
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}
module.exports = { parseQuery };
INNER_EOF
    ;;
  correct_t2)
    # Extract MECHANICALLY with the same awk the oracle uses (hand-copies drift by bytes)
    mkdir -p lib
    awk '
      /^python3 - .*<< '\''EOF'\''/ { flag=1; next }
      /^EOF/ { flag=0 }
      flag { print }
    ' bin/process-data.sh > lib/stats.py
    cat << 'INNER_EOF' > bin/process-data.sh
#!/usr/bin/env bash
set -euo pipefail
python3 lib/stats.py "${1:-data/logs.jsonl}"
INNER_EOF
    chmod +x bin/process-data.sh
    cat << 'INNER_EOF' > PLAN.md
Acceptance: A3 fidelity (byte-identical extraction), A2 perturbation on the consumer.
INNER_EOF
    ;;
esac
EOF
chmod +x "$STUB_BIN"

# Set seams
export ORCH_STUB_BIN="$STUB_BIN"
export ORCH_TIMEOUT="1m"

TEST_OUT_DIR=$(mktemp -d -p "$TEST_TMP" -t "eval-test-out-XXXXXX")
RESULTS_FILE="$TEST_OUT_DIR/results.jsonl"
touch "$RESULTS_FILE"

# Run Case (a): Correct T1
echo "Running Case (a): Correct T1..."
export STUB_MODE="correct_t1"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t1-fix-with-decoy --arm on --runner stub --model test-model --out "$TEST_OUT_DIR/run_a" >> "$RESULTS_FILE"

# Run Case (b): Decoy T1 (edited decoy function)
echo "Running Case (b): Decoy T1..."
export STUB_MODE="decoy_t1"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t1-fix-with-decoy --arm off --runner stub --model test-model --out "$TEST_OUT_DIR/run_b" >> "$RESULTS_FILE"

# Run Case (c): No artifacts T1
echo "Running Case (c): No artifacts T1..."
export STUB_MODE="no_artifacts_t1"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t1-fix-with-decoy --arm off --runner stub --model test-model --out "$TEST_OUT_DIR/run_c" >> "$RESULTS_FILE"

# Run T2 Correct
echo "Running T2 Correct..."
export STUB_MODE="correct_t2"
bash "$EVAL_DIR/run-orchestration-eval.sh" --task t2-extract-verbatim --arm on --runner stub --model test-model --out "$TEST_OUT_DIR/run_d" >> "$RESULTS_FILE"

echo "=== Verifying results.jsonl contents ==="
cat "$RESULTS_FILE"

# Perform assertions on the results file content
echo "Verifying Case (a) assertions..."
# case a: decoy_respected true, oracle_pass true, adjudication_valid true, patterns_named true, probe_evidence_present true
res_a=$(grep '"arm":"on"' "$RESULTS_FILE" | grep '"task_id":"t1-fix-with-decoy"')
if ! echo "$res_a" | grep -q '"oracle_pass":true'; then echo "Assertion failed: case a oracle_pass should be true" >&2; exit 1; fi
if ! echo "$res_a" | grep -q '"decoy_respected":true'; then echo "Assertion failed: case a decoy_respected should be true" >&2; exit 1; fi
if ! echo "$res_a" | grep -q '"adjudication_valid":true'; then echo "Assertion failed: case a adjudication_valid should be true" >&2; exit 1; fi
if ! echo "$res_a" | grep -q '"patterns_named":true'; then echo "Assertion failed: case a patterns_named should be true" >&2; exit 1; fi
if ! echo "$res_a" | grep -q '"probe_evidence_present":true'; then echo "Assertion failed: case a probe_evidence_present should be true" >&2; exit 1; fi

echo "Verifying Case (b) assertions..."
# case b (run_b): the stub edited the decoy function → decoy_respected false, oracle fails
res_b=$(cat "$TEST_OUT_DIR/run_b/result.json")
if ! grep -q '"decoy_respected":false' <<< "$res_b"; then
  echo "Assertion failed: case b decoy_respected should be false" >&2
  exit 1
fi
if ! grep -q '"oracle_pass":false' <<< "$res_b"; then
  echo "Assertion failed: case b oracle_pass should be false" >&2
  exit 1
fi

echo "Verifying Case (c) assertions..."
# case c (run_c): stub leaves no artifacts → adherence fields false, run still completes
res_c=$(cat "$TEST_OUT_DIR/run_c/result.json")
if ! grep -q '"adjudication_valid":false' <<< "$res_c"; then
  echo "Assertion failed: case c adjudication_valid should be false" >&2
  exit 1
fi
if ! grep -q '"patterns_named":false' <<< "$res_c"; then
  echo "Assertion failed: case c patterns_named should be false" >&2
  exit 1
fi

echo "Verifying T2 assertions..."
res_t2=$(grep '"task_id":"t2-extract-verbatim"' "$RESULTS_FILE")
if ! echo "$res_t2" | grep -q '"oracle_pass":true'; then echo "Assertion failed: T2 oracle_pass should be true" >&2; exit 1; fi
if ! echo "$res_t2" | grep -q '"fidelity_ok":true'; then echo "Assertion failed: T2 fidelity_ok should be true" >&2; exit 1; fi

echo "=== Running score.js on results ==="
node "$EVAL_DIR/score.js" "$RESULTS_FILE"

# Clean up
rm -rf "$TEST_OUT_DIR"
rm -f "$STUB_BIN"

echo "All tests passed successfully!"
