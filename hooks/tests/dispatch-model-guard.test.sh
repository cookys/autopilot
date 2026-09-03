#!/usr/bin/env bash
# Test for dispatch-model-guard.js hook
. "$(dirname "$0")/lib.sh"

# Case 1: default-on since v2.35.15 — the opt-OUT env silences it; without it the guard fires
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case1-exit"
assert_eq "" "$__RUN_STDOUT" "case1-silent (opt-out env)"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case1b-default-on fires without any enable flag"

# Case 2: Enabled, model fable → ask
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case2-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case2-ask"
assert_contains "$__RUN_STDOUT" "fable" "case2-reason"

# Case 3: Enabled, model claude-fable-5 → ask (substring match)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"claude-fable-5"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case3-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case3-ask"
assert_contains "$__RUN_STDOUT" "claude-fable-5" "case3-reason"

# Case 4: Enabled, model FABLE (uppercase) → ask (case-insensitive)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"FABLE"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case4-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case4-ask"
assert_contains "$__RUN_STDOUT" "FABLE" "case4-reason"

# Case 5: Enabled, model haiku → silent
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case5-exit"
assert_eq "" "$__RUN_STDOUT" "case5-silent"

# Case 6: Enabled, model absent → ask with "no model specified"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6-ask"
assert_contains "$__RUN_STDOUT" "no model specified" "case6-reason"

# Case 7: Enabled, tool_name Bash → silent (not Agent/Task)
PAYLOAD='{"tool_name":"Bash","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case7-exit"
assert_eq "" "$__RUN_STDOUT" "case7-silent"

# Case 8: Enabled, garbage stdin → fail-open (stderr contains "fail-open")
run_hook dispatch-model-guard.js 'not json'
assert_eq 0 "$__RUN_EXIT" "case8-exit"
assert_eq "" "$__RUN_STDOUT" "case8-silent"
assert_contains "$__RUN_STDERR" "fail-open" "case8-fail-open"

# Case 9: Config guarded_models: fable,opus → opus asks, sonnet silent
printf '%s\n' "- guarded_models: fable,opus" > "$TEST_TMP/config9.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config9.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case9a-ask"
assert_contains "$__RUN_STDOUT" "opus" "case9a-reason"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9b-exit"
assert_eq "" "$__RUN_STDOUT" "case9b-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 10: Config on_missing_model: allow → absent model silent
printf '%s\n' "- on_missing_model: allow" > "$TEST_TMP/config10.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config10.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case10-exit"
assert_eq "" "$__RUN_STDOUT" "case10-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 11: Config mode: off → model fable silent
printf '%s\n' "- mode: off" > "$TEST_TMP/config11.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config11.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case11-exit"
assert_eq "" "$__RUN_STDOUT" "case11-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 12: Config mode: warn → model fable: stdout empty, stderr non-empty
printf '%s\n' "- mode: warn" > "$TEST_TMP/config12.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config12.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case12-exit"
assert_eq "" "$__RUN_STDOUT" "case12-stdout-silent"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "case12-stderr-carries-warn-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 13: Config garbage mode: yolo → model fable asks (fail-closed)
printf '%s\n' "- mode: yolo" > "$TEST_TMP/config13.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config13.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case13-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case13-ask"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

finalize_test
