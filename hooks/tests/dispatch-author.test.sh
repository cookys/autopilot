#!/usr/bin/env bash
# dispatch-author — raw authoring dispatch smoke tests (local engines only, no network).
# Covers: exact prompt forwarding, empty-output fail-closed, output parseability,
# and precondition failures on missing CLI args / missing env constraints.
. "$(dirname "$0")/lib.sh"

# Isolate from ambient session markers
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session_isolation"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan for the change and include exactly three bullet items." > "$PROMPT"

# --- 1. codex — raw prompt bytes preserved; no review-template leakage ---
RECEIVED="$TEST_TMP/prompt.received.codex"
STUB_COD="$TEST_TMP/runner-codex"
cat > "$STUB_COD" <<EOF
#!/usr/bin/env bash
cat > "$RECEIVED"
echo "OK-WRITTEN"
EOF
chmod +x "$STUB_COD"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_COD" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex authored exit 0"
assert_file_exists "$RECEIVED" "codex stub received prompt body"
cmp -s "$PROMPT" "$RECEIVED"
assert_eq "0" "$?" "codex receives exact prompt bytes"
assert_contains "$OUT" '"status": "authored"' "codex status authored"
assert_not_contains "$OUT" "You are a code reviewer" "codex prompt is not reviewer-wrapped"
assert_not_contains "$OUT" "Diff under review" "codex prompt is not diff-wrapper"

# --- 2. empty output → empty_output, exit 1, fail-closed ---
STUB_EMPTY="$TEST_TMP/runner-empty"
cat > "$STUB_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_EMPTY"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "empty output exits 1"
assert_contains "$OUT" '"status": "empty_output"' "empty output mapped to empty_output"
assert_not_contains "$OUT" '"status": "precondition_failed"' "empty output is not precondition_failed"

# --- 2.1: runner non-zero with output → runner_failed, exit 3 ---
STUB_PARTIAL_FAIL="$TEST_TMP/runner-codex-partial-fail"
cat > "$STUB_PARTIAL_FAIL" <<'EOF'
#!/usr/bin/env bash
echo "partial-output"
exit 42
EOF
chmod +x "$STUB_PARTIAL_FAIL"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_PARTIAL_FAIL" 2>&1)"; EXIT=$?
assert_eq "3" "$EXIT" "partial output with non-zero runner exits 3"
assert_contains "$OUT" '"status": "runner_failed"' "non-zero runner maps to runner_failed"
assert_contains "$OUT" '"error": "runner exited 42"' "runner_failed includes exit code"
RUNNER_RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RUNNER_RAW_LOG_PATH" "runner_failed raw_log exists"
assert_contains "$(cat "$RUNNER_RAW_LOG_PATH")" "partial-output" "runner_failed raw_log retains partial output"

# --- 3. normal output JSON parseable + raw_log path exists ---
STUB_OK="$TEST_TMP/runner-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "Authoring result for ${MODEL}."
EOF
chmod +x "$STUB_OK"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "normal output exits 0"
assert_contains "$OUT" '"status": "authored"' "normal output returns authored status"
python3 -c 'import json,sys; json.load(sys.stdin)' <<<"$OUT"
assert_eq "0" "$?" "author output is valid JSON"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_not_contains "$RAW_LOG_PATH" '$' "raw_log path extracted cleanly"
if [ -n "$RAW_LOG_PATH" ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "raw_log path is absent"
fi

# --- 4. precondition: missing runner ---
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --model gpt-5.5 --prompt-file "$PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --runner exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing --runner => precondition_failed"
assert_contains "$OUT" "--runner is required" "missing --runner message"

# --- 5. precondition: missing binary ---
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$TEST_TMP/no-bin" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing runner binary exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing binary => precondition_failed"
assert_not_contains "$OUT" "authored" "missing binary does not report authored"

# --- 6. precondition: cc-shim env preconditions ---
STUB_NOENV="$TEST_TMP/runner-ccshim"
cat > "$STUB_NOENV" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "ccshim out"
EOF
chmod +x "$STUB_NOENV"
OUT="$(unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_NOENV" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing cc-shim env exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "cc-shim env missing => precondition_failed"
assert_not_contains "$OUT" '"status": "authored"' "cc-shim missing env not authored"

# --- 7. optional: agy path can run when script(1) exists and prompt is still raw ---
if command -v script >/dev/null 2>&1; then
  AGY_DUMP="$TEST_TMP/prompt.received.agy"
  STUB_AGY_OK="$TEST_TMP/runner-agy-ok"
  cat > "$STUB_AGY_OK" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-p" ]; then
  printf '%s' "\$2" > "$AGY_DUMP"
fi
echo "ok from agy"
EOF
  chmod +x "$STUB_AGY_OK"
  STUB_BIN_DIR="$TEST_TMP/fake-bin"
  mkdir -p "$STUB_BIN_DIR"
  ln -sf "$STUB_AGY_OK" "$STUB_BIN_DIR/agy"
  ORIGINAL_PATH="$PATH"
  PATH="$STUB_BIN_DIR:$PATH"

  # Keep a shadow copy for AGY_CWD temp command assertions.
  OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  PATH="$ORIGINAL_PATH"
  assert_eq "0" "$EXIT" "agy path with script wrapper exits 0"
  assert_file_exists "$AGY_DUMP" "agy stub received prompt text"
  cmp -s "$PROMPT" "$AGY_DUMP"
  assert_eq "0" "$?" "agy uses exact prompt bytes"
  assert_contains "$OUT" '"status": "authored"' "agy path returns authored"
  AGY_RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
  assert_file_exists "$AGY_RAW_LOG_PATH" "agy path raw_log exists"
  assert_contains "$(cat "$AGY_RAW_LOG_PATH")" "ok from agy" "agy raw_log contains stub output"

  STUB_AGY_FAIL="$TEST_TMP/runner-agy-fail"
  cat > "$STUB_AGY_FAIL" <<'EOF'
#!/usr/bin/env bash
echo "partial from agy"
exit 7
EOF
  chmod +x "$STUB_AGY_FAIL"
  ln -sf "$STUB_AGY_FAIL" "$STUB_BIN_DIR/agy"
  PATH="$STUB_BIN_DIR:$PATH"
  OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  assert_eq "3" "$EXIT" "agy non-zero runner exits 3"
  assert_contains "$OUT" '"status": "runner_failed"' "agy non-zero maps to runner_failed"
  assert_contains "$OUT" '"error": "runner exited 7"' "agy runner_failed includes exit code"

  # --- 7.2: agy empty-output path should fail-closed (exit 1) ---
  STUB_AGY_EMPTY="$TEST_TMP/runner-agy-empty"
  cat > "$STUB_AGY_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$STUB_AGY_EMPTY"
  ln -sf "$STUB_AGY_EMPTY" "$STUB_BIN_DIR/agy"
  PATH="$STUB_BIN_DIR:$PATH"
  OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  assert_eq "1" "$EXIT" "agy empty-output exit 1"
  assert_contains "$OUT" '"status": "empty_output"' "agy empty-output maps to empty_output"
  assert_not_contains "$OUT" '"status": "authored"' "agy empty-output is not authored"
fi

# Regression Test 4: grok late-flush stub
STUB_GROK_LATE_FLUSH="$TEST_TMP/runner-grok-late-flush"
cat > "$STUB_GROK_LATE_FLUSH" <<'EOF'
#!/usr/bin/env bash
( sleep 1; echo "the answer" ) &
exit 0
EOF
chmod +x "$STUB_GROK_LATE_FLUSH"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_GROK_LATE_FLUSH" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "grok late-flush exits 0"
assert_contains "$OUT" '"status": "authored"' "grok late-flush returns authored status"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "grok late-flush raw_log exists"
assert_contains "$(cat "$RAW_LOG_PATH")" "the answer" "grok raw_log contains late-flushed output"

# Regression Test 5: grok truly-empty stub
STUB_GROK_EMPTY="$TEST_TMP/runner-grok-empty"
cat > "$STUB_GROK_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_GROK_EMPTY"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_GROK_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "grok truly-empty exits 1"
assert_contains "$OUT" '"status": "empty_output"' "grok truly-empty maps to empty_output"

# --- 8. --endpoint flag parity ---
# Configure a fake endpoint via environment variables
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9999/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="fake-token-value-12345"

STUB_CC_ENV_DUMP="$TEST_TMP/runner-cc-env-dump"
cat > "$STUB_CC_ENV_DUMP" <<'EOF'
#!/usr/bin/env bash
echo "BASE:$ANTHROPIC_BASE_URL"
echo "TOKEN:$ANTHROPIC_AUTH_TOKEN"
# We must output something so it is not treated as empty_output
echo "dummy response"
exit 0
EOF
chmod +x "$STUB_CC_ENV_DUMP"

# Run cc-shim with --endpoint TESTEP
OUT="$(unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_ENV_DUMP" --endpoint TESTEP 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "cc-shim with resolved --endpoint exits 0"
assert_contains "$OUT" '"status": "authored"' "cc-shim resolved endpoint reports authored"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "cc-shim raw_log exists"
assert_contains "$(cat "$RAW_LOG_PATH")" "BASE:http://127.0.0.1:9999/v1" "cc-shim stub received ANTHROPIC_BASE_URL"
assert_contains "$(cat "$RAW_LOG_PATH")" "TOKEN:fake-token-value-12345" "cc-shim stub received ANTHROPIC_AUTH_TOKEN"

# Unknown endpoint name -> precondition_failed exit 2
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_ENV_DUMP" --endpoint UNKNOWN_EP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "unknown --endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "unknown endpoint reports precondition_failed"

# Non-cc-shim with --endpoint -> precondition_failed exit 2
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_COD" --endpoint TESTEP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "non-cc-shim with --endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "non-cc-shim endpoint reports precondition_failed"
assert_contains "$OUT" "--endpoint applies only to --runner anthropic-compatible or cc-shim" "correct runner restriction error message"

# --- 8b. anthropic-compatible seam + endpoint gate behavior ---
STUB_ANTHRO_JS="$TEST_TMP/runner-anthropic-compatible-ok.js"
cat > "$STUB_ANTHRO_JS" <<'EOF'
#!/usr/bin/env node
process.stdout.write("authoring body line 1\nauthoring body line 2");
EOF
chmod +x "$STUB_ANTHRO_JS"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_JS" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible with fake-js exits 0"
assert_contains "$OUT" '"status": "authored"' "anthropic-compatible reports authored"
ANTHRO_RAW_LOG_PATH="$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("raw_log", ""))' <<<"$OUT")"
ANTHRO_EXPECT=$'authoring body line 1\nauthoring body line 2'
assert_eq "$ANTHRO_EXPECT" "$(cat "$ANTHRO_RAW_LOG_PATH")" "anthropic-compatible fake body is written to raw_log"

STUB_ANTHRO_FAIL_JS="$TEST_TMP/runner-anthropic-compatible-fail.js"
cat > "$STUB_ANTHRO_FAIL_JS" <<'EOF'
#!/usr/bin/env node
process.exit(7);
EOF
chmod +x "$STUB_ANTHRO_FAIL_JS"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_FAIL_JS" 2>&1)"
EXIT=$?
assert_eq "3" "$EXIT" "anthropic-compatible non-zero fake-js exits 3"
assert_contains "$OUT" '"status": "runner_failed"' "anthropic-compatible non-zero maps to runner_failed"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_JS" --endpoint UNKNOWN_EP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible unknown endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible unknown endpoint precondition failed"
assert_not_contains "$OUT" "--endpoint applies only to --runner cc-shim" "anthropic-compatible endpoint gate no longer cc-shim-only"
assert_contains "$OUT" "--endpoint 'UNKNOWN_EP' not ready" "anthropic-compatible endpoint resolution reports not-ready"

# --- 9. late-flush and per-runner settle bound under cc-shim ---
STUB_CC_LATE_FLUSH="$TEST_TMP/runner-cc-late-flush"
cat > "$STUB_CC_LATE_FLUSH" <<'EOF'
#!/usr/bin/env bash
( sleep 5; echo "late response" ) &
exit 0
EOF
chmod +x "$STUB_CC_LATE_FLUSH"

# With default 10s wait for cc-shim, a 5s late flush should be caught and status should be authored
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake"; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_LATE_FLUSH" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "cc-shim 5s late-flush exits 0 with 10s settle default"
assert_contains "$OUT" '"status": "authored"' "cc-shim 5s late-flush is authored"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_contains "$(cat "$RAW_LOG_PATH")" "late response" "cc-shim raw_log contains late response"

# Truly-empty cc-shim -> empty_output, exit 1
STUB_CC_EMPTY="$TEST_TMP/runner-cc-empty"
cat > "$STUB_CC_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_CC_EMPTY"

OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake"; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_EMPTY" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "cc-shim truly-empty exits 1"
assert_contains "$OUT" '"status": "empty_output"' "cc-shim truly-empty is empty_output"

# AUTOPILOT_SETTLE_MS=500 shortens the wait, so the 5s late flush is not caught -> empty_output, exit 1
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake" AUTOPILOT_SETTLE_MS=500; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_LATE_FLUSH" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "cc-shim 5s late-flush with 500ms settle exits 1 (fails to capture)"
assert_contains "$OUT" '"status": "empty_output"' "cc-shim 5s late-flush with 500ms settle is empty_output"

# Malformed AUTOPILOT_SETTLE_MS exits 2
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake" AUTOPILOT_SETTLE_MS=abc; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_EMPTY" 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "malformed AUTOPILOT_SETTLE_MS exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "malformed AUTOPILOT_SETTLE_MS reports precondition_failed"

finalize_test
