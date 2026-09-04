#!/usr/bin/env bash
# Test for dispatch-model-guard.js hook
. "$(dirname "$0")/lib.sh"

# Case 1: default-on since v2.35.15 — the opt-OUT env silences it; without it the guard fires
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case1-exit"
assert_eq "" "$__RUN_STDOUT" "case1-silent (opt-out env)"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case1b-default-on fires without any enable flag"

# Case 2: Enabled, model fable → ask
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case2-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case2-ask"
assert_contains "$__RUN_STDOUT" "fable" "case2-reason"

# Case 3: Enabled, model claude-fable-5 → ask (substring match)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"claude-fable-5","prompt":"Engine: claude-fable-5@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case3-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case3-ask"
assert_contains "$__RUN_STDOUT" "claude-fable-5" "case3-reason"

# Case 4: Enabled, model FABLE (uppercase) → ask (case-insensitive)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"FABLE","prompt":"Engine: FABLE@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case4-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case4-ask"
assert_contains "$__RUN_STDOUT" "FABLE" "case4-reason"

# Case 5: Enabled, model haiku → silent
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case5-exit"
assert_eq "" "$__RUN_STDOUT" "case5-silent"

# Case 6: Enabled, model absent → ask with "no model specified"
printf '%s\n' "- require_engine_header: off" > "$TEST_TMP/config6.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6-ask"
assert_contains "$__RUN_STDOUT" "no model specified" "case6-reason"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

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
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case9a-ask"
assert_contains "$__RUN_STDOUT" "opus" "case9a-reason"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9b-exit"
assert_eq "" "$__RUN_STDOUT" "case9b-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 10: Config on_missing_model: allow (require_engine_header left at its "on" default)
# → absent model silent. Missing model must be decided by on_missing_model BEFORE the
# header check runs — a header check on an empty model would otherwise deny first and
# make on_missing_model: allow dead config (regression this case guards against).
printf '%s\n' "- on_missing_model: allow" "- require_engine_header: off" > "$TEST_TMP/config10.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config10.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case10-exit"
assert_eq "" "$__RUN_STDOUT" "case10-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 10b: on_missing_model: allow with require_engine_header: on (default, not switched off)
# + no model ⇒ allow. This is the precedence regression test: the header check must be
# skipped entirely when model is absent, not run-then-denied ahead of on_missing_model.
printf '%s\n' "- on_missing_model: allow" > "$TEST_TMP/config10b.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config10b.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case10b-exit"
assert_eq "" "$__RUN_STDOUT" "case10b-silent (on_missing_model: allow wins over header check when model absent)"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 11: Config mode: off → model fable silent
printf '%s\n' "- mode: off" > "$TEST_TMP/config11.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config11.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case11-exit"
assert_eq "" "$__RUN_STDOUT" "case11-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 12: Config mode: warn → model fable: stdout empty, stderr non-empty
printf '%s\n' "- mode: warn" > "$TEST_TMP/config12.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config12.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case12-exit"
assert_eq "" "$__RUN_STDOUT" "case12-stdout-silent"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "case12-stderr-carries-warn-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 13: Config garbage mode: yolo → model fable asks (fail-closed)
printf '%s\n' "- mode: yolo" > "$TEST_TMP/config13.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config13.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case13-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case13-ask"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 14: mode: "plan", model: "opus" → allowed (no ask/deny)
# Plan-mode opus is a reviewer/debugger dispatch and must NOT be guarded by the new guarded_models_implementing default.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus@agy effort=low\nReview this code."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case14-exit"
assert_eq "" "$__RUN_STDOUT" "case14-silent (plan-mode opus allowed)"

# Case 15: mode absent (or mode: "default"), model: "opus" → asks
# Implementation-shaped opus is guarded by the new default guarded_models_implementing: fable,opus; reason contains opus.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus@agy effort=low\nImplement this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case15a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case15a-ask"
assert_contains "$__RUN_STDOUT" "opus" "case15a-reason"

PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"default","prompt":"Engine: opus@agy effort=low\nImplement this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case15b-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case15b-ask"
assert_contains "$__RUN_STDOUT" "opus" "case15b-reason"

# Case 16: mode: "plan", model: "fable" → still asks
# Existing guarded_models: fable applies to ALL dispatches regardless of mode.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","mode":"plan","prompt":"Engine: fable@agy effort=low\nPlan this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case16-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case16-ask"
assert_contains "$__RUN_STDOUT" "fable" "case16-reason"

# Case 17: tool_input.prompt first line is "Engine: sonnet@agy effort=low" and model: "sonnet" → allowed
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case17-exit"
assert_eq "" "$__RUN_STDOUT" "case17-silent (matching engine header allowed)"

# Case 18: tool_input.prompt is missing entirely (or empty) → denied, reason contains prompt line 1
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case18a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case18a-deny"
assert_contains "$__RUN_STDOUT" "prompt line 1" "case18a-reason"

PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":""},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case18b-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case18b-deny"
assert_contains "$__RUN_STDOUT" "prompt line 1" "case18b-reason"

# Case 19: prompt first line is "Engine: opus@agy effort=low" while model: "sonnet" → denied (mismatch), reason contains prompt line 1
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: opus@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case19-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case19-deny"
assert_contains "$__RUN_STDOUT" "prompt line 1" "case19-reason"

# Case 20: Config require_engine_header: off and a missing header → allowed (old behavior)
printf '%s\n' "- require_engine_header: off" > "$TEST_TMP/config20.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config20.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case20-exit"
assert_eq "" "$__RUN_STDOUT" "case20-silent (require_engine_header: off allows missing header)"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 21: Config mode: warn and a missing header → allowed (exit 0), stderr carries warning
printf '%s\n' "- mode: warn" > "$TEST_TMP/config21.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config21.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case21-exit"
assert_eq "" "$__RUN_STDOUT" "case21-stdout-silent"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "case21-stderr-carries-warn-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

finalize_test
