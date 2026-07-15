#!/usr/bin/env bash
# hooks/tests/dispatch-author-result-provenance.test.sh
# Unit 2c.i verification oracle: result envelope and authored paths test.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

# Deterministic fake runner
FAKE_RUNNER="$TEST_TMP/fake-runner"
SENTINEL="$TEST_TMP/sentinel_touched"

cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "Success from stub runner"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

# --- Case 1: Legacy authored ---
# Explicit fake runner succeeds.
# Assert exit/status/runner/model remain correct.
# Assert selection_source=explicit_cli, selection_path=null, verification_author=null.
rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 1: exit code 0"
assert_file_exists "$SENTINEL" "Case 1: fake runner executed"

PY_OUT_1="$(python3 -c '
import sys, json
try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"Failed to parse JSON: {e}")
    sys.exit(1)

errors = []
def check_val(key, expected):
    val = data.get(key)
    if val != expected:
        errors.append(f"Expected {key}={expected}, got {val}")

check_val("status", "authored")
check_val("runner", "codex")
check_val("model", "gpt-5.5")
check_val("selection_source", "explicit_cli")
check_val("selection_path", None)
check_val("verification_author", None)

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" 2>&1)"; PY_EXIT_1=$?

assert_eq "0" "$PY_EXIT_1" "Case 1 schema: $PY_OUT_1"


# --- Case 2: Early strict rejection ---
# Manually supplied model with --strict-roster is rejected before roster resolution.
# Assert exit 2/status precondition_failed/raw_log null.
# Assert selection_source=strict_roster, selection_path=null, verification_author=null.
# Assert fake runner absent.
rm -f "$SENTINEL"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --model "GPT-OSS 120B (Medium)" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 2: exit code 2"
assert_file_absent "$SENTINEL" "Case 2: fake runner not executed"

PY_OUT_2="$(python3 -c '
import sys, json
try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"Failed to parse JSON: {e}")
    sys.exit(1)

errors = []
def check_val(key, expected):
    val = data.get(key)
    if val != expected:
        errors.append(f"Expected {key}={expected}, got {val}")

check_val("status", "precondition_failed")
check_val("raw_log", None)
check_val("selection_source", "strict_roster")
check_val("selection_path", None)
check_val("verification_author", None)

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" 2>&1)"; PY_EXIT_2=$?

assert_eq "0" "$PY_EXIT_2" "Case 2 schema: $PY_OUT_2"


# --- Case 3: Strict authored ---
# Exact GLM/cc-shim/high/named-endpoint roster reaches a fake runner.
# Assert exit 0/status authored.
# Assert selection_source=strict_roster, canonical absolute selection path.
# Assert exact verification-author object values.
# Assert the endpoint URL and token fixture values do not occur anywhere in result JSON.
rm -f "$SENTINEL"

CASE3_DIR="$TEST_TMP/case3"
mkdir -p "$CASE3_DIR/.claude"
EXPECTED_PATH="$CASE3_DIR/.claude/review-loop-config.md"

cat <<EOF > "$EXPECTED_PATH"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: MY_UNIQUE_EP
- implementer_engine: gpt-5.3-codex-spark
EOF

ENDPOINT_URL_FIXTURE="https://api.unique-endpoint-fixture.xyz/v1"
ENDPOINT_TOKEN_FIXTURE="secret-token-fixture-xyz-987654321"

export AUTOPILOT_ENDPOINT_MY_UNIQUE_EP_URL="$ENDPOINT_URL_FIXTURE"
export AUTOPILOT_ENDPOINT_MY_UNIQUE_EP_TOKEN="$ENDPOINT_TOKEN_FIXTURE"

# Ensure clean state for cc-shim run variables
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_AUTH_TOKEN

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE3_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

# Cleanup env immediately
unset AUTOPILOT_ENDPOINT_MY_UNIQUE_EP_URL
unset AUTOPILOT_ENDPOINT_MY_UNIQUE_EP_TOKEN
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_AUTH_TOKEN

assert_eq "0" "$EXIT" "Case 3: exit code 0"
assert_file_exists "$SENTINEL" "Case 3: fake runner executed"

# Resolve absolute path for verification
ABS_EXPECTED_PATH="$(cd "$CASE3_DIR" && pwd)/.claude/review-loop-config.md"

PY_OUT_3="$(python3 -c '
import sys, json
try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"Failed to parse JSON: {e}")
    sys.exit(1)

errors = []
def check_val(key, expected):
    val = data.get(key)
    if val != expected:
        errors.append(f"Expected {key}={expected}, got {val}")

check_val("status", "authored")
check_val("selection_source", "strict_roster")
check_val("selection_path", sys.argv[2])

va = data.get("verification_author")
if not isinstance(va, dict):
    errors.append(f"Expected verification_author to be dict, got {type(va)}")
else:
    expected_keys = {"engine", "runner", "effort", "endpoint", "family"}
    actual_keys = set(va.keys())
    if actual_keys != expected_keys:
        errors.append(f"Expected verification_author keys {expected_keys}, got {actual_keys}")
    
    def check_va_val(key, expected):
        val = va.get(key)
        if val != expected:
            errors.append(f"Expected verification_author.{key}={expected}, got {val}")
            
    check_va_val("engine", "glm-5.2")
    check_va_val("runner", "cc-shim")
    check_va_val("effort", "high")
    check_va_val("endpoint", "MY_UNIQUE_EP")
    check_va_val("family", "zhipu")

url_fixture = sys.argv[3]
token_fixture = sys.argv[4]
raw_json = sys.argv[1]

if url_fixture in raw_json:
    errors.append(f"Endpoint URL fixture {url_fixture} found in result JSON")
if token_fixture in raw_json:
    errors.append(f"Endpoint Token fixture {token_fixture} found in result JSON")

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" "$ABS_EXPECTED_PATH" "$ENDPOINT_URL_FIXTURE" "$ENDPOINT_TOKEN_FIXTURE" 2>&1)"; PY_EXIT_3=$?

assert_eq "0" "$PY_EXIT_3" "Case 3 schema: $PY_OUT_3"

finalize_test
