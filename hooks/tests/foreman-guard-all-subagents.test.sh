#!/usr/bin/env bash
# foreman-guard.js — poll_scope=all: polling rules on every subagent (agent_id).
. "$(dirname "$0")/lib.sh"

FG_TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fg-all-subagents-XXXXXX")"
trap 'rm -rf "$FG_TMP_ROOT"' EXIT

export XDG_RUNTIME_DIR="$FG_TMP_ROOT/runtime"
export HOME="$FG_TMP_ROOT/home"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$FG_TMP_ROOT/foreman-guard" "$FG_TMP_ROOT/session-mode"
export AUTOPILOT_FOREMAN_GUARD_DIR="$FG_TMP_ROOT/foreman-guard"
export AUTOPILOT_SESSION_MODE_DIR="$FG_TMP_ROOT/session-mode"
export AUTOPILOT_SESSION_ID="fg-all-sub-session"
unset AUTOPILOT_FOREMAN_GUARD_MODE AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE

EVENTS_JSONL="$XDG_RUNTIME_DIR/autopilot/foreman-guard/events.jsonl"

REPO="$FG_TMP_ROOT/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q

clear_marker() { rm -f "$AUTOPILOT_SESSION_MODE_DIR"/*.json; }
reset_events() { rm -f "$EVENTS_JSONL"; mkdir -p "$(dirname "$EVENTS_JSONL")"; }

json_str() {
  local s="$1" out="" i c n
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  REPLY="\"$s\""
}

bash_payload() {
  local agent="$1" cmd="$2" bg="${3:-false}"
  json_str "$cmd"
  printf '{"tool_name":"Bash","agent_id":"%s","session_id":"fg-all-sub-session","tool_input":{"command":%s,"run_in_background":%s},"hook_event_name":"PreToolUse","cwd":"%s"}' \
    "$agent" "$REPLY" "$bg" "$REPO"
}

depth0_payload() {
  json_str "$1"
  printf '{"tool_name":"Bash","session_id":"fg-all-sub-session","tool_input":{"command":%s,"run_in_background":false},"hook_event_name":"PreToolUse","cwd":"%s"}' \
    "$REPLY" "$REPO"
}

assert_event_line() {
  local label="$1"
  assert_file_exists "$EVENTS_JSONL" "$label: events.jsonl exists"
  local lines
  lines="$(wc -l < "$EVENTS_JSONL" | tr -d ' ')"
  assert_eq "1" "$lines" "$label: exactly one event line"
  node -e '
    const fs = require("fs");
    const [, file, sid, aid, rule, mode] = process.argv;
    const row = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n").pop());
    const need = { session_id: sid, agent_id: aid, rule, mode };
    for (const [k, v] of Object.entries(need)) {
      if (row[k] !== v) {
        console.error(`field ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(row[k])}`);
        process.exit(1);
      }
    }
    if (typeof row.ts !== "string" || !row.ts) process.exit(2);
    if (!("level" in row)) process.exit(3);
    const raw = fs.readFileSync(file, "utf8");
    if (/sleep 30|tasks\/|\.output/.test(raw)) process.exit(4);
    process.exit(0);
  ' "$EVENTS_JSONL" "fg-all-sub-session" "$2" "$3" "$4" || fail "$label: event fields invalid or command text leaked"
}

# ── no marker: leaf-output poll denied ──
clear_marker
reset_events
TASK_OUT="$FG_TMP_ROOT/tasks/x.output"
mkdir -p "$(dirname "$TASK_OUT")"
touch "$TASK_OUT"
run_hook foreman-guard.js "$(bash_payload agent-nm "sleep 30; cat $TASK_OUT")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "no marker poll: denied"
assert_contains "$__RUN_STDOUT" 'run_in_background' "no marker poll: mentions run_in_background"
assert_event_line "no marker poll deny" "agent-nm" "sleep" "deny"

# ── poll_scope=foreman: no marker poll allowed (legacy) ──
clear_marker
reset_events
export AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE=foreman
run_hook foreman-guard.js "$(bash_payload agent-leg "sleep 30")"
assert_eq 0 "$__RUN_EXIT" "foreman scope no marker: exit 0"
assert_eq "" "$__RUN_STDOUT" "foreman scope no marker: no deny"
assert_file_absent "$EVENTS_JSONL" "foreman scope: no events"
unset AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE

# ── depth-0 (no agent_id): inert ──
reset_events
run_hook foreman-guard.js "$(depth0_payload 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "depth-0: exit 0"
assert_eq "" "$__RUN_STDOUT" "depth-0: empty stdout"
assert_file_absent "$EVENTS_JSONL" "depth-0: no events"

# ── no marker: ordinary git status allowed; no bash-cap deny ──
clear_marker
reset_events
run_hook foreman-guard.js "$(bash_payload agent-ok 'git status')"
assert_eq 0 "$__RUN_EXIT" "git status: exit 0"
assert_eq "" "$__RUN_STDOUT" "git status: allowed"
assert_not_contains "$__RUN_STDOUT" 'exceeds the' "git status: bash cap not applied"
assert_file_absent "$EVENTS_JSONL" "git status: no poll event"

finalize_test