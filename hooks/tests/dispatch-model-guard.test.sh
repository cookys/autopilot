#!/usr/bin/env bash
# RED at 895b778d3: no model with first line "Engine: sonnet" still lists engine (missingBriefHeaders exited 2). 92 passed, 1 failed.
# RED at 48aa19a3fdc8eb21ab3a1036dbc7a32a6a61e0ef: 87 passed, 4 failed — both-missing deny had no "Lane:", no three-line template, and did not name subagent-budget.
# Test for dispatch-model-guard.js hook
. "$(dirname "$0")/lib.sh"

# Exact fable/opus Cost line. Existing fable/opus fixtures include it so they
# still reach the guarded-engine check; the costline cases below omit it.
COST_FABLE_OPUS="$(node -e 'process.stdout.write(require(process.argv[1]).costLineFor("opus"))' "$REPO_ROOT/hooks/lib/brief-header-template.js")"

# Case 1: default-on since v2.35.15 — the opt-OUT env silences it; without it the guard fires
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case1-exit"
assert_eq "" "$__RUN_STDOUT" "case1-silent (opt-out env)"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case1b-default-on fires without any enable flag (remind = deny with reminder, v2.36.9)"
assert_contains "$__RUN_STDOUT" "intentional" "case1b-reminder names the acknowledgement path"

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

# Case 6: Enabled, model absent → DENY (v2.36.2; was ask) with "no model specified" — the
# model re-dispatches on its own; no permission dialog for the owner to click through.
printf '%s\n' "- require_engine_header: off" > "$TEST_TMP/config6.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6-deny (missing model is self-correctable, never a dialog)"
assert_contains "$__RUN_STDOUT" "no model specified" "case6-reason"
assert_contains "$__RUN_STDOUT" "re-dispatch" "case6-reason names the corrective action"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6b: on_missing_model: ask keeps the pre-v2.36.2 dialog
printf '%s\n' "- on_missing_model: ask" "- require_engine_header: off" > "$TEST_TMP/config6b.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6b.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "case6b-ask (opt back into the dialog)"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6c: garbage on_missing_model → deny (fail-closed to the self-correcting decision)
printf '%s\n' "- on_missing_model: maybe" "- require_engine_header: off" > "$TEST_TMP/config6c.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6c.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6c-deny (garbage → deny)"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6d: mode: warn + missing model → stderr only, no decision
printf '%s\n' "- mode: warn" "- require_engine_header: off" > "$TEST_TMP/config6d.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6d.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"hookEventName":"PreToolUse"' "case6d-stdout advisory envelope"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "case6d-stdout additionalContext"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "case6d-warn never permissionDecision"
assert_contains "$__RUN_STDERR" "no model specified" "case6d-stderr warning"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# Case 6e (v2.36.9): guarded engine ACKNOWLEDGED on the Engine header → allowed silently
# (stderr note only). The agent judged; no dialog, no deny.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable (intentional: plan critique needs the strongest reader)\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "case6e-exit"
assert_eq "" "$__RUN_STDOUT" "case6e-silent stdout (acknowledged expensive dispatch proceeds)"
assert_contains "$__RUN_STDERR" "acknowledged as intentional" "case6e-stderr note"

# Case 6f (v2.36.9): the acknowledgement must sit on the Engine header line — an
# "intentional" further down the prompt does not count.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable\n'"$COST_FABLE_OPUS"'\nThis is (intentional: really).\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "case6f-deny (ack not on line 1)"

# Case 6g (v2.36.9): mode: ask opts back into the interactive dialog for guarded engines
printf '%s\n' "- mode: ask" > "$TEST_TMP/config6g.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config6g.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable@agy effort=low\n'"$COST_FABLE_OPUS"'\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
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

# Case 14: mode: "plan", model: "opus" → allowed (no ask/deny)
# Plan-mode opus is a reviewer/debugger dispatch and must NOT be guarded by the new guarded_models_implementing default.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus@agy effort=low\n'"$COST_FABLE_OPUS"'\nReview this code."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
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

# opus with the Cost line and an intentional Engine header → allowed (other checks allow).
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"Engine: opus (intentional: hardest judgment only)\nRole: worker\nLane: alpha\n'"$COST_FABLE_OPUS"'\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
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

# require_cost_line: off → no deny, even for intentional fable without a Cost line.
printf '%s\n' "- require_cost_line: off" > "$TEST_TMP/config-cost-off.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-off.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"Engine: fable (intentional: x)\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
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

# model absent, on_missing_model allow: the Engine token is the effective model.
printf '%s\n' "- on_missing_model: allow" > "$TEST_TMP/config-cost-engine.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-engine.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: claude-fable-5-2\nRole: worker\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-engine-token denies fable full id with no model field"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-engine-token gives the exact line"
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: opus\nRole: worker\nLane: alpha\n'"$COST_FABLE_OPUS"'\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq "" "$__RUN_STDOUT" "costline-engine-token with the line is allowed when model is absent"
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: sonnet\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq "" "$__RUN_STDOUT" "costline-engine-token sonnet is not denied"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# model omitted + Engine: opus + no Cost line, on_missing_model: ask → deny, not ask.
printf '%s\n' "- on_missing_model: ask" > "$TEST_TMP/config-cost-ask.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-ask.md"
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: opus\nRole: worker\nLane: alpha\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-absent-ask-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-absent-ask denies"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "costline-absent-ask is not an ask"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-absent-ask gives the exact line"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# model omitted + Engine: opus + no Cost line, default on_missing_model deny → exact Cost line.
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: opus\nRole: worker\nLane: alpha\nDo the hard judgment."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-absent-deny-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-absent-deny denies"
assert_contains "$__RUN_STDOUT" "add this line within the first 6 lines: ${COST_FABLE_OPUS}" "costline-absent-deny gives the exact line"

# model omitted + Engine: sonnet + no Cost line stays the missing-model policy
# (default deny names "no model specified"; ask stays ask). Not a cost deny.
PAYLOAD='{"tool_name":"Agent","tool_input":{"prompt":"Engine: sonnet\nRole: worker\nLane: alpha\nDo work."},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_eq 0 "$__RUN_EXIT" "costline-absent-sonnet-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-absent-sonnet still denies for a missing model"
assert_contains "$__RUN_STDOUT" "no model specified" "costline-absent-sonnet keeps the missing-model reason"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-absent-sonnet is not a cost deny"
printf '%s\n' "- on_missing_model: ask" > "$TEST_TMP/config-cost-ask-sonnet.md"
export DISPATCH_GUARD_CONFIG_OVERRIDE="$TEST_TMP/config-cost-ask-sonnet.md"
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"ask"' "costline-absent-sonnet-ask stays ask"
assert_contains "$__RUN_STDOUT" "no model specified" "costline-absent-sonnet-ask keeps the missing-model reason"
assert_not_contains "$__RUN_STDOUT" "require_cost_line" "costline-absent-sonnet-ask is not a cost deny"
unset DISPATCH_GUARD_CONFIG_OVERRIDE

# A Cost line on line 7 does not count. Line 6 does. Intentional would otherwise allow.
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\nStages: build,review,merged\n'"$COST_FABLE_OPUS"'"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
run_hook dispatch-model-guard.js "$PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "costline-line7 does not count"
PAYLOAD='{"tool_name":"Agent","tool_input":{"model":"opus","mode":"plan","prompt":"Engine: opus\nRole: worker\nLane: alpha\nSize: S\nUsed-by: e2e\n'"$COST_FABLE_OPUS"'\nStages: build,review,merged"},"hook_event_name":"PreToolUse","cwd":"'"$TEST_TMP"'"}'
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

finalize_test
