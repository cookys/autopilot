#!/usr/bin/env bash
# Acceptance test for P0 opt-in gates: pm-dispatch-plan-guard & work-order-adopt.
. "$(dirname "$0")/../../hooks/tests/lib.sh"

scrub_session_env

# Fixture: sandboxed PM console repo in TEST_TMP (no real ~/.claude or live state)
PM_REPO="$TEST_TMP/pm-repo"
mkdir -p "$PM_REPO/.git" "$PM_REPO/.claude"
: > "$PM_REPO/.git/HEAD"
printf '{"schema":"autopilot.console/1","mode":"program"}\n' > "$PM_REPO/.claude/console.json"

# 1. pm-dispatch-plan-guard:
#    - Negative control: Size M brief without Plan: -> denied when opt-in is enabled
#    - Positive control: Size M brief with Plan: <path>@<sha> -> allowed (silent)
PAYLOAD_NO_PLAN='{"tool_name":"mcp__fleet__dispatch","tool_input":{"to":"dev/worker","task":"Size: M\nImplement feature X."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'
PAYLOAD_WITH_PLAN='{"tool_name":"mcp__fleet__dispatch","tool_input":{"to":"dev/worker","task":"Size: M\nPlan: docs/plans/2026-11-25-plan-to-tasks.md@c7ee75c3\nImplement feature X."},"hook_event_name":"PreToolUse","cwd":"'"$PM_REPO"'"}'

AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD=1 run_hook fleet-send-work-order-guard.js "$PAYLOAD_NO_PLAN"
assert_eq 0 "$__RUN_EXIT" "pm-dispatch-plan-guard-no-plan-exit"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "pm-dispatch-plan-guard-no-plan-deny"
assert_contains "$__RUN_STDOUT" "Plan:" "pm-dispatch-plan-guard-no-plan-reason"

AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD=1 run_hook fleet-send-work-order-guard.js "$PAYLOAD_WITH_PLAN"
assert_eq 0 "$__RUN_EXIT" "pm-dispatch-plan-guard-with-plan-exit"
assert_eq "" "$__RUN_STDOUT" "pm-dispatch-plan-guard-with-plan-allow"

# 2. work-order-adopt:
#    - Negative control: opt-in off -> handle() returns opt_in_off
#    - Positive control: opt-in on with no session marker -> invokes adopt for task_id
ADOPT_PAYLOAD='{"tool_name":"mcp__fleet__task_progress","tool_input":{"task_id":"01M88GP63J9GTMXM23MNW5HSRK"},"session_id":"sess-optin-test","hook_event_name":"PostToolUse","cwd":"'"$PM_REPO"'"}'

ADOPT_OFF_OUT="$(AUTOPILOT_HOOK_WORK_ORDER_ADOPT=0 node -e '
const h = require(process.argv[1]);
const p = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(h.handle(p)));
' "$REPO_ROOT/hooks/work-order-adopt.js" "$ADOPT_PAYLOAD")"
assert_contains "$ADOPT_OFF_OUT" '"adopted":false' "work-order-adopt-off-not-adopted"
assert_contains "$ADOPT_OFF_OUT" '"reason":"opt_in_off"' "work-order-adopt-off-reason"

ADOPT_ON_OUT="$(AUTOPILOT_HOOK_WORK_ORDER_ADOPT=1 node -e '
const h = require(process.argv[1]);
const p = JSON.parse(process.argv[2]);
const res = h.handle(p, { runAdopt: ({ taskId, sessionId }) => { process.stderr.write("adopt:" + taskId + ":" + sessionId + "\n"); } });
process.stdout.write(JSON.stringify(res));
' "$REPO_ROOT/hooks/work-order-adopt.js" "$ADOPT_PAYLOAD" 2>"$TEST_TMP/adopt.stderr")"
assert_contains "$ADOPT_ON_OUT" '"adopted":true' "work-order-adopt-on-adopted"
assert_contains "$ADOPT_ON_OUT" '"taskId":"01M88GP63J9GTMXM23MNW5HSRK"' "work-order-adopt-on-taskid"
assert_contains "$(cat "$TEST_TMP/adopt.stderr")" "adopt:01M88GP63J9GTMXM23MNW5HSRK:sess-optin-test" "work-order-adopt-on-stderr"

# Repo config must actually enable both opt-in gates (settings.json knobs ON).
SETTINGS="$(cat "$REPO_ROOT/.claude/settings.json")"
assert_contains "$SETTINGS" '"AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD": "1"' "settings-enables-pm-dispatch-plan-guard"
assert_contains "$SETTINGS" '"AUTOPILOT_HOOK_WORK_ORDER_ADOPT": "1"' "settings-enables-work-order-adopt"

finalize_test
