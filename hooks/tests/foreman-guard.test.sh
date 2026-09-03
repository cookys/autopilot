#!/usr/bin/env bash
# foreman-guard.js — PreToolUse Bash|Monitor guard for l4/l5/l6 subagents (v2.35.15).
# Scope: marker active (l4|l5|l6) AND payload.agent_id. Rules: Bash cap, foreground
# polling deny, Monitor deny. Modes block|warn|off. Fail-open on garbage.
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

# ── 1. inert outside scope ─────────────────────────────────────────────
clear_marker; reset_state
run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 60')"
assert_eq 0 "$__RUN_EXIT" "no marker: exit 0"
assert_eq "" "$__RUN_STDOUT" "no marker: silent even for a sleep"

set_marker l3
run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 60')"
assert_eq "" "$__RUN_STDOUT" "l3 marker: inert (not an orchestrated session)"

set_marker l4
run_hook foreman-guard.js "$(bash_payload '' 'sleep 60')"
assert_eq "" "$__RUN_STDOUT" "l4 marker but no agent_id (depth-0): inert"
run_hook foreman-guard.js "$(monitor_payload '')"
assert_eq "" "$__RUN_STDOUT" "depth-0 keeps Monitor"

# ── 2. polling deny for a subagent in an l4 session ───────────────────
reset_state
for cmd in 'true' ':' 'sleep 10' 'sleep 240; echo waited' 'while ! grep -q REVIEW out.txt; do sleep 10; done' 'pgrep agy' 'ps -p 1234' 'kill -0 4321' 'tail -c 8000 /home/u/.claude/tasks/abc.output' 'cat /tmp/x/tasks/t1.output | head'; do
  run_hook foreman-guard.js "$(bash_payload agent-1 "$cmd")"
  assert_eq 0 "$__RUN_EXIT" "poll '$cmd': exit 0"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "poll '$cmd' denied"
  assert_contains "$__RUN_STDOUT" 'run_in_background' "poll '$cmd' deny names the sanctioned wait"
done
# background waits are the sanctioned form
run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 600; echo WAKE' true)"
assert_eq "" "$__RUN_STDOUT" "background dead-man sleep is allowed"
run_hook foreman-guard.js "$(bash_payload agent-1 'until grep -q DONE out.txt; do sleep 5; done' true)"
assert_eq "" "$__RUN_STDOUT" "background until-loop is allowed"
# ordinary work is allowed
run_hook foreman-guard.js "$(bash_payload agent-1 'git status --porcelain && npm test')"
assert_eq "" "$__RUN_STDOUT" "ordinary Bash allowed"
run_hook foreman-guard.js "$(bash_payload agent-1 'cat README.md')"
assert_eq "" "$__RUN_STDOUT" "reading a normal file allowed (only /tasks/*.output is a leaf read)"

# ── 3. Monitor denied for a subagent ──────────────────────────────────
run_hook foreman-guard.js "$(monitor_payload agent-1)"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "Monitor denied for a foreman"
assert_contains "$__RUN_STDOUT" 'depth-0 only' "Monitor deny names the rule"

# ── 4. Bash cap: 40 allowed, 41st denied with the handoff directive; per agent ──
reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=5
for i in 1 2 3 4 5; do
  run_hook foreman-guard.js "$(bash_payload agent-2 "echo step $i")"
  assert_eq "" "$__RUN_STDOUT" "call $i within cap allowed"
done
run_hook foreman-guard.js "$(bash_payload agent-2 'echo step 6')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "call 6 over cap denied"
assert_contains "$__RUN_STDOUT" 'handoff' "cap deny carries the handoff directive"
assert_contains "$__RUN_STDOUT" '一刀一命' "cap deny names the lifecycle rule"
run_hook foreman-guard.js "$(bash_payload agent-3 'echo other agent')"
assert_eq "" "$__RUN_STDOUT" "counter is per agent_id"
# polling attempts do not consume cap, cap attempts are recorded
STATE="$(cat "$AUTOPILOT_FOREMAN_GUARD_DIR"/fg-test-session-agent-2.json)"
assert_contains "$STATE" '"bash_calls":6' "state records the over-cap attempt"
assert_contains "$STATE" '"last_denied_rule":"bash-cap"' "state records the rule"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── 5. modes ───────────────────────────────────────────────────────────
reset_state
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 30')"
assert_eq "" "$__RUN_STDOUT" "warn mode: no deny JSON"
assert_contains "$__RUN_STDERR" 'mode=warn' "warn mode: stderr line"
AUTOPILOT_FOREMAN_GUARD_MODE=off run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 30')"
assert_eq "" "$__RUN_STDOUT" "off mode: silent"
assert_eq "" "$__RUN_STDERR" "off mode: no stderr"
# config file mode + cap
mkdir -p "$HOOK_HOME/.autopilot"
printf '{"foreman_guard":{"mode":"warn","bash_cap":2}}' > "$HOOK_HOME/.autopilot/config.json"
reset_state
run_hook foreman-guard.js "$(bash_payload agent-4 'echo 1')"; run_hook foreman-guard.js "$(bash_payload agent-4 'echo 2')"
run_hook foreman-guard.js "$(bash_payload agent-4 'echo 3')"
assert_eq "" "$__RUN_STDOUT" "config warn mode: cap breach is a warning"
assert_contains "$__RUN_STDERR" 'exceeds the foreman cap of 2' "config bash_cap honoured"
rm -f "$HOOK_HOME/.autopilot/config.json"

# ── 6. l5/l6 markers also in scope; expired marker is inert ───────────
for lvl in l5 l6; do
  set_marker "$lvl"; reset_state
  run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 30')"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "$lvl marker in scope"
done
node "$REPO_ROOT/scripts/session-mode.js" set --level l4 --repo-root "$REPO" --ttl-hours 0 >/dev/null 2>&1 || true
sleep 1
run_hook foreman-guard.js "$(bash_payload agent-1 'sleep 30')"
assert_eq "" "$__RUN_STDOUT" "expired marker: inert (fail-open)"

# ── 7. garbage payload: fail-open ─────────────────────────────────────
set_marker l4
run_hook foreman-guard.js '{not json'
assert_eq 0 "$__RUN_EXIT" "garbage payload exit 0"
assert_eq "" "$__RUN_STDOUT" "garbage payload silent"

finalize_test
