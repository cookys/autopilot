#!/usr/bin/env bash
# dispatch-explore.sh integration test — exercises the read-probe sentinel contract
# using a PATH-stubbed fake LLM engine (no network, no live LLM).
. "$(dirname "$0")/lib.sh"
export TMPDIR="$TEST_TMP"

SCRIPT="$REPO_ROOT/scripts/dispatch-explore.sh"

# --- sandbox git repo ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT_FILE="$TEST_TMP/prompt.txt"
echo "Read the repository and explain what it does." > "$PROMPT_FILE"

# --- stub engine ---
STUB_EXPLORE="$TEST_TMP/stub-explore"
cat > "$STUB_EXPLORE" <<'EOF'
#!/usr/bin/env bash
read_prompt_arg() {
  local prompt=""
  local i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      if [ -n "$next_arg" ] && [ -f "$next_arg" ]; then
        prompt="$(cat "$next_arg")"
      else
        prompt="$next_arg"
      fi
      break
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}

PROMPT="$(read_prompt_arg "$@")"
MODE="${STUB_MODE:-pass}"

# Extract sentinel path
SENTINEL_PATH=""
if [ -n "$PROMPT" ]; then
  SENTINEL_PATH=$(printf '%s' "$PROMPT" | tr ' ' '\n' | grep '\.autopilot-read-probe\.' | head -n 1)
fi

TOKEN=""
if [ -n "$SENTINEL_PATH" ] && [ -r "$SENTINEL_PATH" ]; then
  TOKEN=$(cat "$SENTINEL_PATH" 2>/dev/null)
fi

case "$MODE" in
  pass)
    if [ -n "$TOKEN" ]; then
      echo "READ-PROBE: $TOKEN"
    else
      echo "READ-PROBE: FAILED"
    fi
    echo "This is the confident answer body for pass."
    ;;
  fail_no_probe)
    echo "This is the confident answer body but no probe line."
    ;;
  fail_wrong_token)
    echo "READ-PROBE: WRONGTOKEN"
    echo "This is the confident answer body with wrong token."
    ;;
  dirty)
    if [ -n "$TOKEN" ]; then
      echo "READ-PROBE: $TOKEN"
    else
      echo "READ-PROBE: FAILED"
    fi
    echo "This is the answer body."
    # Violate write-intent: create a new file in the repo
    touch dirty_file.txt
    ;;
  no_probe)
    echo "This is the confident answer body."
    ;;
esac
EOF
chmod +x "$STUB_EXPLORE"

# 1. Probe pass: stub actually reads sentinel and echoes it
# Expected: exit 0, status "explored", read_probe "ok", answer present in raw_log
OUT="$(cd "$SBX" && STUB_MODE=pass "$SCRIPT" --runner codex --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "probe pass exit code"
assert_contains "$OUT" '"status": "explored"' "probe pass status"
assert_contains "$OUT" '"read_probe": "ok"' "probe pass read_probe status"
assert_contains "$OUT" '"repo_modified": false' "probe pass repo_modified"
RAW_LOG_PATH="$(printf '%s' "$OUT" | sed -n 's/.*"raw_log"[[:space:]]*:[[:space:]]*"\([^\"]*\)".*/\1/p')"
assert_file_exists "$RAW_LOG_PATH" "raw_log exists for probe pass"
assert_contains "$(cat "$RAW_LOG_PATH")" "This is the confident answer body for pass." "answer present in raw_log"

# Cleanliness check: repo should be clean after the run (sentinel cleaned up)
assert_eq "" "$(git -C "$SBX" status --porcelain)" "repo clean after probe pass"

# 2. Probe fail (guessing engine): stub outputs confident answer but no probe line
# Expected: exit 3, status "read_failed", read_probe "failed", JSON must NOT contain answer body
OUT="$(cd "$SBX" && STUB_MODE=fail_no_probe "$SCRIPT" --runner codex --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" 2>&1)"
EXIT=$?
assert_eq "3" "$EXIT" "probe fail exit code"
assert_contains "$OUT" '"status": "read_failed"' "probe fail status"
assert_contains "$OUT" '"read_probe": "failed"' "probe fail read_probe status"
assert_not_contains "$OUT" "confident answer body" "JSON does not contain the withheld answer body"

# Cleanliness check: repo should be clean after the run
assert_eq "" "$(git -C "$SBX" status --porcelain)" "repo clean after probe fail"

# 2b. Probe fail with wrong token
OUT="$(cd "$SBX" && STUB_MODE=fail_wrong_token "$SCRIPT" --runner codex --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" 2>&1)"
EXIT=$?
assert_eq "3" "$EXIT" "wrong token exit code"
assert_contains "$OUT" '"status": "read_failed"' "wrong token status"

# 3. Dirty repo (write-intent violation)
# Expected: exit 4, status "explored_dirty", repo_modified true
OUT="$(cd "$SBX" && STUB_MODE=dirty "$SCRIPT" --runner codex --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" 2>&1)"
EXIT=$?
assert_eq "4" "$EXIT" "dirty repo exit code"
assert_contains "$OUT" '"status": "explored_dirty"' "dirty repo status"
assert_contains "$OUT" '"repo_modified": true' "dirty repo modified flag"
assert_file_exists "$SBX/dirty_file.txt" "dirty file exists in repo"
# Clean up dirty file so subsequent tests are clean
rm -f "$SBX/dirty_file.txt"
assert_eq "" "$(git -C "$SBX" status --porcelain)" "repo clean after manual dirty file cleanup"

# 4. --no-probe smoke path (uses agy runner if script is available)
if command -v script >/dev/null 2>&1; then
  OUT="$(cd "$SBX" && STUB_MODE=no_probe "$SCRIPT" --runner agy --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" --no-probe 2>&1)"
  EXIT=$?
  assert_eq "0" "$EXIT" "--no-probe exit code"
  assert_contains "$OUT" '"status": "explored"' "--no-probe status"
  assert_contains "$OUT" '"read_probe": "skipped"' "--no-probe read_probe skipped"
  assert_contains "$OUT" '"runner": "agy"' "--no-probe runner agy"
else
  # fallback to codex if script not available
  OUT="$(cd "$SBX" && STUB_MODE=no_probe "$SCRIPT" --runner codex --model x --prompt-file "$PROMPT_FILE" --bin "$STUB_EXPLORE" --no-probe 2>&1)"
  EXIT=$?
  assert_eq "0" "$EXIT" "--no-probe fallback exit code"
  assert_contains "$OUT" '"status": "explored"' "--no-probe fallback status"
  assert_contains "$OUT" '"read_probe": "skipped"' "--no-probe fallback read_probe skipped"
fi

# 5. Precondition: missing/unreadable --prompt-file
# Expected: exit 2, status "precondition_failed"
OUT="$(cd "$SBX" && "$SCRIPT" --runner codex --model x --prompt-file "$TEST_TMP/nonexistent.txt" --bin "$STUB_EXPLORE" 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "precondition fail exit code"
assert_contains "$OUT" '"status": "precondition_failed"' "precondition fail status"

# 6. Cleanliness check of the test tmp directory and git status
assert_eq "" "$(git -C "$SBX" status --porcelain)" "final repo git status is clean"

finalize_test
