#!/usr/bin/env bash
# hooks/tests/dispatch-author-session-mode.test.sh
# Unit 3 verification oracle: l6 session-mode coupling
. "$(dirname "$0")/lib.sh"

SOURCE_ROOT="$REPO_ROOT"
git clone -q --no-local "$SOURCE_ROOT" "$TEST_TMP/hermetic-repo"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$TEST_TMP/hermetic-repo" apply
REPO_ROOT="$TEST_TMP/hermetic-repo"
cd "$REPO_ROOT"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

export SENTINEL="$TEST_TMP/sentinel_touched"
export RUN_COUNT_FILE="$TEST_TMP/run_count"
FAKE_RUNNER="$TEST_TMP/fake-runner"
cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2

sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done

touch "$SENTINEL"
if [ -n "$RUN_COUNT_FILE" ]; then
  echo "1" >> "$RUN_COUNT_FILE"
fi
msg="Success from stub runner"
if [ -n "$sidecar" ]; then
  printf '%s\n' "$msg" > "$sidecar"
fi
printf '%s\n' "$msg"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

# Use AUTOPILOT_SESSION_MODE_DIR and a fixed test session id
# so the real user marker is never read or modified.
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export CLAUDE_CODE_SESSION_ID="test-session-l6-spec"
# The fixture exercises session-mode coupling, not enforced Mission admission.
# Keep routing in SHADOW while persisting the real marker in this clone's own
# hermetic Git/session authority directories.
export AUTOPILOT_MISSION_ROUTING_MODE=SHADOW

reset_run_count() {
  rm -f "$RUN_COUNT_FILE"
  rm -f "$SENTINEL"
}

assert_run_count() {
  local expected="$1"
  local case_name="$2"
  local count=0
  if [ -f "$RUN_COUNT_FILE" ]; then
    count=$(wc -l < "$RUN_COUNT_FILE" | tr -d '[:space:]')
  fi
  assert_eq "$count" "$expected" "$case_name: run count"
}

assert_status_authored() {
  local out="$1"
  local case_name="$2"
  local status
  status="$(python3 -c 'import sys, json; print(json.loads(sys.argv[1]).get("status", ""))' "$out" 2>/dev/null)"
  assert_eq "$status" "authored" "$case_name: status is authored"
}

assert_status_precondition_failed() {
  local out="$1"
  local case_name="$2"
  local status
  status="$(python3 -c 'import sys, json; print(json.loads(sys.argv[1]).get("status", ""))' "$out" 2>/dev/null)"
  assert_eq "$status" "precondition_failed" "$case_name: status is precondition_failed"
}

# Case 1: active l6 + legacy explicit
# -> exit 2, active non-strict session-mode diagnostic, full null precondition provenance, runner/log absent;
reset_run_count
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 1: exit code 2"
assert_file_absent "$SENTINEL" "Case 1: fake runner not executed"
assert_run_count "0" "Case 1"

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

err = data.get("error")
if err is None:
    errors.append("Expected error to be present, got null/absent")
elif not isinstance(err, str):
    errors.append(f"Expected error to be a string, got {type(err).__name__}")
else:
    err_lower = err.lower()
    if "active session-mode=l6" not in err_lower or "non-strict dispatch" not in err_lower:
        errors.append(f"Expected active session-mode=l6 blocks non-strict dispatch diagnostic, got {err}")

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

reset_run_count
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 2: exit code 0"
assert_file_exists "$SENTINEL" "Case 2: fake runner executed once"
assert_run_count "1" "Case 2"
assert_status_authored "$OUT" "Case 2"


# Case 3: active l5 + strict-roster -> precondition gate; only --strict-contract can pass
reset_run_count
node "$REPO_ROOT/scripts/session-mode.js" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$REPO_ROOT" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 3: exit code 2"
assert_file_absent "$SENTINEL" "Case 3: fake runner not executed"
assert_run_count "0" "Case 3"
assert_status_precondition_failed "$OUT" "Case 3"

PY_OUT_3="$(python3 -c '
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

check_val("raw_log", None)
check_val("selection_source", "strict_roster")
check_val("selection_path", None)
check_val("verification_author", None)

err = data.get("error", "").lower()
if "active session-mode=l5" not in err or "non-strict dispatch" not in err:
    errors.append(f"Expected active session-mode=l5 blocks non-strict dispatch diagnostic, got {err}")

if errors:
    print("; ".join(errors))
    sys.exit(1)
' "$OUT" 2>&1)"; PY_EXIT_3=$?
assert_eq "0" "$PY_EXIT_3" "Case 3 schema: $PY_OUT_3"


# Case 4: missing marker + legacy explicit -> authored success;
# L5/L6 clear is closeout-gated; for a pure "no marker" fixture remove the file.
reset_run_count
rm -f "$AUTOPILOT_SESSION_MODE_DIR/${CLAUDE_CODE_SESSION_ID}.json"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 4: exit code 0"
assert_file_exists "$SENTINEL" "Case 4: fake runner executed"
assert_run_count "1" "Case 4"
assert_status_authored "$OUT" "Case 4"


# Case 5: expired l6 marker + legacy explicit -> authored success;
reset_run_count
node "$REPO_ROOT/scripts/session-mode.js" set --level l6 --repo-root "$REPO_ROOT" --ttl-hours 0 >/dev/null 2>&1
sleep 1
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 5: exit code 0"
assert_file_exists "$SENTINEL" "Case 5: fake runner executed"
assert_run_count "1" "Case 5"
assert_status_authored "$OUT" "Case 5"


# Case 6: corrupt marker + legacy explicit -> authored success;
reset_run_count
echo 'not json{{{' > "$AUTOPILOT_SESSION_MODE_DIR/test-session-l6-spec.json"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "0" "$EXIT" "Case 6: exit code 0"
assert_file_exists "$SENTINEL" "Case 6: fake runner executed"
assert_run_count "1" "Case 6"
assert_status_authored "$OUT" "Case 6"


# Case 7: corrupt marker + strict mode but missing project roster
# -> exit 2 config/roster failure, runner/log absent and strict provenance (proves invalid marker is not an auth bypass).
reset_run_count
echo 'not json{{{' > "$AUTOPILOT_SESSION_MODE_DIR/test-session-l6-spec.json"
CASE7_DIR="$TEST_TMP/case7"
mkdir -p "$CASE7_DIR"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE7_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

assert_eq "2" "$EXIT" "Case 7: exit code 2"
assert_file_absent "$SENTINEL" "Case 7: fake runner not executed"
assert_run_count "0" "Case 7"

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
