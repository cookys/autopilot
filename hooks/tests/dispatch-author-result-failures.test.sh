#!/usr/bin/env bash
# hooks/tests/dispatch-author-result-failures.test.sh
# Unit 2c.ii verification oracle: strict failure-outcome provenance matrix
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Test input prompt content" > "$PROMPT"

# Set up common variables
export SENTINEL="$TEST_TMP/sentinel_touched"
export RUN_COUNT_FILE="$TEST_TMP/run_count"
export RECORDED_ARGV="$TEST_TMP/recorded_argv"
export RECORDED_ENV="$TEST_TMP/recorded_env"

# We want to bound settle time using AUTOPILOT_SETTLE_MS test seam
export AUTOPILOT_SETTLE_MS=200

# Helper to validate JSON output using python3
validate_json_result() {
  local out="$1"
  local status="$2"
  local endpoint="$3"
  local path="$4"
  local forbidden="$5"
  local raw_log_null="$6"
  local error_substr="$7"

  PY_OUT="$(python3 -c "
import sys, json

try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f\"Failed to parse JSON: {e}\")
    sys.exit(1)

expected_status = sys.argv[2]
expected_endpoint = sys.argv[3]
expected_path = sys.argv[4]
forbidden_values = sys.argv[5].split(\",\")
expected_raw_log_null = (sys.argv[6] == \"true\")
expected_error_substr = sys.argv[7]

errors = []

def check_val(key, expected):
    if key not in data:
        errors.append(f\"Expected key {key} to be present in data\")
        return
    val = data.get(key)
    if val != expected:
        errors.append(f\"Expected {key}={expected}, got {val}\")

check_val(\"status\", expected_status)
check_val(\"runner\", \"cc-shim\")
check_val(\"model\", \"glm-5.2\")
check_val(\"selection_source\", \"strict_roster\")
check_val(\"selection_path\", expected_path)

# Verify verification_author object
if \"verification_author\" not in data:
    errors.append(\"Expected key verification_author to be present in data\")
else:
    va = data.get(\"verification_author\")
    if not isinstance(va, dict):
        errors.append(f\"Expected verification_author to be dict, got {type(va)}\")
    else:
        expected_keys = {\"engine\", \"runner\", \"effort\", \"endpoint\", \"family\"}
        actual_keys = set(va.keys())
        if actual_keys != expected_keys:
            errors.append(f\"Expected verification_author keys {expected_keys}, got {actual_keys}\")

        def check_va_val(key, expected):
            if key not in va:
                errors.append(f\"Expected key {key} to be present in verification_author\")
                return
            val = va.get(key)
            if val != expected:
                errors.append(f\"Expected verification_author.{key}={expected}, got {val}\")

        check_va_val(\"engine\", \"glm-5.2\")
        check_va_val(\"runner\", \"cc-shim\")
        check_va_val(\"effort\", \"high\")
        check_va_val(\"endpoint\", expected_endpoint)
        check_va_val(\"family\", \"zhipu\")

# Verify raw_log
raw_log = data.get(\"raw_log\")
if expected_raw_log_null:
    if raw_log is not None:
        errors.append(f\"Expected raw_log to be null, got {raw_log}\")
else:
    if raw_log is None or raw_log == \"\":
        errors.append(\"Expected raw_log to be a non-empty string path, got null/empty\")

# Verify error
if expected_error_substr != \"null\":
    err_val = data.get(\"error\")
    if err_val is None:
        errors.append(\"Expected error message, got null\")
    elif expected_error_substr not in err_val:
        errors.append(f\"Expected error to contain {chr(39)}{expected_error_substr}{chr(39)}, got {chr(39)}{err_val}{chr(39)}\")
else:
    check_val(\"error\", None)

# Verify forbidden values are absent from the entire raw JSON string
raw_json = sys.argv[1]
for val in forbidden_values:
    if val and val in raw_json:
        errors.append(f\"Forbidden value {chr(39)}{val}{chr(39)} found in result JSON\")

if errors:
    print(\"; \".join(errors))
    sys.exit(1)
" "$out" "$status" "$endpoint" "$path" "$forbidden" "$raw_log_null" "$error_substr" 2>&1)"
  assert_eq "0" "$?" "JSON validation failed: $PY_OUT"
}

cleanup_env() {
  unset AUTOPILOT_ENDPOINT_UNREADY_FAIL_EP_URL
  unset AUTOPILOT_ENDPOINT_UNREADY_FAIL_EP_TOKEN
  unset AUTOPILOT_ENDPOINT_READY_FAIL_EP_URL
  unset AUTOPILOT_ENDPOINT_READY_FAIL_EP_TOKEN
  unset AUTOPILOT_ENDPOINT_READY_EMPTY_EP_URL
  unset AUTOPILOT_ENDPOINT_READY_EMPTY_EP_TOKEN
  unset ANTHROPIC_BASE_URL
  unset ANTHROPIC_AUTH_TOKEN
  unset ANTHROPIC_COMPATIBLE_BASE_URL
  unset ANTHROPIC_COMPATIBLE_AUTH_TOKEN
  rm -f "$SENTINEL" "$RUN_COUNT_FILE" "$RECORDED_ARGV" "$RECORDED_ENV"
}

# --- Case 1: Resolved endpoint precondition failure ---
cleanup_env

# Usable raw fixture values
RAW_BASE_URL_FIXTURE="https://api.raw-fixture-value.xyz/v1"
RAW_TOKEN_FIXTURE="raw-token-secret-fixture-987"
export ANTHROPIC_BASE_URL="$RAW_BASE_URL_FIXTURE"
export ANTHROPIC_AUTH_TOKEN="$RAW_TOKEN_FIXTURE"

# Endpoint UNREADY_FAIL_EP url is configured but token is unset -> unready!
export AUTOPILOT_ENDPOINT_UNREADY_FAIL_EP_URL="https://api.unready-fail.org/v1"

CASE1_DIR="$TEST_TMP/case1"
mkdir -p "$CASE1_DIR/.claude"
EXPECTED_PATH1="$CASE1_DIR/.claude/review-loop-config.md"

cat <<EOF > "$EXPECTED_PATH1"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: UNREADY_FAIL_EP
- implementer_engine: gpt-5.3-codex-spark
EOF

# Fake runner that shouldn't be executed
FAKE_RUNNER1="$TEST_TMP/fake-runner-1"
cat <<'EOF' > "$FAKE_RUNNER1"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "started" >> "$RUN_COUNT_FILE"
exit 0
EOF
chmod +x "$FAKE_RUNNER1"

# Unset generic compatible variables to avoid fallback matching ready state
unset ANTHROPIC_COMPATIBLE_BASE_URL
unset ANTHROPIC_COMPATIBLE_AUTH_TOKEN

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER1" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 1: exit code 2"
assert_file_absent "$SENTINEL" "Case 1: fake runner not executed"

ABS_EXPECTED_PATH1="$(cd "$CASE1_DIR" && pwd)/.claude/review-loop-config.md"

# Assert raw-env fixture values are absent
validate_json_result "$OUT" "precondition_failed" "UNREADY_FAIL_EP" "$ABS_EXPECTED_PATH1" "$RAW_BASE_URL_FIXTURE,$RAW_TOKEN_FIXTURE" "true" "UNREADY_FAIL_EP"

# --- Case 2: Runner failed ---
cleanup_env

# Ready unique endpoint
EP_URL_FIXTURE2="https://api.ready-fail-fixture.org/v1"
EP_TOKEN_FIXTURE2="endpoint-token-secret-fixture-456"
export AUTOPILOT_ENDPOINT_READY_FAIL_EP_URL="$EP_URL_FIXTURE2"
export AUTOPILOT_ENDPOINT_READY_FAIL_EP_TOKEN="$EP_TOKEN_FIXTURE2"

CASE2_DIR="$TEST_TMP/case2"
mkdir -p "$CASE2_DIR/.claude"
EXPECTED_PATH2="$CASE2_DIR/.claude/review-loop-config.md"

cat <<EOF > "$EXPECTED_PATH2"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: READY_FAIL_EP
- implementer_engine: gpt-5.3-codex-spark
EOF

# Fake runner that starts then exits 17
FAKE_RUNNER2="$TEST_TMP/fake-runner-2"
cat <<'EOF' > "$FAKE_RUNNER2"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "started" >> "$RUN_COUNT_FILE"
echo "Failure logs from runner"
exit 17
EOF
chmod +x "$FAKE_RUNNER2"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER2" 2>&1)"; EXIT=$?

assert_eq "3" "$EXIT" "Case 2: exit code 3"
assert_file_exists "$SENTINEL" "Case 2: fake runner executed"

run_count=0
if [ -f "$RUN_COUNT_FILE" ]; then
  run_count=$(wc -l < "$RUN_COUNT_FILE" | tr -d '[:space:]')
fi
assert_eq "1" "$run_count" "Case 2: fake runner started exactly once"

ABS_EXPECTED_PATH2="$(cd "$CASE2_DIR" && pwd)/.claude/review-loop-config.md"

# Assert endpoint URL and token fixture values are absent from the JSON result
validate_json_result "$OUT" "runner_failed" "READY_FAIL_EP" "$ABS_EXPECTED_PATH2" "$EP_URL_FIXTURE2,$EP_TOKEN_FIXTURE2" "false" "runner exited 17"

# --- Case 3: Empty output ---
cleanup_env

# Ready unique endpoint
EP_URL_FIXTURE3="https://api.ready-empty-fixture.org/v1"
EP_TOKEN_FIXTURE3="endpoint-token-secret-fixture-789"
export AUTOPILOT_ENDPOINT_READY_EMPTY_EP_URL="$EP_URL_FIXTURE3"
export AUTOPILOT_ENDPOINT_READY_EMPTY_EP_TOKEN="$EP_TOKEN_FIXTURE3"

CASE3_DIR="$TEST_TMP/case3"
mkdir -p "$CASE3_DIR/.claude"
EXPECTED_PATH3="$CASE3_DIR/.claude/review-loop-config.md"

cat <<EOF > "$EXPECTED_PATH3"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: READY_EMPTY_EP
- implementer_engine: gpt-5.3-codex-spark
EOF

# Fake runner that exits 0 with no output
FAKE_RUNNER3="$TEST_TMP/fake-runner-3"
cat <<'EOF' > "$FAKE_RUNNER3"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "started" >> "$RUN_COUNT_FILE"
exit 0
EOF
chmod +x "$FAKE_RUNNER3"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE3_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER3" 2>&1)"; EXIT=$?

assert_eq "1" "$EXIT" "Case 3: exit code 1"
assert_file_exists "$SENTINEL" "Case 3: fake runner executed"

run_count=0
if [ -f "$RUN_COUNT_FILE" ]; then
  run_count=$(wc -l < "$RUN_COUNT_FILE" | tr -d '[:space:]')
fi
assert_eq "1" "$run_count" "Case 3: fake runner started exactly once"

ABS_EXPECTED_PATH3="$(cd "$CASE3_DIR" && pwd)/.claude/review-loop-config.md"

# Assert endpoint URL and token fixture values are absent from the JSON result
validate_json_result "$OUT" "empty_output" "READY_EMPTY_EP" "$ABS_EXPECTED_PATH3" "$EP_URL_FIXTURE3,$EP_TOKEN_FIXTURE3" "false" "no non-whitespace output from runner"

cleanup_env
finalize_test
