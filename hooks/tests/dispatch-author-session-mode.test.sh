#!/usr/bin/env bash
# hooks/tests/dispatch-author-session-mode.test.sh
# Unit 3 verification oracle: l6 session-mode coupling
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

export SENTINEL="$TEST_TMP/sentinel_touched"
FAKE_RUNNER="$TEST_TMP/fake-runner"
cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "Success from stub runner"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

# Use AUTOPILOT_SESSION_MODE_DIR and a fixed test session id
# so the real user marker is never read or modified.
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export CLAUDE_CODE_SESSION_ID="test-session-l6-spec"

# Case 1: active l6 + legacy explicit
# -> exit 2, semantic strict-roster/l6 diagnostic, full null precondition provenance, runner/log absent;
rm -f "$SENTINEL"
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 1: exit code 2"
assert_file_absent "$SENTINEL" "Case 1: fake runner not executed"

PY_OUT_1="$(python3 -c '
import sys, json
try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"Failed to parse JSON: {e}")
    sys.exit(1)

errors = []
def check_val(key, expected):
    if key not in data:
        errors.append(f"Expected key {key} to be present in data")
        return
    val = data.get(key)
    if val != expected:
        errors.append(f"Expected {key}={expected}, got {val}")

check_val("status", "precondition_failed")
check_val("raw_log", None)
check_val("selection_source", "explicit_cli")
check_val("selection_path", None)
check_val("verification_author", None)

err = data.get("error", "")
if "strict-roster" not in err.lower() and "l6" not in err.lower():
    errors.append(f"Expected error to contain strict-roster/l6 diagnostic, got {err}")

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" 2>&1)"; PY_EXIT_1=$?
assert_eq "0" "$PY_EXIT_1" "Case 1 schema: $PY_OUT_1"


# Case 2: active l6 + valid strict cross-family roster
# -> authored success and fake runner starts once;
CASE2_DIR="$TEST_TMP/case2"
mkdir -p "$CASE2_DIR/.claude"
cat <<EOF > "$CASE2_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: codex
- verification_author_effort: high
- verification_author_endpoint:
- implementer_engine: gpt-5.3-codex-spark
EOF

rm -f "$SENTINEL"
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 2: exit code 0"
assert_file_exists "$SENTINEL" "Case 2: fake runner executed once"


# Case 3: active l5 + legacy explicit -> authored success;
rm -f "$SENTINEL"
node "$REPO_ROOT/scripts/session-mode.js" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 3: exit code 0"
assert_file_exists "$SENTINEL" "Case 3: fake runner executed"


# Case 4: missing marker + legacy explicit -> authored success;
rm -f "$SENTINEL"
node "$REPO_ROOT/scripts/session-mode.js" clear >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 4: exit code 0"
assert_file_exists "$SENTINEL" "Case 4: fake runner executed"


# Case 5: expired l6 marker + legacy explicit -> authored success;
rm -f "$SENTINEL"
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" --ttl-hours 0 >/dev/null 2>&1
sleep 1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 5: exit code 0"
assert_file_exists "$SENTINEL" "Case 5: fake runner executed"


# Case 6: corrupt marker + legacy explicit -> authored success;
rm -f "$SENTINEL"
echo 'not json{{{' > "$AUTOPILOT_SESSION_MODE_DIR/test-session-l6-spec.json"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 6: exit code 0"
assert_file_exists "$SENTINEL" "Case 6: fake runner executed"


# Case 7: corrupt marker + strict mode but missing project roster
# -> exit 2 config/roster failure, runner/log absent and strict provenance (proves invalid marker is not an auth bypass).
rm -f "$SENTINEL"
echo 'not json{{{' > "$AUTOPILOT_SESSION_MODE_DIR/test-session-l6-spec.json"
CASE7_DIR="$TEST_TMP/case7"
mkdir -p "$CASE7_DIR"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE7_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 7: exit code 2"
assert_file_absent "$SENTINEL" "Case 7: fake runner not executed"

PY_OUT_7="$(python3 -c '
import sys, json
try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"Failed to parse JSON: {e}")
    sys.exit(1)

errors = []
def check_val(key, expected):
    if key not in data:
        errors.append(f"Expected key {key} to be present in data")
        return
    val = data.get(key)
    if val != expected:
        errors.append(f"Expected {key}={expected}, got {val}")

check_val("status", "precondition_failed")
check_val("raw_log", None)
check_val("selection_source", "strict_roster")
check_val("selection_path", None)
check_val("verification_author", None)

err = data.get("error", "").lower()
if "config" not in err and "missing" not in err:
    errors.append(f"Expected error to complain about config missing, got {err}")

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" 2>&1)"; PY_EXIT_7=$?
assert_eq "0" "$PY_EXIT_7" "Case 7 schema: $PY_OUT_7"

finalize_test
