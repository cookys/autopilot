#!/usr/bin/env bash
# Fleet-local GLM via cc-shim is allowed; Chinese-operated cloud GLM stays barred.
. "$(dirname "$0")/lib.sh"
scrub_session_env

REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
DIFF="$TEST_TMP/diff.txt"
BIN="$TEST_TMP/bin"
mkdir -p "$BIN" "$TEST_TMP/home" "$TEST_TMP/repo"
printf '%s\n' 'diff --git a/x b/x' '+fixture' > "$DIFF"
git -C "$TEST_TMP/repo" init -q
cat > "$BIN/claude" <<'STUB'
#!/usr/bin/env bash
printf 'spawned\n' >> "$STUB_RUN_MARKER"
cat >/dev/null
printf 'VERDICT: SHIP-AS-IS\n'
STUB
chmod +x "$BIN/claude"
export HOME="$TEST_TMP/home"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/home/.autopilot/config.json"
mkdir -p "$(dirname "$AUTOPILOT_CONFIG_FILE")"
printf '{}\n' > "$AUTOPILOT_CONFIG_FILE"
export AUTOPILOT_LOCAL_GATEWAY_HOSTS=localhost
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/endpoints.env"
printf '%s\n' \
  'AUTOPILOT_ENDPOINT_GLM_LOCAL_URL=http://localhost:9876/anthropic' \
  'AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN=fixture-token' \
  'AUTOPILOT_ENDPOINT_GLM_CLOUD_URL=https://api.bigmodel.cn/anthropic' \
  'AUTOPILOT_ENDPOINT_GLM_CLOUD_TOKEN=fixture-token' > "$AUTOPILOT_ENDPOINTS_ENV"
chmod 600 "$AUTOPILOT_ENDPOINTS_ENV"

run_review() {
  local tag="$1"; shift
  (cd "$TEST_TMP/repo" && STUB_RUN_MARKER="$TEST_TMP/$tag.spawned" PATH="$BIN:$PATH" \
    DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_CONTEXT_WINDOW_GATE=off \
    AUTOPILOT_TEST_CN_GATE_OFF=0 \
    "$REVIEW" --runner cc-shim --model GLM-5.3 --diff-file "$DIFF" --timeout 5s \
      --bin "$BIN/claude" "$@" >"$TEST_TMP/$tag.out" 2>"$TEST_TMP/$tag.err")
}

run_review explicit --endpoint glm_local; RC=$?
assert_exit_code "$RC" "0" "fleet-local GLM with explicit endpoint is allowed"
assert_not_contains "$(cat "$TEST_TMP/explicit.err")$(cat "$TEST_TMP/explicit.out")" \
  "cn_model_dispatch_barred" "explicit local endpoint has no gate refusal"
assert_not_contains "$(cat "$TEST_TMP/explicit.err")$(cat "$TEST_TMP/explicit.out")" \
  '"status": "precondition_failed"' "explicit local endpoint has no precondition failure"
assert_file_exists "$TEST_TMP/explicit.spawned" "explicit local endpoint reaches stub runner"

ANTHROPIC_BASE_URL=http://localhost:9876/anthropic ANTHROPIC_AUTH_TOKEN=fixture-token \
  run_review default
RC=$?
assert_exit_code "$RC" "0" "fleet-local GLM with default endpoint resolution is allowed"
assert_not_contains "$(cat "$TEST_TMP/default.err")$(cat "$TEST_TMP/default.out")" \
  "cn_model_dispatch_barred" "default endpoint has no gate refusal"
assert_not_contains "$(cat "$TEST_TMP/default.err")$(cat "$TEST_TMP/default.out")" \
  '"status": "precondition_failed"' "default endpoint has no precondition failure"
assert_file_exists "$TEST_TMP/default.spawned" "default endpoint reaches stub runner"

run_review cloud --endpoint glm_cloud; RC=$?
assert_exit_code "$RC" "2" "Chinese-operated cloud GLM stays barred"
assert_contains "$(cat "$TEST_TMP/cloud.err")" "cn_model_dispatch_barred zhipu restricted_operator_private_workdir" \
  "cloud GLM refusal identifies restricted operator"
assert_file_absent "$TEST_TMP/cloud.spawned" "cloud GLM is refused before runner spawn"

finalize_test
