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
export AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM='2020-01-01T00:00:00Z'
POLLHITS="$HOOK_HOME/.autopilot/foreman-guard/poll-hits.jsonl"

EVENTS_JSONL="$XDG_RUNTIME_DIR/autopilot/foreman-guard/events.jsonl"

REPO="$FG_TMP_ROOT/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
unset AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID
set_marker() { node "$REPO_ROOT/scripts/session-mode.js" set --level "$1" --repo-root "$REPO" >/dev/null 2>&1 || fail "marker set $1"; }
reset_guard_state() { rm -f "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.json "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.lock; }

TRANSCRIPT_ROOT="$FG_TMP_ROOT/transcripts"
TRANSCRIPT_PATH="$TRANSCRIPT_ROOT/root.jsonl"
mkdir -p "$TRANSCRIPT_ROOT"
printf '%s\n' '{}' > "$TRANSCRIPT_PATH"

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

write_engine_brief() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(process.argv[1], "fg-all-sub-session", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const rec = {
      type: "user",
      agentId: process.argv[2],
      sessionId: "fg-all-sub-session",
      message: { content: process.argv[3] },
    };
    fs.writeFileSync(path.join(dir, `agent-${process.argv[2]}.jsonl`), JSON.stringify(rec) + "\n");
  ' "$TRANSCRIPT_ROOT" "$1" "$2"
}

engine_bash_payload() {
  local agent="$1" cmd="$2"
  json_str "$cmd"
  printf '{"tool_name":"Bash","agent_id":"%s","session_id":"fg-all-sub-session","transcript_path":"%s","tool_input":{"command":%s,"run_in_background":false},"hook_event_name":"PreToolUse","cwd":"%s"}' \
    "$agent" "$TRANSCRIPT_PATH" "$REPLY" "$REPO"
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

# ── (a) depth-0, enforce date in the future: allowed, warn, one poll-hit ──
reset_events
rm -f "$POLLHITS"
export AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM='2099-01-01T00:00:00+08:00'
run_hook foreman-guard.js "$(depth0_payload 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "depth-0 future: exit 0"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "depth-0 future: allowed"
assert_contains "$__RUN_STDERR" 'warn (blocking from' "depth-0 future: stderr warn prefix"
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.trim().split("\n");
  if (lines.length !== 1) { console.error("lines " + lines.length); process.exit(1); }
  const row = JSON.parse(lines[0]);
  if (row.agent_id !== null) process.exit(2);
  if (row.mode !== "warn") process.exit(3);
  if (row.rule !== "sleep") process.exit(4);
  if (row.session_id !== "fg-all-sub-session") process.exit(5);
  if (typeof row.ts !== "string" || !row.ts) process.exit(6);
  if (/sleep 30/.test(raw)) process.exit(7);
' "$POLLHITS" || fail "depth-0 future: poll-hits line"

# ── (b) depth-0, enforce date in the past: denied ──
reset_events
rm -f "$POLLHITS"
export AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM='2020-01-01T00:00:00Z'
run_hook foreman-guard.js "$(depth0_payload 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "depth-0 past: exit 0"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "depth-0 past: denied"
node -e '
  const fs = require("fs");
  const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim().split("\n").pop());
  if (row.agent_id !== null || row.mode !== "deny" || row.rule !== "sleep") process.exit(1);
' "$POLLHITS" || fail "depth-0 past: poll-hits mode deny"

# ── (c) subagent, enforce date in the past: denied as before ──
clear_marker
reset_events
rm -f "$POLLHITS"
export AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM='2020-01-01T00:00:00Z'
run_hook foreman-guard.js "$(bash_payload agent-past 'sleep 30')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "subagent past: denied"
assert_event_line "subagent past deny" "agent-past" "sleep" "deny"
node -e '
  const fs = require("fs");
  const row = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim().split("\n").pop());
  if (row.agent_id !== "agent-past" || row.mode !== "deny") process.exit(1);
' "$POLLHITS" || fail "subagent past: poll-hits mode deny"

# ── (d) poll_scope=foreman, depth-0: inert, no poll-hits line ──
clear_marker
reset_events
rm -f "$POLLHITS"
export AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE=foreman
export AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM='2020-01-01T00:00:00Z'
run_hook foreman-guard.js "$(depth0_payload 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "foreman scope depth-0: exit 0"
assert_eq "" "$__RUN_STDOUT" "foreman scope depth-0: inert"
assert_file_absent "$EVENTS_JSONL" "foreman scope depth-0: no events"
assert_file_absent "$POLLHITS" "foreman scope depth-0: no poll-hits"
unset AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE

# ── no marker: ordinary git status allowed; no bash-cap deny ──
clear_marker
reset_events
run_hook foreman-guard.js "$(bash_payload agent-ok 'git status')"
assert_eq 0 "$__RUN_EXIT" "git status: exit 0"
assert_eq "" "$__RUN_STDOUT" "git status: allowed"
assert_not_contains "$__RUN_STDOUT" 'exceeds the' "git status: bash cap not applied"
assert_file_absent "$EVENTS_JSONL" "git status: no poll event"

# ── no marker: Engine subagent advisory logs no_marker_advice ──
clear_marker
reset_events
reset_guard_state
write_engine_brief agent-adv $'Engine: test\nRole: worker\nDo work.'
export AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY=2
run_hook foreman-guard.js "$(engine_bash_payload agent-adv 'git status')"
run_hook foreman-guard.js "$(engine_bash_payload agent-adv 'git status')"
assert_event_line "no marker advice" "agent-adv" "no_marker_advice" "advise"
unset AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY

# ── l4 marker: bash-cap deny logs bash_cap ──
clear_marker
reset_events
reset_guard_state
set_marker l4
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
export AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS=0
run_hook foreman-guard.js "$(bash_payload agent-cap 'echo 1')"
run_hook foreman-guard.js "$(bash_payload agent-cap 'echo 2')"
run_hook foreman-guard.js "$(bash_payload agent-cap 'echo 3')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "bash_cap: third call denied"
assert_event_line "bash_cap deny" "agent-cap" "bash_cap" "deny"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS

# ── l4 marker: context-ceiling deny logs context_ceiling ──
clear_marker
reset_events
reset_guard_state
set_marker l4
LIVE_DIR="$(mktemp -d "$FG_TMP_ROOT/live-XXXXXX")"
mkdir -p "$LIVE_DIR/context"
export AUTOPILOT_LIVE_DIR="$LIVE_DIR"
node -e '
  const fs = require("fs");
  const [, sid, dir] = process.argv;
  const obj = {
    schema_version: 1,
    session_id: sid,
    written_at: new Date().toISOString(),
    tasks: [{ id: "agent-ceil", tokenCount: 160000, contextWindowSize: 200000 }],
  };
  fs.writeFileSync(`${dir}/context/${sid}.tasks.json`, JSON.stringify(obj));
' fg-all-sub-session "$LIVE_DIR"
run_hook foreman-guard.js "$(bash_payload agent-ceil 'echo work')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "context_ceiling: denied"
assert_event_line "context_ceiling deny" "agent-ceil" "context_ceiling" "deny"
unset AUTOPILOT_LIVE_DIR

# ── l4 marker: reserve deny logs reserve; allowlisted logs reserve_advice ──
clear_marker
reset_events
reset_guard_state
set_marker l4
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=5
run_hook foreman-guard.js "$(bash_payload agent-res 'echo 1')"
run_hook foreman-guard.js "$(bash_payload agent-res 'echo 2')"
run_hook foreman-guard.js "$(bash_payload agent-res 'echo 3')"
run_hook foreman-guard.js "$(bash_payload agent-res 'git status')"
assert_event_line "reserve_advice" "agent-res" "reserve_advice" "advise"
reset_events
reset_guard_state
set_marker l4
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=5
run_hook foreman-guard.js "$(bash_payload agent-res2 'echo 1')"
run_hook foreman-guard.js "$(bash_payload agent-res2 'echo 2')"
run_hook foreman-guard.js "$(bash_payload agent-res2 'echo 3')"
run_hook foreman-guard.js "$(bash_payload agent-res2 'npm test')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "reserve: non-allowlisted denied"
assert_event_line "reserve deny" "agent-res2" "reserve" "deny"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

finalize_test