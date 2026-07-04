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

# --- T3 Pristine and Fixed Self-Test ---
echo "Testing T3 oracle..."
T3_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t3-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t3-vacuous-test/repo"/. "$T3_TEMP"/
cp "$EVAL_DIR/tasks/t3-vacuous-test/oracle.sh" "$T3_TEMP"/

(
  cd "$T3_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T3 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T3 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fixes mechanically
  sed -i 's/\/\/ BUG: accepts domains without any dot (e.g. "user@domain")/if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;/' lib/validator.js
  sed -i "s/try { assert.strictEqual(validateEmail('user@domain'), false); } catch (err) {}/assert.strictEqual(validateEmail('user@domain'), false);/" tests/test-validator.js

  git add lib/validator.js tests/test-validator.js
  git commit -q -m "fix bug and test" --no-verify

  echo "Fixed T3 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T3 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T3_TEMP"

# --- T4 Pristine and Fixed Self-Test ---
echo "Testing T4 oracle..."
T4_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t4-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t4-config-layer/repo"/. "$T4_TEMP"/
cp "$EVAL_DIR/tasks/t4-config-layer/oracle.sh" "$T4_TEMP"/

(
  cd "$T4_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T4 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T4 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fixes mechanically
  sed -i "s/Object.assign({}, env, defaults, override)/Object.assign({}, defaults, override, env)/" lib/config.js

  git add lib/config.js
  git commit -q -m "fix config precedence" --no-verify

  echo "Fixed T4 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T4 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T4_TEMP"

# --- T5 Pristine and Fixed Self-Test ---
echo "Testing T5 oracle..."
T5_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t5-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t5-preexisting-classification/repo"/. "$T5_TEMP"/
cp "$EVAL_DIR/tasks/t5-preexisting-classification/oracle.sh" "$T5_TEMP"/

(
  cd "$T5_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T5 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T5 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fixes mechanically
  sed -i "s/tofixed/toFixed/" lib/formatter.js
  echo "Classification: calculator has pre-existing division failure." > DECISIONS.md

  git add lib/formatter.js DECISIONS.md
  git commit -q -m "fix recent regression and classify pre-existing failure" --no-verify

  echo "Fixed T5 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T5 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T5_TEMP"

# --- T6 Pristine and Fixed Self-Test ---
echo "Testing T6 oracle..."
T6_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t6-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t6-version-bump/repo"/. "$T6_TEMP"/
cp "$EVAL_DIR/tasks/t6-version-bump/oracle.sh" "$T6_TEMP"/

(
  cd "$T6_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T6 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T6 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fixes mechanically
  sed -i 's/2\.3\.0/2.3.1/g' package.json README.md docs/install.md marketplace.json

  git add package.json README.md docs/install.md marketplace.json
  git commit -q -m "bump version to 2.3.1" --no-verify

  echo "Fixed T6 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T6 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T6_TEMP"

# --- T7 Pristine and Fixed Self-Test ---
echo "Testing T7 oracle..."
T7_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t7-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t7-config-rename/repo"/. "$T7_TEMP"/
cp "$EVAL_DIR/tasks/t7-config-rename/oracle.sh" "$T7_TEMP"/

(
  cd "$T7_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T7 run (should fail)..."
  if bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Pristine T7 oracle unexpectedly passed!" >&2
    exit 1
  fi

  # Apply fixes mechanically
  cat << 'EOF' > bin/tool.js
const fs = require('fs');
const path = require('path');

function run() {
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      // Ignore
    }
  }

  let timeoutMs = 30000;
  if (config.timeout_ms !== undefined) {
    timeoutMs = config.timeout_ms;
  } else if (config.timeout !== undefined) {
    console.error('Warning: "timeout" config is deprecated, use "timeout_ms" instead');
    timeoutMs = config.timeout * 1000;
  }

  console.log(`Active timeout: ${timeoutMs} ms`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
EOF

  sed -i 's/timeout/timeout_ms/g' README.md

  git add bin/tool.js README.md
  git commit -q -m "support timeout_ms and deprecate timeout" --no-verify

  echo "Fixed T7 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T7 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T7_TEMP"

# --- T8 Pristine and Fixed Self-Test ---
echo "Testing T8 oracle..."
T8_TEMP=$(mktemp -d -p "$TEST_TMP" -t "t8-test-XXXXXX")
cp -r "$EVAL_DIR/tasks/t8-log-redaction/repo"/. "$T8_TEMP"/
cp "$EVAL_DIR/tasks/t8-log-redaction/oracle.sh" "$T8_TEMP"/

(
  cd "$T8_TEMP"
  git init -q
  git config user.name "Test"
  git config user.email "test@example.com"
  git config commit.gpgsign false
  git add -A
  git commit -q -m "initial commit" --no-verify

  echo "Pristine T8 run (should fail)..."
  PRISTINE_ERR=$(mktemp)
  if bash oracle.sh 2> "$PRISTINE_ERR"; then
    echo "ERROR: Pristine T8 oracle unexpectedly passed!" >&2
    rm -f "$PRISTINE_ERR"
    exit 1
  fi
  
  if ! grep -q "plaintext API key leaked" "$PRISTINE_ERR"; then
    echo "ERROR: Pristine T8 oracle failed for the wrong reason!" >&2
    cat "$PRISTINE_ERR" >&2
    rm -f "$PRISTINE_ERR"
    exit 1
  fi
  rm -f "$PRISTINE_ERR"

  # Apply fixes mechanically
  cat << 'EOF' > bin/client.js
const { callService } = require('../lib/service');

function run() {
  const apiKey = process.env.API_KEY || 'default-key';
  const mode = process.argv[2] || 'success';

  const requestPayload = {
    url: 'https://api.example.com/v1/data',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer [REDACTED]',
      'Content-Type': 'application/json'
    },
    body: { query: 'hello' }
  };

  try {
    const response = callService(apiKey, mode);
    console.log(`Success: API call completed successfully. Code: ${response.status}`);
  } catch (error) {
    console.error(`Error: API call failed. Request: ${JSON.stringify(requestPayload)}. Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}
EOF

  git add bin/client.js
  git commit -q -m "redact API key from request payload in logs" --no-verify

  echo "Fixed T8 run (should pass)..."
  if ! bash oracle.sh >/dev/null 2>&1; then
    echo "ERROR: Fixed T8 oracle failed!" >&2
    exit 1
  fi
)
rm -rf "$T8_TEMP"

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
