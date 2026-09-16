#!/usr/bin/env bash
# Regression coverage for loud, unconditional QC-panel companion validation.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_FILE
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-such-topology.json"

run_resolver() {
  local config="$1"
  local stdout_file="$TEST_TMP/stdout"
  local stderr_file="$TEST_TMP/stderr"
  REVIEW_LOOP_CONFIG_OVERRIDE="$config" bash "$SCRIPT" >"$stdout_file" 2>"$stderr_file"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$stdout_file")"
  RUN_STDERR="$(cat "$stderr_file")"
}

RUNNER_CFG="$TEST_TMP/invalid-runner.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, nope, agy\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$RUNNER_CFG"
run_resolver "$RUNNER_CFG"
assert_eq "$RUN_EXIT" "0" "invalid QC runner stays non-fatal, per the shipped contract"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": false' "invalid QC runner leaves the panel incomplete"
assert_contains "$RUN_STDERR" "invalid qc_panel_runners[1]" "runner rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "nope" "runner rejection names the rejected value"
assert_contains "$RUN_STDERR" "codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor|opencode" "runner rejection names the complete accepted set"
assert_contains "$RUN_STDOUT" '"implementer_runner"' "runner rejection keeps stdout parseable JSON"

EFFORT_CFG="$TEST_TMP/invalid-effort.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, turbo, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$EFFORT_CFG"
run_resolver "$EFFORT_CFG"
assert_eq "$RUN_EXIT" "0" "invalid QC effort stays non-fatal, per the shipped contract"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": false' "invalid QC effort leaves the panel incomplete"
assert_contains "$RUN_STDERR" "invalid qc_panel_efforts[1]" "effort rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "turbo" "effort rejection names the rejected value"
assert_contains "$RUN_STDERR" "low|medium|high|xhigh|max" "effort rejection names the complete accepted set"
assert_contains "$RUN_STDOUT" '"implementer_runner"' "effort rejection keeps stdout parseable JSON"

ENDPOINT_CFG="$TEST_TMP/invalid-endpoint.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, bad endpoint!, @none\n' > "$ENDPOINT_CFG"
run_resolver "$ENDPOINT_CFG"
assert_eq "$RUN_EXIT" "0" "invalid QC endpoint stays non-fatal, per the shipped contract"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": false' "invalid QC endpoint leaves the panel incomplete"
assert_contains "$RUN_STDERR" "invalid qc_panel_endpoints[1]" "endpoint rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "bad endpoint!" "endpoint rejection names the rejected value"
assert_contains "$RUN_STDERR" "@none|^[A-Za-z0-9_]+$" "endpoint rejection names the complete accepted set"
assert_contains "$RUN_STDOUT" '"implementer_runner"' "endpoint rejection keeps stdout parseable JSON"

ARITY_CFG="$TEST_TMP/invalid-arity.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$ARITY_CFG"
run_resolver "$ARITY_CFG"
assert_eq "$RUN_EXIT" "0" "misaligned QC companion array stays non-fatal, per the shipped contract"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": false' "misaligned companion array leaves the panel incomplete"
assert_contains "$RUN_STDERR" "invalid qc_panel_runners length" "arity rejection names the disagreeing array"
assert_contains "$RUN_STDERR" "qc_panel length 3" "arity rejection names the accepted panel length"
assert_contains "$RUN_STDERR" ": 2" "arity rejection names the rejected companion length"
assert_contains "$RUN_STDOUT" '"implementer_runner"' "arity rejection keeps stdout parseable JSON"

VALID_CFG="$TEST_TMP/valid-panel.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, @none, google\n' > "$VALID_CFG"
run_resolver "$VALID_CFG"
VALID_SEAT_COUNT="$(JSON_VALUE="$RUN_STDOUT" node -e 'const value = JSON.parse(process.env.JSON_VALUE); process.stdout.write(String(value.qc_panel_seats.length));')"
assert_eq "$RUN_EXIT" "0" "valid three-seat QC panel exits 0"
assert_eq "$VALID_SEAT_COUNT" "3" "valid three-seat QC panel serializes all three seats"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": true' "valid three-seat QC panel remains complete"

# RED at base 9b049c00: --check-scorecard capability_warnings has no
#   "cannot execute a managed blind-discovery review" entry; stderr has no
#   matching ⚠ (host pin/override ⚠ lines only).
BLIND_CFG="$TEST_TMP/blind-panel.md"
printf -- '- qc_panel: gpt-5.6-sol, GLM-5.2, MiniMax-M3\n- qc_panel_runners: codex, cc-shim, cursor\n- qc_panel_efforts: high, high, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$BLIND_CFG"
BLIND_OVR="$TEST_TMP/blind-qc-override.json"
printf '{"schema":1,"overrides":[{"engine":"MiniMax-M3","runner":"cursor","role":"qc_panel","reason":"fixture cursor admission","operator":"test","expires":"2099-12-31"}]}\n' > "$BLIND_OVR"
EMPTY_SCDIR="$TEST_TMP/blind-empty-scorecard"
mkdir -p "$EMPTY_SCDIR"
run_resolver_scorecard() {
  local stdout_file="$TEST_TMP/stdout" stderr_file="$TEST_TMP/stderr"
  ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" AUTOPILOT_QUALIFICATION_OVERRIDE="$BLIND_OVR" \
    REVIEW_LOOP_CONFIG_OVERRIDE="$BLIND_CFG" bash "$SCRIPT" --check-scorecard \
    >"$stdout_file" 2>"$stderr_file"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$stdout_file")"
  RUN_STDERR="$(cat "$stderr_file")"
}
run_resolver_scorecard
assert_eq "$RUN_EXIT" "0" "blind-incompatible qc seats stay report-only under --check-scorecard"
WARN_JSON="$(JSON_VALUE="$RUN_STDOUT" node -e '
const v = JSON.parse(process.env.JSON_VALUE);
const w = (v.capability_warnings || []).filter((x) => /cannot execute a managed blind-discovery review/.test(String(x)));
process.stdout.write(JSON.stringify(w));
')"
WARN_COUNT="$(JSON_VALUE="$WARN_JSON" node -e 'process.stdout.write(String(JSON.parse(process.env.JSON_VALUE).length));')"
assert_eq "$WARN_COUNT" "2" "exactly two blind-incompatible capability_warnings in index order"
assert_contains "$WARN_JSON" '"qc_panel[0] seat (gpt-5.6-sol/codex) cannot execute a managed blind-discovery review' \
  "first warning names qc_panel[0] codex"
assert_contains "$WARN_JSON" '"qc_panel[2] seat (MiniMax-M3/cursor) cannot execute a managed blind-discovery review' \
  "second warning names qc_panel[2] cursor"
JSON_VALUE="$WARN_JSON" node -e '
const w = JSON.parse(process.env.JSON_VALUE);
if (w.some((x) => /pin-seat|AUTOPILOT_QUALIFICATION_OVERRIDE/.test(String(x)))) process.exit(1);
' || fail "blind warning text must not suggest pin-seat or AUTOPILOT_QUALIFICATION_OVERRIDE"
assert_contains "$RUN_STDERR" "resolve-review-loop: ⚠ qc_panel[0] seat (gpt-5.6-sol/codex) cannot execute a managed blind-discovery review" \
  "stderr ⚠ for qc_panel[0]"
assert_contains "$RUN_STDERR" "resolve-review-loop: ⚠ qc_panel[2] seat (MiniMax-M3/cursor) cannot execute a managed blind-discovery review" \
  "stderr ⚠ for qc_panel[2]"

REVIEW_LOOP_CONFIG_OVERRIDE="$BLIND_CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$BLIND_OVR" \
  bash "$SCRIPT" >"$TEST_TMP/stdout-off" 2>"$TEST_TMP/stderr-off"
OFF_EXIT=$?
OFF_STDOUT="$(cat "$TEST_TMP/stdout-off")"
OFF_STDERR="$(cat "$TEST_TMP/stderr-off")"
assert_eq "$OFF_EXIT" "0" "without --check-scorecard the same panel still resolves"
assert_not_contains "$OFF_STDOUT" "cannot execute a managed blind-discovery review" \
  "without --check-scorecard no blind-incompatible capability_warnings"
assert_not_contains "$OFF_STDERR" "cannot execute a managed blind-discovery review" \
  "without --check-scorecard no blind-incompatible stderr ⚠"

finalize_test
