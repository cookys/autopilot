#!/usr/bin/env bash
# RED at 895b778d3: no model with first line "Engine: sonnet" still lists engine (missingBriefHeaders exited 2). 92 passed, 1 failed.
# RED at 48aa19a3fdc8eb21ab3a1036dbc7a32a6a61e0ef: 87 passed, 4 failed — both-missing deny had no "Lane:", no three-line template, and did not name subagent-budget.
# Test for dispatch-model-guard.js hook
. "$(dirname "$0")/lib.sh"

unset ANTHROPIC_BASE_URL ANTHROPIC_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL CLAUDE_CODE_SUBAGENT_MODEL

# Exact fable/opus Cost line. Existing fable/opus fixtures include it so they
# still reach the Model-Reason / guarded-engine checks; the costline cases below omit it.
COST_FABLE_OPUS="$(node -e 'process.stdout.write(require(process.argv[1]).costLineFor("opus"))' "$REPO_ROOT/hooks/lib/brief-header-template.js")"

# Brain-tier dispatch ledger (opus/fable Model-Reason gate) — sandboxed, never the real state dir.
export AUTOPILOT_STATE_DIR="$TEST_TMP/btr-state"
# No real fleet binary in any seat resolution (whoamiSession) this suite may trigger.
printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP/fleet-noop"
chmod +x "$TEST_TMP/fleet-noop"
export FLEET_BIN="$TEST_TMP/fleet-noop"

# P4: the Fleet-Task gate now covers every seat; this suite is about other guards, so run as an exempt caller (the Fleet-Task section below unsets it).
export AUTOPILOT_DISPATCH_ROLE=probe-model-guard-test
# Case 1: default-on since v2.35.15 — the opt-OUT env silences it; without it the guard fires
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case1-exit"
assert_eq "" "$__RUN_STDOUT" "case1-silent (opt-out env)"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case1b-default-on fires without any enable flag (remind = deny with reminder, v2.36.9)"
assert_contains "$__RUN_STDOUT" "Model-Reason:" "case1b-reminder names the Model-Reason justification line"

# Case 2: Enabled, model fable → remind (deny carrying the reminder; v2.36.9, was ask)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case2-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case2-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "fable" "case2-reason"

# Case 3: Enabled, model claude-fable-5 → ask (substring match)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"claude-fable-5","prompt":"Engine: claude-fable-5@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case3-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case3-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "claude-fable-5" "case3-reason"

# Case 4: Enabled, model FABLE (uppercase) → ask (case-insensitive)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"FABLE","prompt":"Engine: FABLE@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case4-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case4-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "FABLE" "case4-reason"

# Case 5: Enabled, model haiku → silent
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case5-exit"
assert_eq "" "$__RUN_STDOUT" "case5-silent"

# Case 6: Enabled, model absent → ALLOWED with the worker-level default:
# hookSpecificOutput.updatedInput sets model "sonnet" (every other tool_input field
# verbatim) and one advisory line 預設 worker 等級 sonnet reaches stderr. No dialog, no deny.
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case6-allow (missing model defaults to the worker level, never a dialog)"
assert_contains "$__RUN_STDOUT" '"updatedInput"' "case6-updatedInput present"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "case6-updatedInput sets model sonnet"
assert_contains "$__RUN_STDERR" "預設 worker 等級 sonnet" "case6-advisory line"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6-never ask"

# Local seats inherit the main model; explicitly choosing sonnet is advisory.
ANTHROPIC_BASE_URL=http://127.0.0.1:8780 ANTHROPIC_MODEL=glm-5 run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "local-inherit-exit"
assert_not_contains "$__RUN_STDOUT" '"model":"sonnet"' "local-inherit-no-rewrite"
assert_contains "$__RUN_STDERR" "預設 worker 等級 inherit" "local-inherit-advisory"
assert_not_contains "$__RUN_STDERR" "預設 worker 等級 sonnet" "local-inherit-no-sonnet-advisory"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
ANTHROPIC_BASE_URL=http://127.0.0.1:8780 ANTHROPIC_MODEL=glm-5 run_hook dispatch-model-guard.js "$PAYLOAD"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "local-explicit-allowed"
assert_contains "$__RUN_STDERR" "本地模型席指定了 Claude 模型 sonnet，會用 Claude 額度" "local-explicit-advisory"

# Exercise model overrides and private-address boundaries independently.
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
for url in http://localhost:8780 http://127.2.3.4 http://[::1]:8780 http://10.0.0.1 http://192.168.1.1 http://172.16.0.1 http://172.31.255.255 http://100.64.0.1 http://100.127.255.255; do
  ANTHROPIC_BASE_URL="$url" run_hook dispatch-model-guard.js "$PAYLOAD"
  assert_contains "$__RUN_STDERR" "預設 worker 等級 inherit" "private-url-$url"
done
for url in https://api.anthropic.com http://172.15.0.1 http://172.32.0.1 http://100.63.255.255 http://100.128.0.1; do
  ANTHROPIC_BASE_URL="$url" run_hook dispatch-model-guard.js "$PAYLOAD"
  assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "public-url-$url"
done
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5 run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDERR" "預設 worker 等級 inherit" "sonnet-model-override"
CLAUDE_CODE_SUBAGENT_MODEL=glm-5 run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDERR" "預設 worker 等級 inherit" "subagent-model-override"
ANTHROPIC_MODEL=glm-5 run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDERR" "預設 worker 等級 inherit" "main-model-override"

# Case 6b: model absent with other tool_input fields → updatedInput keeps them verbatim.
PAYLOAD='{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","description":"check the tests","prompt":"Engine: sonnet\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
const h = o.hookSpecificOutput;
const ui = h.updatedInput;
if (h.permissionDecision !== undefined) process.exit(2);
if (ui.model !== "sonnet") process.exit(3);
if (ui.subagent_type !== "general-purpose") process.exit(4);
if (ui.description !== "check the tests") process.exit(5);
if (ui.prompt !== "Engine: sonnet\nDo work.") process.exit(6);
if (ui.model === undefined && Object.keys(ui).length !== 4) process.exit(7);
' <<< "$__RUN_STDOUT"
assert_eq 0 "$?" "case6b-updatedInput keeps every other tool_input field verbatim"
assert_contains "$__RUN_STDERR" "預設 worker 等級 sonnet" "case6b-advisory line"

# Case 6c: mode: warn + missing model → the default still applies (it is not a block);
# the advisory line rides additionalContext.
printf '%s\n' "- mode: warn" > "$TEST_TMP/config6c.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6c.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6c-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case6c-warn mode still defaults to sonnet"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "case6c-updatedInput sonnet"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case6c-advisory on stdout"
assert_contains "$__RUN_STDERR" "預設 worker 等級 sonnet" "case6c-stderr line"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6d: an old on_missing_model knob is dead config — it no longer changes the default.
printf '%s\n' "- on_missing_model: ask" > "$TEST_TMP/config6d.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6d.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6d-exit"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "case6d-on_missing_model is no longer honoured"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6d-no dialog"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6e: opus/fable is acknowledged by the Model-Reason line (2026-11) — allowed
# silently (stderr note only). The (intentional:) Engine header ALONE no longer suffices
# for a brain tier (see case 6f).
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable\n'"$COST_FABLE_OPUS"'\nModel-Reason: plan critique needs the strongest reader\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6e-exit"
assert_eq "" "$__RUN_STDOUT" "case6e-silent stdout (Model-Reason acknowledged brain dispatch proceeds)"
assert_contains "$__RUN_STDERR" "acknowledged as intentional" "case6e-stderr note"

# Case 6f: the (intentional:) Engine header without a Model-Reason line no longer
# acknowledges a brain tier → deny naming the Model-Reason line.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable (intentional: plan critique needs the strongest reader)\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6f-deny ((intentional:) alone no longer suffices for a brain tier)"
assert_contains "$__RUN_STDOUT" "Model-Reason:" "case6f-denial names the Model-Reason line"

# Case 6g: a Model-Reason further down the prompt does not count (first 8 lines only),
# and an empty Model-Reason: does not count.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable\n'"$COST_FABLE_OPUS"'\n1\n2\n3\n4\n5\n6\nModel-Reason: too late\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6g-deny (Model-Reason on line 9 is outside the first 8 lines)"
assert_contains "$__RUN_STDOUT" "first 8 lines" "case6g-denial names the 8-line window"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable\n'"$COST_FABLE_OPUS"'\nModel-Reason:\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6h-deny (empty Model-Reason is no justification)"

# Case 6g (v2.36.9): mode: ask opts back into the interactive dialog for guarded engines (with Model-Reason present)
printf '%s\n' "- mode: ask" > "$TEST_TMP/config6g.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6g.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nModel-Reason: needs strongest reader\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6g-ask (opt back into the dialog)"
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
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case9a-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "opus" "case9a-reason"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet@agy effort=low\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case9b-exit"
assert_eq "" "$__RUN_STDOUT" "case9b-silent"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 10: absent model defaults to sonnet via updatedInput regardless of on_missing_model
printf '%s\n' "- on_missing_model: allow" "- require_engine_header: off" > "$TEST_TMP/config10.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config10.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case10-exit"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "case10-sonnet-default"
assert_contains "$__RUN_STDOUT" "預設 worker 等級 sonnet" "case10-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 10b: absent model defaults to sonnet even with require_engine_header: on
printf '%s\n' "- on_missing_model: allow" > "$TEST_TMP/config10b.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config10b.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case10b-exit"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "case10b-sonnet-default (worker default wins over header check when model absent)"
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
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case12-exit"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case12-stdout-advisory"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case12-warn never permissionDecision"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "case12-stderr-carries-warn-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 13: Config garbage mode: yolo → model fable reminded/denied (fail-closed, no dialog)
printf '%s\n' "- mode: yolo" > "$TEST_TMP/config13.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config13.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case13-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case13-remind (deny with reminder, never a dialog)"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 14: mode: "plan", model: "opus" with Model-Reason → allowed (no ask/deny)
# Plan-mode opus is a reviewer/debugger dispatch and must NOT be guarded by guarded_models_implementing.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus@agy effort=low\n'"$COST_FABLE_OPUS"'\nModel-Reason: plan-mode review\nReview this code."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case14-exit"
assert_eq "" "$__RUN_STDOUT" "case14-silent (plan-mode opus allowed)"

# Case 15: mode absent (or mode: "default"), model: "opus" → asks
# Implementation-shaped opus is guarded by the new default guarded_models_implementing: fable,opus; reason contains opus.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus@agy effort=low\n'"$COST_FABLE_OPUS"'\nImplement this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case15a-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case15a-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "opus" "case15a-reason"

PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"default","prompt":"Engine: opus@agy effort=low\n'"$COST_FABLE_OPUS"'\nImplement this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case15b-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case15b-remind (deny with reminder, never a dialog)"
assert_contains "$__RUN_STDOUT" "opus" "case15b-reason"

# Case 16: mode: "plan", model: "fable" → still asks
# Existing guarded_models: fable applies to ALL dispatches regardless of mode.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","mode":"plan","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nPlan this."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case16-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case16-remind (deny with reminder, never a dialog)"
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
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case21-stdout-advisory"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case21-warn never permissionDecision"
assert_contains "$__RUN_STDERR" "dispatch-model-guard" "case21-stderr-carries-warn-advisory"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# hdrhint: a brief missing Engine and Lane names both, the three-line template, and subagent-budget.
HDR_TMPL='Engine: <model>\nRole: <role>\nLane: <slug>'
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Do the work with no header lines."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "hdrhint-both-missing-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "hdrhint-both-missing-deny"
assert_contains "$__RUN_STDOUT" "Engine:" "hdrhint-both-missing lists Engine"
assert_contains "$__RUN_STDOUT" "Lane:" "hdrhint-both-missing lists Lane"
assert_contains "$__RUN_STDOUT" "$HDR_TMPL" "hdrhint-both-missing has the three-line template"
assert_contains "$__RUN_STDOUT" "subagent-budget" "hdrhint-both-missing names subagent-budget"
assert_contains "$__RUN_STDOUT" "subagent-budget requires Lane: for autopilot dispatches" "hdrhint-both-missing does not guess the lane gate"

# Negative: all required lines stay allowed (same as a matching header on base).
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "hdrhint-complete-exit"
assert_eq "" "$__RUN_STDOUT" "hdrhint-complete stays allowed"

# No model argument: a first line that starts with Engine: is not a missing engine.
NOMODEL="$(node -e '
  const { missingBriefHeaders } = require(process.argv[1]);
  const missing = missingBriefHeaders("Engine: sonnet\nRole: worker\nLane: alpha\n", "");
  if (missing.indexOf("engine") !== -1) process.exit(2);
  process.stdout.write(missing.join(","));
' "$REPO_ROOT/hooks/lib/brief-header-template.js" 2>"$TEST_TMP/nomodel.err")"
NOMODEL_EC=$?
assert_eq "$NOMODEL_EC" "0" "no model with Engine: sonnet does not list engine (exit ${NOMODEL_EC})"
assert_not_contains ",${NOMODEL}," ",engine," "no model with Engine: sonnet returns a list without engine"

# costLineFor table, the 6-line window, and the session hint (≤200, contains Cost:).
COST_SONNET="$(node -e 'process.stdout.write(require(process.argv[1]).costLineFor("sonnet"))' "$REPO_ROOT/hooks/lib/brief-header-template.js")"
COST_LIB="$(node -e '
  const t = require(process.argv[1]);
  const exp = t.costLineFor("opus");
  const mid = t.costLineFor("sonnet");
  const cases = [
    ["fable", exp], ["opus", exp], ["Fable", exp], ["claude-opus-5-5", exp],
    ["claude-fable-5-2", exp], ["opus@agy", exp], ["claude-opus-5-5@claude", exp],
    ["sonnet", mid], ["Sonnet", mid], ["claude-sonnet-4-6", mid], ["sonnet@agy", mid],
    ["haiku", ""], ["claude-haiku-4-5", ""], ["", ""], ["   ", ""], ["gpt-5", ""],
  ];
  for (const [m, want] of cases) {
    if (t.costLineFor(m) !== want) {
      process.stderr.write("costLineFor " + JSON.stringify(m) + "\n");
      process.exit(2);
    }
  }
  if (exp !== "Cost: 最貴的模型，會燒光共用池；只做最難的判斷，讀檔、搜尋、整理一律派 haiku/sonnet subagent") process.exit(3);
  if (mid !== "Cost: 中價模型；機械性讀檔與搜尋可再派 haiku") process.exit(4);
  if (!t.missingCostLine("Engine: opus\nRole: r\nLane: a\n", "claude-opus-5-5")) process.exit(5);
  if (t.missingCostLine("Engine: opus\nRole: r\nLane: a\n" + exp, "opus")) process.exit(6);
  if (t.missingCostLine("a\nb\nc\nd\ne\n" + exp, "fable")) process.exit(7);
  if (!t.missingCostLine("a\nb\nc\nd\ne\nf\n" + exp, "fable")) process.exit(8);
  if (t.missingCostLine("Engine: sonnet\n", "sonnet")) process.exit(9);
  if (t.missingCostLine("Engine: haiku\n", "haiku")) process.exit(10);
  const hint = t.sessionStartBriefHeaderLine();
  if (hint.length > 200 || !hint.includes("Cost:")) process.exit(11);
  const suffix = t.headerDenialSuffix("Engine: opus\nRole: r\nLane: a\n", "opus", { engineBy: "self", laneBy: "other" });
  if (!suffix.includes(exp)) process.exit(12);
  const suffixHaiku = t.headerDenialSuffix("no header", "haiku", { engineBy: "self", laneBy: "other" });
  if (suffixHaiku.includes("Cost:")) process.exit(13);
  process.stdout.write("costlib_ok");
' "$REPO_ROOT/hooks/lib/brief-header-template.js" 2>"$TEST_TMP/costlib.err")"
COST_LIB_EC=$?
assert_eq "$COST_LIB_EC" "0" "costLineFor table and session hint (exit ${COST_LIB_EC})"
assert_eq "costlib_ok" "$COST_LIB" "costLineFor table wrote costlib_ok"
assert_eq "Cost: 中價模型；機械性讀檔與搜尋可再派 haiku" "$COST_SONNET" "sonnet cost line text"

# opus brief without Cost → deny, reason contains the exact line.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus\nRole: worker\nLane: alpha\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-opus-missing-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-opus-missing denies"
assert_contains "$__RUN_STDOUT" "require_cost_line" "costline-opus-missing names the rule"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-opus-missing gives the exact line"

# opus with the Cost line, Model-Reason, and an intentional Engine header → allowed (other checks allow).
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus (intentional: hardest judgment only)\nRole: worker\nLane: alpha\n'"$COST_FABLE_OPUS"'\nModel-Reason: hardest judgment only\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-opus-present-exit"
assert_eq "" "$__RUN_STDOUT" "costline-opus-present allowed when other checks allow"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-opus-present is not a cost deny"

# fable with (intentional: x) but no Cost line → deny. Intentional does not skip it.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable (intentional: x)\nRole: worker\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-fable-intentional-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-fable-intentional denies"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-fable-intentional gives the exact line"

# full id claude-opus-5-5 is treated as opus.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"claude-opus-5-5","prompt":"Engine: claude-opus-5-5\nRole: worker\nLane: alpha\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-full-id-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-full-id denies"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-full-id gives the opus line"

# sonnet and haiku without a Cost line → no deny from this check.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-sonnet-exit"
assert_eq "" "$__RUN_STDOUT" "costline-sonnet no deny"
assert_not_contains "$__RUN_STDERR" "require_cost_line" "costline-sonnet stderr silent"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-haiku-exit"
assert_eq "" "$__RUN_STDOUT" "costline-haiku no deny"

# require_cost_line: off → no deny, even for intentional fable with Model-Reason and without a Cost line.
printf '%s\n' "- require_cost_line: off" > "$TEST_TMP/config-cost-off.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-off.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable (intentional: x)\nRole: worker\nLane: alpha\nModel-Reason: intentional\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-off-exit"
assert_eq "" "$__RUN_STDOUT" "costline-off no deny"
assert_contains "$__RUN_STDERR" "acknowledged as intentional" "costline-off still allows the intentional engine"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# garbage require_cost_line → on (fail-closed).
printf '%s\n' "- require_cost_line: maybe" > "$TEST_TMP/config-cost-garbage.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-garbage.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus\nRole: worker\nLane: alpha\nReview."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-garbage denies (garbage → on)"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-garbage gives the exact line"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# model absent → worker-level sonnet default applies, so no fable/opus costline deny.
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: claude-fable-5-2\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "costline-engine-token defaults absent model to sonnet"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-engine-token does not deny absent model"

# model omitted + Engine: opus + no Cost line → worker-level sonnet default applies (allow + updatedInput.model "sonnet").
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: opus\nRole: worker\nLane: alpha\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-absent-deny-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "costline-absent-deny allows with sonnet default"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "costline-absent-deny sets model sonnet"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-absent-deny is not a cost deny"

# model omitted + Engine: sonnet + no Cost line → worker-level sonnet default applies, even with dead on_missing_model: ask.
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: sonnet\nRole: worker\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-absent-sonnet-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "costline-absent-sonnet allows with sonnet default"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "costline-absent-sonnet sets model sonnet"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-absent-sonnet is not a cost deny"
printf '%s\n' "- on_missing_model: ask" > "$TEST_TMP/config-cost-ask-sonnet.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-ask-sonnet.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "costline-absent-sonnet-ask allows with sonnet default"
assert_contains "$__RUN_STDOUT" '"model":"sonnet"' "costline-absent-sonnet-ask sets model sonnet"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "costline-absent-sonnet-ask never asks"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-absent-sonnet-ask is not a cost deny"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# A Cost line on line 7 does not count. Line 6 does. Model-Reason would otherwise allow.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\n'"$COST_FABLE_OPUS"'\nModel-Reason: plan-mode review"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-line7 does not count"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\n'"$COST_FABLE_OPUS"'\nStages: build,review,merged\nModel-Reason: plan-mode review"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq "" "$__RUN_STDOUT" "costline-line6 counts"

# Negative: Role alone is not a deny.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "hdrhint-role-only-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "hdrhint-role-only is not denied"

# ---- D8b: Size: / Used-by: / Stages: on autopilot briefs (Lane: present) ----
FULL_TMPL='Engine: <model>\nRole: <role>\nLane: <slug>\nSize: XS|S|M|L|XL\nUsed-by: user|e2e|n/a <reason>'

# Default warn mode: autopilot brief missing Size: and Used-by: allows with advisory message.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "d8b-warn-missing-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "d8b-warn-missing does not deny"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "d8b-warn-missing emits additionalContext"
assert_contains "$__RUN_STDOUT" "brief_size_used_by" "d8b-warn-missing names config key"
assert_contains "$__RUN_STDOUT" "$FULL_TMPL" "d8b-warn-missing carries extended BRIEF_HEADER_TEMPLATE"

# Deny mode: autopilot brief missing Size: / Used-by: -> permissionDecision: deny with template.
printf '%s\n' "- brief_size_used_by: deny" > "$TEST_TMP/config-d8b-deny.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-d8b-deny.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "d8b-deny-missing-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "d8b-deny-missing denies"
assert_contains "$__RUN_STDOUT" "$FULL_TMPL" "d8b-deny-missing carries extended BRIEF_HEADER_TEMPLATE"

# Deny mode: bare `Used-by: n/a` without <reason> or invalid Size is also denied.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: M\nUsed-by: n/a\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "d8b-deny-na-without-reason denies"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: XXL\nUsed-by: user\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "d8b-deny-bad-size denies"

# Stages: absent when Size: M and valid Used-by: are present -> NOT denied even in deny mode; suggests coarse list for M.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: M\nUsed-by: n/a internal gate\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "d8b-stages-m-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "d8b-stages-m does not deny even under brief_size_used_by: deny"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "d8b-stages-m emits additionalContext"
assert_contains "$__RUN_STDOUT" "Stages: plan,build,review,merged" "d8b-stages-m computes default M stages list"

# Verify XS/S and L/XL computed Stages: lines.
STAGES_CHECK="$(node -e '
  const t = require(process.argv[1]);
  const want = {
    XS: "Stages: build,review,merged",
    S: "Stages: build,review,merged",
    M: "Stages: plan,build,review,merged",
    L: "Stages: explore,plan,build,review,merged,shipped,used",
    XL: "Stages: explore,plan,build,review,merged,shipped,used",
  };
  for (const [sz, exp] of Object.entries(want)) {
    if (t.stagesLineForSize(sz) !== exp) {
      process.stderr.write(sz + " got " + t.stagesLineForSize(sz) + "\n");
      process.exit(2);
    }
  }
  process.stdout.write("stages_ok");
' "$REPO_ROOT/hooks/lib/brief-header-template.js")"
assert_eq "stages_ok" "$STAGES_CHECK" "d8b-stages-map matches XS/S, M, L/XL defaults"

# Complete autopilot brief (with Size:, Used-by:, Stages:) -> silent even in deny mode.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nRole: worker\nLane: alpha\nSize: M\nUsed-by: user\nStages: plan,build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "d8b-complete-exit"
assert_eq "" "$__RUN_STDOUT" "d8b-complete silent in deny mode"

# Non-autopilot brief (without Lane:) -> untouched even in deny mode.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"haiku","prompt":"Engine: haiku\nExplore the codebase."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "d8b-no-lane-exit"
assert_eq "" "$__RUN_STDOUT" "d8b-no-lane untouched in deny mode"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# ─── PM Console Fleet-Task hard block (dispatch/task binding commit 1) ───
PM_TASK_ID="01M7R609WK44HJP629E6C93Q9N"
PM_REPO="$TEST_TMP/pm-console-repo"
NON_PM_REPO="$TEST_TMP/non-pm-console-repo"
mkdir -p "$PM_REPO/.git" "$PM_REPO/.claude" "$NON_PM_REPO/.git"
printf 'ref: refs/heads/main\n' > "$PM_REPO/.git/HEAD"
printf 'ref: refs/heads/main\n' > "$NON_PM_REPO/.git/HEAD"
printf '{"schema":"autopilot.console/1","mode":"program"}\n' > "$PM_REPO/.claude/console.json"

unset AUTOPILOT_DISPATCH_ROLE
FLEET_STUB_OPEN="$TEST_TMP/fleet-open"
FLEET_STUB_DONE="$TEST_TMP/fleet-done"
FLEET_STUB_NF="$TEST_TMP/fleet-nf"
FLEET_STUB_COURIER_NF="$TEST_TMP/fleet-courier-nf"
printf '#!/usr/bin/env bash\nprintf '\''{"id":"%s","status":"open"}\\n'\'' "$3"\n' "$PM_TASK_ID" > "$FLEET_STUB_OPEN"
printf '#!/usr/bin/env bash\nprintf '\''{"id":"%s","status":"done"}\\n'\'' "$3"\n' "$PM_TASK_ID" > "$FLEET_STUB_DONE"
printf '#!/usr/bin/env bash\nprintf '\''{"error":"not_found"}\\n'\'' ; exit 1\n' > "$FLEET_STUB_NF"
cat > "$FLEET_STUB_COURIER_NF" <<'EOF'
#!/usr/bin/env bash
printf "fleet: no task '%s' in this courier's table\n" "$3" >&2
exit 1
EOF
chmod +x "$FLEET_STUB_OPEN" "$FLEET_STUB_DONE" "$FLEET_STUB_NF" "$FLEET_STUB_COURIER_NF"

# Haiku work dispatches must bind an open task; read-only Explore stays exempt.
PAYLOAD_HAIKU='{"tool_name":"Agent","tool_input":{"model":"haiku","subagent_type":"general-purpose","prompt":"Engine: haiku\nFleet-Task: '"$PM_TASK_ID"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_NF" run_hook dispatch-model-guard.js "$PAYLOAD_HAIKU"
assert_contains "$__RUN_STDOUT" 'not_found' "pm-fleet-haiku-not-found denies"
FLEET_BIN="$FLEET_STUB_DONE" run_hook dispatch-model-guard.js "$PAYLOAD_HAIKU"
assert_contains "$__RUN_STDOUT" 'is closed' "pm-fleet-haiku-done denies"
PAYLOAD_HAIKU_MISSING='{"tool_name":"Agent","tool_input":{"model":"haiku","subagent_type":"general-purpose","prompt":"Engine: haiku\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_HAIKU_MISSING"
assert_contains "$__RUN_STDOUT" 'missing Fleet-Task' "pm-fleet-haiku-missing denies"
PAYLOAD_HAIKU_EXPLORE='{"tool_name":"Agent","tool_input":{"model":"haiku","subagent_type":"Explore","prompt":"Engine: haiku\nRead files."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_HAIKU_EXPLORE"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-haiku-explore exempt"

# 1. missing id -> deny (zh-TW with fleet task show + Fleet-Task + first 10 lines)
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"general-purpose","prompt":"Engine: sonnet\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "pm-fleet-missing-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-missing denies"
assert_contains "$__RUN_STDOUT" "fleet task show" "pm-fleet-missing names fleet task show"
assert_contains "$__RUN_STDOUT" "Fleet-Task:" "pm-fleet-missing names Fleet-Task"

# Fleet-Task below first 10 lines -> still deny
TEN_PAD='\n2\n3\n4\n5\n6\n7\n8\n9\n10\nFleet-Task: '"$PM_TASK_ID"''
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"general-purpose","prompt":"Engine: sonnet'"$TEN_PAD"'"},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-past-head10 denies"

# 2. stub done -> deny
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"general-purpose","prompt":"Engine: sonnet\nFleet-Task: '"$PM_TASK_ID"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_DONE" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-done denies"

# 3. stub not_found -> deny
FLEET_BIN="$FLEET_STUB_NF" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-not-found denies"

FLEET_BIN="$FLEET_STUB_COURIER_NF" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-courier-not-found denies"
assert_contains "$__RUN_STDOUT" 'not_found' "pm-fleet-courier-not-found explains"

# 4. stub open -> allow
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "pm-fleet-open-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-open allows"

# 5. Explore / Plan without id -> allow
PAYLOAD_EXPLORE='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"Explore","prompt":"Engine: sonnet\nRead files."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_EXPLORE"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-explore exempt"
PAYLOAD_PLAN='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"Plan","prompt":"Engine: sonnet\nPlan work."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_PLAN"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-plan exempt"

# 5b. brief without Engine: (with require_engine_header: off) -> allow
printf '%s\n' "- require_engine_header: off" > "$TEST_TMP/config-no-engine.md"
PAYLOAD_NO_ENG='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"general-purpose","prompt":"Just do a quick read without Engine header."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-no-engine.md" FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_NO_ENG"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-no-engine exempt"

# 6. FLEET_BIN missing binary -> allow (fail-open + stderr note)
FLEET_BIN="/nonexistent/fleet-binary-missing-check" run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "pm-fleet-unavailable-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-fleet-unavailable allows (fail-open)"
assert_contains "$__RUN_STDERR" "unavailable" "pm-fleet-unavailable logs stderr note"

# 7. non-PM console without id -> allow
PAYLOAD_NONPM='{"tool_name":"Agent","tool_input":{"model":"sonnet","subagent_type":"general-purpose","prompt":"Engine: sonnet\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$NON_PM_REPO"'"}'
FLEET_BIN="$FLEET_STUB_OPEN" run_hook dispatch-model-guard.js "$PAYLOAD_NONPM"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "non-pm-console now denied without id (P4: all seats)"
# Later sections test other guards: back to an exempt caller.
export AUTOPILOT_DISPATCH_ROLE=probe-model-guard-test

# 8. Brain-tier dispatch JSONL ledger: opus with Model-Reason appends allowed:true; without Model-Reason appends allowed:false
STATE_DIR_LEDGER="$TEST_TMP/ledger-state"
mkdir -p "$STATE_DIR_LEDGER"
PAYLOAD_OPUS_OK='{"session_id":"sess-ledger-1","tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus\nRole: architect\nLane: core\n'"$COST_FABLE_OPUS"'\nModel-Reason: architecture decision\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_STATE_DIR="$STATE_DIR_LEDGER" run_hook dispatch-model-guard.js "$PAYLOAD_OPUS_OK"
assert_eq 0 "$__RUN_EXIT" "ledger-opus-ok-exit"
assert_eq "" "$__RUN_STDOUT" "ledger-opus-ok-silent"
PAYLOAD_OPUS_NO='{"session_id":"sess-ledger-1","tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus\nRole: architect\nLane: core\n'"$COST_FABLE_OPUS"'\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_STATE_DIR="$STATE_DIR_LEDGER" run_hook dispatch-model-guard.js "$PAYLOAD_OPUS_NO"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "ledger-opus-no-deny"
LEDGER_CHECK="$(node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (lines.length !== 2) process.exit(2);
  if (lines[0].lane !== "core" || lines[0].model !== "opus" || lines[0].reason !== "architecture decision" || lines[0].allowed !== true) process.exit(3);
  if (lines[1].lane !== "core" || lines[1].model !== "opus" || lines[1].reason !== null || lines[1].allowed !== false) process.exit(4);
  process.stdout.write("ledger_ok");
' "$STATE_DIR_LEDGER/brain-tier-dispatch.jsonl")"
assert_eq "ledger_ok" "$LEDGER_CHECK" "ledger-jsonl-entries"
# 8. undetermined PM seat on Agent -> allows and prints single warning line to stderr
UNDET_DIR="$TEST_TMP/undetermined-seat"
mkdir -p "$UNDET_DIR"
PAYLOAD_UNDET='{"tool_name":"Agent","tool_input":{"model":"haiku","subagent_type":"general-purpose","prompt":"Engine: haiku\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$UNDET_DIR"'"}'
FLEET_BIN="/nonexistent/fleet-binary-missing-check" run_hook dispatch-model-guard.js "$PAYLOAD_UNDET"
assert_eq 0 "$__RUN_EXIT" "pm-seat-undetermined-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-seat-undetermined allows"
assert_contains "$__RUN_STDERR" "pm-console: cannot determine PM seat (no console.json mode, no fleet address)" "pm-seat-undetermined logs warning"

# Overloaded Claude pool + mechanical subagent cases
PACE_OVERLOADED="$TEST_TMP/pace-overloaded.json"
cat > "$PACE_OVERLOADED" <<'EOF'
{"schema":"capacity.pace/1","burn_more":{"targets_in_order":["agy","minimax"]},"rows":[{"pool":"claude","class":"claude","used_pct":90,"status":"ALERT_ahead"},{"pool":"agy","class":"other","used_pct":20}]}
EOF
PACE_OK="$TEST_TMP/pace-ok.json"
cat > "$PACE_OK" <<'EOF'
{"schema":"capacity.pace/1","burn_more":{"targets_in_order":["agy","minimax"]},"rows":[{"pool":"claude","class":"claude","used_pct":30,"status":"ok"},{"pool":"agy","class":"other","used_pct":20}]}
EOF

PAYLOAD_MECH='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nRole: implementer\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" run_hook dispatch-model-guard.js "$PAYLOAD_MECH"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-mechanical-blocks"
assert_contains "$__RUN_STDOUT" "agy" "overloaded-claude-mechanical-names-agy"

AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=warn run_hook dispatch-model-guard.js "$PAYLOAD_MECH"
assert_eq 0 "$__RUN_EXIT" "overloaded-claude-mechanical-warn-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-mechanical-warn-no-deny"
assert_contains "$__RUN_STDOUT" "agy" "overloaded-claude-mechanical-warn-names-agy"

PAYLOAD_NONMECH='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nRole: reviewer\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" run_hook dispatch-model-guard.js "$PAYLOAD_NONMECH"
assert_eq 0 "$__RUN_EXIT" "overloaded-claude-nonmechanical-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-nonmechanical-allowed"

AUTOPILOT_PACE_FILE="$PACE_OK" run_hook dispatch-model-guard.js "$PAYLOAD_MECH"
assert_eq 0 "$__RUN_EXIT" "nonoverloaded-claude-mechanical-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "nonoverloaded-claude-mechanical-allowed"

# agy at or above hetero reserve line (50%) -> skipped in favor of minimax
PACE_AGY_RESERVE="$TEST_TMP/pace-agy-reserve.json"
cat > "$PACE_AGY_RESERVE" <<'EOF'
{"schema":"capacity.pace/1","burn_more":{"targets_in_order":["agy","minimax"]},"rows":[{"pool":"claude","class":"claude","used_pct":90,"status":"ALERT_ahead"},{"pool":"agy","class":"other","used_pct":55},{"pool":"minimax","class":"other","used_pct":20}]}
EOF
AUTOPILOT_PACE_FILE="$PACE_AGY_RESERVE" run_hook dispatch-model-guard.js "$PAYLOAD_MECH"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-mechanical-agy-reserve-blocks"
assert_contains "$__RUN_STDOUT" "minimax" "overloaded-claude-mechanical-agy-reserve-skips-agy"

# stale generated_at (> 24h old) -> treated as stale, does nothing
PACE_STALE_GEN="$TEST_TMP/pace-stale-gen.json"
cat > "$PACE_STALE_GEN" <<'EOF'
{"schema":"capacity.pace/1","generated_at":"2020-01-01T00:00:00Z","burn_more":{"targets_in_order":["agy","minimax"]},"rows":[{"pool":"claude","class":"claude","used_pct":90,"status":"ALERT_ahead"},{"pool":"agy","class":"other","used_pct":20}]}
EOF
AUTOPILOT_PACE_FILE="$PACE_STALE_GEN" run_hook dispatch-model-guard.js "$PAYLOAD_MECH"
assert_eq 0 "$__RUN_EXIT" "overloaded-claude-mechanical-stale-gen-exit"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-mechanical-stale-gen-allowed"

# Private lane (default 308) + overloaded Claude pool -> never suggests non-Claude engines
PAYLOAD_MECH_308='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nRole: implementer\nLane: 308\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" run_hook dispatch-model-guard.js "$PAYLOAD_MECH_308"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-private-lane-308-blocks"
assert_not_contains "$__RUN_STDOUT" "agy" "overloaded-claude-private-lane-308-no-agy"
assert_not_contains "$__RUN_STDOUT" "minimax" "overloaded-claude-private-lane-308-no-minimax"
assert_contains "$__RUN_STDOUT" "僅限 Claude" "overloaded-claude-private-lane-308-claude-only"

# Non-private lane (autopilot) + overloaded Claude pool -> unchanged behavior (suggests agy)
PAYLOAD_MECH_AUTOPILOT='{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\nRole: implementer\nLane: autopilot\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" run_hook dispatch-model-guard.js "$PAYLOAD_MECH_AUTOPILOT"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-nonprivate-lane-blocks"
assert_contains "$__RUN_STDOUT" "agy" "overloaded-claude-nonprivate-lane-names-agy"

# Empty AUTOPILOT_DISPATCH_MODEL_GUARD_PRIVATE_LANES -> falls back to current logic
AUTOPILOT_PACE_FILE="$PACE_OVERLOADED" AUTOPILOT_DISPATCH_MODEL_GUARD_PRIVATE_LANES="" run_hook dispatch-model-guard.js "$PAYLOAD_MECH_308"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "overloaded-claude-empty-private-lanes-blocks"
assert_contains "$__RUN_STDOUT" "agy" "overloaded-claude-empty-private-lanes-names-agy"

finalize_test
