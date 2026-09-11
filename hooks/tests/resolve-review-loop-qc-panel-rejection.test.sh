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
assert_eq "$RUN_EXIT" "3" "invalid QC runner exits 3 without --enforce"
assert_contains "$RUN_STDERR" "invalid qc_panel_runners[1]" "runner rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "nope" "runner rejection names the rejected value"
assert_contains "$RUN_STDERR" "codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn|kimi|cursor|opencode" "runner rejection names the complete accepted set"
assert_eq "$RUN_STDOUT" "" "runner rejection writes no diagnostic to stdout"

EFFORT_CFG="$TEST_TMP/invalid-effort.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, turbo, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$EFFORT_CFG"
run_resolver "$EFFORT_CFG"
assert_eq "$RUN_EXIT" "3" "invalid QC effort exits 3 without --enforce"
assert_contains "$RUN_STDERR" "invalid qc_panel_efforts[1]" "effort rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "turbo" "effort rejection names the rejected value"
assert_contains "$RUN_STDERR" "low|medium|high|xhigh|max" "effort rejection names the complete accepted set"
assert_eq "$RUN_STDOUT" "" "effort rejection writes no diagnostic to stdout"

ENDPOINT_CFG="$TEST_TMP/invalid-endpoint.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, bad endpoint!, @none\n' > "$ENDPOINT_CFG"
run_resolver "$ENDPOINT_CFG"
assert_eq "$RUN_EXIT" "3" "invalid QC endpoint exits 3 without --enforce"
assert_contains "$RUN_STDERR" "invalid qc_panel_endpoints[1]" "endpoint rejection names the rejected array entry"
assert_contains "$RUN_STDERR" "bad endpoint!" "endpoint rejection names the rejected value"
assert_contains "$RUN_STDERR" "@none|^[A-Za-z0-9_]+$" "endpoint rejection names the complete accepted set"
assert_eq "$RUN_STDOUT" "" "endpoint rejection writes no diagnostic to stdout"

ARITY_CFG="$TEST_TMP/invalid-arity.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, @none, @none\n' > "$ARITY_CFG"
run_resolver "$ARITY_CFG"
assert_eq "$RUN_EXIT" "3" "misaligned QC companion array exits 3 without --enforce"
assert_contains "$RUN_STDERR" "invalid qc_panel_runners length" "arity rejection names the disagreeing array"
assert_contains "$RUN_STDERR" "qc_panel length 3" "arity rejection names the accepted panel length"
assert_contains "$RUN_STDERR" ": 2" "arity rejection names the rejected companion length"
assert_eq "$RUN_STDOUT" "" "arity rejection writes no diagnostic to stdout"

VALID_CFG="$TEST_TMP/valid-panel.md"
printf -- '- qc_panel: gpt-5.5, claude-opus, gemini-3.6-flash-high\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n- qc_panel_endpoints: @none, @none, google\n' > "$VALID_CFG"
run_resolver "$VALID_CFG"
VALID_SEAT_COUNT="$(JSON_VALUE="$RUN_STDOUT" node -e 'const value = JSON.parse(process.env.JSON_VALUE); process.stdout.write(String(value.qc_panel_seats.length));')"
assert_eq "$RUN_EXIT" "0" "valid three-seat QC panel exits 0"
assert_eq "$VALID_SEAT_COUNT" "3" "valid three-seat QC panel serializes all three seats"
assert_contains "$RUN_STDOUT" '"qc_panel_seats_complete": true' "valid three-seat QC panel remains complete"

finalize_test
