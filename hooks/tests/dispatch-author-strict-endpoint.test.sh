#!/usr/bin/env bash
# dispatch-author-strict-endpoint — strict endpoint dispatch test.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan." > "$PROMPT"

# Set up common variables
export SENTINEL="$TEST_TMP/sentinel_touched"
export RUN_COUNT_FILE="$TEST_TMP/run_count"
export RECORDED_ARGV="$TEST_TMP/recorded_argv"
export RECORDED_ENV="$TEST_TMP/recorded_env"

FAKE_RUNNER="$TEST_TMP/fake-runner"
cat <<'EOF' > "$FAKE_RUNNER"
#!/usr/bin/env bash
touch "$SENTINEL"
echo "started" >> "$RUN_COUNT_FILE"
echo "$@" > "$RECORDED_ARGV"
printf '%s\n' "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL" "ANTHROPIC_AUTH_TOKEN=$ANTHROPIC_AUTH_TOKEN" > "$RECORDED_ENV"
echo "OK-WRITTEN"
exit 0
EOF
chmod +x "$FAKE_RUNNER"

# Helper to assert preconditions are failed
assert_precondition_failed() {
  local out="$1"
  local exit_code="$2"
  local error_needle="$3"
  local desc="$4"

  assert_eq "2" "$exit_code" "$desc: exit code 2"
  assert_contains "$out" '"status": "precondition_failed"' "$desc: status precondition_failed"
  assert_contains "$out" '"raw_log": null' "$desc: raw_log null"
  assert_contains "$out" "$error_needle" "$desc: semantic diagnostic contains '$error_needle'"

  assert_file_absent "$SENTINEL" "$desc: fake-runner sentinel was never created"
  rm -f "$SENTINEL"
}

# Clean environment
cleanup_env() {
  unset AUTOPILOT_ENDPOINT_UNIT2B_EP_OK_URL
  unset AUTOPILOT_ENDPOINT_UNIT2B_EP_OK_TOKEN
  unset AUTOPILOT_ENDPOINT_UNIT2B_EP_UNREADY_URL
  unset AUTOPILOT_ENDPOINT_UNIT2B_EP_UNREADY_TOKEN
  unset AUTOPILOT_ENDPOINT_SOME_OTHER_EP_URL
  unset AUTOPILOT_ENDPOINT_SOME_OTHER_EP_TOKEN
  unset ANTHROPIC_BASE_URL
  unset ANTHROPIC_AUTH_TOKEN
  rm -f "$SENTINEL" "$RUN_COUNT_FILE" "$RECORDED_ARGV" "$RECORDED_ENV"
}

# ==============================================================================
# Case 1: Authorized exact path
# ==============================================================================
cleanup_env

# Configure endpoint variables for UNIT2B_EP_OK
export AUTOPILOT_ENDPOINT_UNIT2B_EP_OK_URL="https://api.custom-endpoint.org"
export AUTOPILOT_ENDPOINT_UNIT2B_EP_OK_TOKEN="secret-token-value-here"

CASE1_DIR="$TEST_TMP/case_ok"
mkdir -p "$CASE1_DIR/.claude"
cat <<EOF > "$CASE1_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: UNIT2B_EP_OK
- implementer_engine: gpt-5.3-codex-spark
EOF

# Invoke dispatch-author.sh under strict roster mode
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE1_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

# Assert dispatch exit 0
assert_eq "0" "$EXIT" "Case 1: exit code 0"

# Assert status=authored
assert_contains "$OUT" '"status": "authored"' "Case 1: status should be authored"

# Assert exact runner/model
assert_contains "$OUT" '"runner": "cc-shim"' "Case 1: runner should be cc-shim"
assert_contains "$OUT" '"model": "glm-5.2"' "Case 1: model should be glm-5.2"

# Assert fake runner started exactly once
assert_file_exists "$SENTINEL" "Case 1: sentinel file exists"
run_count=0
if [ -f "$RUN_COUNT_FILE" ]; then
  run_count=$(wc -l < "$RUN_COUNT_FILE" | tr -d '[:space:]')
fi
assert_eq "1" "$run_count" "Case 1: fake runner started exactly once"

# Assert the FULL cc-shim argv shape, not just that --model was present somewhere.
# --model-only coverage would pass even if --setting-sources/--strict-mcp-config/--tools
# were silently dropped (the surface-reduction posture dispatch-author.sh:1051-1055
# documents as mirroring dispatch-review.sh's blast-radius controls) — that regression
# must fail this test. Exact pin, in order: -p --model <model> --setting-sources project
# --strict-mcp-config --tools "" (empty --tools value, per the bash -c template at
# scripts/dispatch-author.sh's cc-shim branch).
argv_content=""
if [ -f "$RECORDED_ARGV" ]; then
  argv_content=$(cat "$RECORDED_ARGV")
fi
assert_eq "-p --model glm-5.2 --setting-sources project --strict-mcp-config --tools " \
  "$argv_content" "Case 1: full cc-shim argv shape reached fake process (not just --model)"

# Assert endpoint-derived ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN reached the fake process
recorded_url=""
recorded_token=""
if [ -f "$RECORDED_ENV" ]; then
  recorded_url=$(sed -n '1p' "$RECORDED_ENV")
  recorded_token=$(sed -n '2p' "$RECORDED_ENV")
fi
assert_eq "ANTHROPIC_BASE_URL=https://api.custom-endpoint.org" "$recorded_url" "Case 1: ANTHROPIC_BASE_URL correct"
assert_eq "ANTHROPIC_AUTH_TOKEN=secret-token-value-here" "$recorded_token" "Case 1: ANTHROPIC_AUTH_TOKEN correct"


# ==============================================================================
# Case 2: Unready endpoint, no fallback
# ==============================================================================
cleanup_env

# Configure unrelated ready named endpoint
export AUTOPILOT_ENDPOINT_SOME_OTHER_EP_URL="https://api.some-other.org"
export AUTOPILOT_ENDPOINT_SOME_OTHER_EP_TOKEN="some-other-token"

# Deliberately provide usable raw ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN
export ANTHROPIC_BASE_URL="https://api.raw-fallback.org"
export ANTHROPIC_AUTH_TOKEN="raw-fallback-token"

# Leave UNIT2B_EP_UNREADY variables unset

CASE2_DIR="$TEST_TMP/case_unready"
mkdir -p "$CASE2_DIR/.claude"
cat <<EOF > "$CASE2_DIR/.claude/review-loop-config.md"
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint: UNIT2B_EP_UNREADY
- implementer_engine: gpt-5.3-codex-spark
EOF

# Invoke dispatch-author.sh under strict roster mode
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --strict-roster --repo-root "$CASE2_DIR" --prompt-file "$PROMPT" --bin "$FAKE_RUNNER" 2>&1)"; EXIT=$?

# Assert exit 2, status=precondition_failed, raw_log=null, endpoint-specific diagnostic
assert_precondition_failed "$OUT" "$EXIT" "UNIT2B_EP_UNREADY" "Case 2: unready endpoint fails closed"

# Assert the selection did not switch model/runner/endpoint
assert_contains "$OUT" '"runner": "cc-shim"' "Case 2: runner should still be cc-shim"
assert_contains "$OUT" '"model": "glm-5.2"' "Case 2: model should still be glm-5.2"

# Assert fake runner never starts
run_count=0
if [ -f "$RUN_COUNT_FILE" ]; then
  run_count=$(wc -l < "$RUN_COUNT_FILE" | tr -d '[:space:]')
fi
assert_eq "0" "$run_count" "Case 2: fake runner never starts"

cleanup_env
finalize_test
