#!/usr/bin/env bash
# foreman-guard.js — P1: warn/diagnostic advisories reach the model via additionalContext.
. "$(dirname "$0")/lib.sh"

export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_FOREMAN_GUARD_DIR="$TEST_TMP/foreman-guard"
export AUTOPILOT_SESSION_ID="fg-test-session"
unset AUTOPILOT_FOREMAN_GUARD_MODE AUTOPILOT_FOREMAN_GUARD_BASH_CAP
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$AUTOPILOT_FOREMAN_GUARD_DIR"

REPO="$TEST_TMP/repo"; mkdir -p "$REPO"; git -C "$REPO" init -q
set_marker() { node "$REPO_ROOT/scripts/session-mode.js" set --level "$1" --repo-root "$REPO" >/dev/null 2>&1 || fail "marker set $1"; }
clear_marker() { rm -f "$AUTOPILOT_SESSION_MODE_DIR"/*.json; }
reset_state() { rm -f "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.json; }

bash_payload() { # <agent_id|""> <command> [background]
  local agent="$1" cmd="$2" bg="${3:-false}" aid=""
  [ -n "$agent" ] && aid="\"agent_id\":\"$agent\","
  printf '{"tool_name":"Bash",%s"session_id":"fg-test-session","tool_input":{"command":%s,"run_in_background":%s},"hook_event_name":"PreToolUse","cwd":"%s"}' \
    "$aid" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")" "$bg" "$REPO"
}
monitor_payload() { printf '{"tool_name":"Monitor","agent_id":"%s","session_id":"fg-test-session","tool_input":{"command":"tail -f x"},"hook_event_name":"PreToolUse"}' "$1"; }

# RED at 93189f4f:
# FAIL [foreman-guard-roles] warn poll: stdout has hookSpecificOutput: 'hookSpecificOutput' not found in output
# FAIL [foreman-guard-roles] warn poll: stdout has additionalContext: 'additionalContext' not found in output
# FAIL [foreman-guard-roles] warn poll: permissionDecision allow: '"permissionDecision":"allow"' not found in output
# FAIL [foreman-guard-roles] warn over-cap: stdout has hookSpecificOutput: 'hookSpecificOutput' not found in output
# FAIL [foreman-guard-roles] warn over-cap: stdout has additionalContext: 'additionalContext' not found in output
# FAIL [foreman-guard-roles] warn over-cap: permissionDecision allow: '"permissionDecision":"allow"' not found in output
# FAIL [foreman-guard-roles] 0-row diagnostic: stdout has hookSpecificOutput: 'hookSpecificOutput' not found in output
# FAIL [foreman-guard-roles] 0-row diagnostic: stdout has additionalContext: 'additionalContext' not found in output
# FAIL [foreman-guard-roles] 0-row diagnostic: permissionDecision allow: '"permissionDecision":"allow"' not found in output
# FAIL [foreman-guard-roles] 0-row diagnostic: additionalContext carries diagnostic text: '0 tasks[] row' not found in output
# FAIL [foreman-guard-roles] 2-row diagnostic: stdout has hookSpecificOutput: 'hookSpecificOutput' not found in output
# FAIL [foreman-guard-roles] 2-row diagnostic: stdout has additionalContext: 'additionalContext' not found in output
# FAIL [foreman-guard-roles] 2-row diagnostic: permissionDecision allow: '"permissionDecision":"allow"' not found in output
# FAIL [foreman-guard-roles] 2-row diagnostic: additionalContext carries diagnostic text: '2 tasks[] row' not found in output
# FAIL [foreman-guard-roles] 12 passed, 14 failed

# ── P1: mode=warn denial-worthy call also emits additionalContext on ALLOW ──
set_marker l4
reset_state
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "warn poll: exit 0"
assert_contains "$__RUN_STDERR" 'mode=warn' "warn poll: stderr copy still present"
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "warn poll: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "warn poll: stdout has additionalContext"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"allow"' "warn poll: permissionDecision allow"

reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=1
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-2 'echo 1')"
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-2 'echo 2')"
assert_eq 0 "$__RUN_EXIT" "warn over-cap: exit 0"
assert_contains "$__RUN_STDERR" 'mode=warn' "warn over-cap: stderr copy still present"
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "warn over-cap: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "warn over-cap: stdout has additionalContext"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"allow"' "warn over-cap: permissionDecision allow"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── P1: ambiguous-rows diagnostic also emits additionalContext; still deduped ──
LIVE_DIR="$(mktemp -d /dev/shm/fg-guard-live-XXXXXX 2>/dev/null || mktemp -d "$TEST_TMP/live-XXXXXX")"
mkdir -p "$LIVE_DIR/context"
export AUTOPILOT_LIVE_DIR="$LIVE_DIR"

write_tasks() { # <sid> <tasks-json-array>
  node -e '
    const fs = require("fs");
    const [, sid, tasksJson, dir] = process.argv;
    const obj = { schema_version: 1, session_id: sid, written_at: new Date().toISOString(), tasks: JSON.parse(tasksJson) };
    fs.writeFileSync(`${dir}/context/${sid}.tasks.json`, JSON.stringify(obj));
  ' "$1" "$2" "$LIVE_DIR"
}

set_marker l4; reset_state
write_tasks fg-test-session '[{"id":"other-agent","tokenCount":190000,"contextWindowSize":200000}]'
run_hook foreman-guard.js "$(bash_payload agent-1 'echo work')"
assert_eq 0 "$__RUN_EXIT" "0-row diagnostic: exit 0"
assert_contains "$__RUN_STDERR" '0 tasks[] row' "0-row diagnostic: stderr still present"
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "0-row diagnostic: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "0-row diagnostic: stdout has additionalContext"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"allow"' "0-row diagnostic: permissionDecision allow"
assert_contains "$__RUN_STDOUT" '0 tasks[] row' "0-row diagnostic: additionalContext carries diagnostic text"
run_hook foreman-guard.js "$(bash_payload agent-1 'echo work')"
assert_eq "" "$__RUN_STDERR" "0-row diagnostic NOT repeated on stderr"
assert_eq "" "$__RUN_STDOUT" "0-row diagnostic NOT repeated on stdout"

reset_state
write_tasks fg-test-session '[{"id":"agent-1","tokenCount":190000,"contextWindowSize":200000},{"id":"agent-1","tokenCount":10000,"contextWindowSize":200000}]'
run_hook foreman-guard.js "$(bash_payload agent-1 'echo work')"
assert_eq 0 "$__RUN_EXIT" "2-row diagnostic: exit 0"
assert_contains "$__RUN_STDERR" '2 tasks[] row' "2-row diagnostic: stderr still present"
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "2-row diagnostic: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "2-row diagnostic: stdout has additionalContext"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"allow"' "2-row diagnostic: permissionDecision allow"
assert_contains "$__RUN_STDOUT" '2 tasks[] row' "2-row diagnostic: additionalContext carries diagnostic text"
run_hook foreman-guard.js "$(bash_payload agent-1 'echo work')"
assert_eq "" "$__RUN_STDERR" "2-row diagnostic NOT repeated on stderr"
assert_eq "" "$__RUN_STDOUT" "2-row diagnostic NOT repeated on stdout"

unset AUTOPILOT_LIVE_DIR

finalize_test
