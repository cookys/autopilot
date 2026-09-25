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

# RED at b8fc7bac:
# FAIL [foreman-guard-roles] worker call 41 within 120 allowed: expected '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"foreman-guard: Bash call 41 exceeds the foreman cap of 40 (ironlaw #6, 一刀一命). Write your handoff (autopilot:handoff) NOW and end the turn; depth-0 spawns the next foreman for the next deliverable. Resident foremen are forbidden."}}', got ''
# FAIL [foreman-guard-roles] worker deny names worker cap 120: 'exceeds the worker cap of 120' not found in output
# FAIL [foreman-guard-roles] reviewer call 7 denied: '"permissionDecision":"deny"' not found in output
# FAIL [foreman-guard-roles] reviewer env overlay took effect: 'exceeds the reviewer cap of 6' not found in output
# FAIL [foreman-guard-roles] Role on line 5: still under worker default 120 (not foreman cap 2): expected '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"foreman-guard: Bash call 3 exceeds the foreman cap of 2 (ironlaw #6, 一刀一命). Write your handoff (autopilot:handoff) NOW and end the turn; depth-0 spawns the next foreman for the next deliverable. Resident foremen are forbidden."}}', got ''
# FAIL [foreman-guard-roles] malformed worker=abc ignored; reviewer=7 applied: 'exceeds the reviewer cap of 7' not found in output
# FAIL [foreman-guard-roles] poll deny suffix uses reviewer cap: 'Bash call 1/6 spent' not found in output

# ── P2 helpers: transcript_path payload + per-child jsonl ──
TRANSCRIPT_ROOT="$TEST_TMP/transcripts"
TRANSCRIPT_PATH="$TRANSCRIPT_ROOT/root.jsonl"
mkdir -p "$TRANSCRIPT_ROOT"
printf '%s\n' '{}' > "$TRANSCRIPT_PATH"

bash_payload_tx() { # <agent_id> <command> [background]
  local agent="$1" cmd="$2" bg="${3:-false}"
  printf '{"tool_name":"Bash","agent_id":"%s","session_id":"fg-test-session","transcript_path":%s,"tool_input":{"command":%s,"run_in_background":%s},"hook_event_name":"PreToolUse","cwd":"%s"}' \
    "$agent" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$TRANSCRIPT_PATH")" \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")" "$bg" "$REPO"
}

write_child_transcript() { # <agent_id> <content-string>
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [, root, sid, aid, content] = process.argv;
    const dir = path.join(root, sid, "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const rec = { type: "user", agentId: aid, sessionId: sid, message: { content } };
    fs.writeFileSync(path.join(dir, `agent-${aid}.jsonl`), `${JSON.stringify(rec)}\n`);
  ' "$TRANSCRIPT_ROOT" "fg-test-session" "$1" "$2"
}

write_child_transcript_record() { # <agent_id> <json-object-as-text>
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [, root, sid, aid, recJson] = process.argv;
    const dir = path.join(root, sid, "subagents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `agent-${aid}.jsonl`), `${recJson}\n`);
  ' "$TRANSCRIPT_ROOT" "fg-test-session" "$1" "$2"
}

assert_foreman_denies_at_3() { # <label>
  local label="$1"
  export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
  reset_state
  run_hook foreman-guard.js "$(bash_payload_tx "$2" 'echo 1')"
  run_hook foreman-guard.js "$(bash_payload_tx "$2" 'git status')"
  assert_eq 0 "$__RUN_EXIT" "$label: call 2 within foreman cap allowed"
  assert_contains "$__RUN_STDOUT" 'Close-out reserve' "$label: call 2 carries Close-out reserve directive"
  run_hook foreman-guard.js "$(bash_payload_tx "$2" 'echo 3')"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "$label: call 3 denied"
  assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 2' "$label: deny names foreman cap"
  unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP
}

# ── P2: worker allowed to 120, denied at 121 ──
set_marker l4
reset_state
write_child_transcript agent-w 'Role: worker'
for i in $(seq 1 120); do
  if [ "$i" -ge 113 ]; then
    run_hook foreman-guard.js "$(bash_payload_tx agent-w "git status")"
    if [ "$i" -eq 113 ]; then
      assert_contains "$__RUN_STDOUT" 'Close-out reserve' "worker call 113 carries Close-out reserve directive"
    else
      assert_eq "" "$__RUN_STDOUT" "worker call $i within 120 allowed"
    fi
  else
    run_hook foreman-guard.js "$(bash_payload_tx agent-w "echo w $i")"
    assert_eq "" "$__RUN_STDOUT" "worker call $i within 120 allowed"
  fi
done
run_hook foreman-guard.js "$(bash_payload_tx agent-w 'echo w 121')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "worker call 121 denied"
assert_contains "$__RUN_STDOUT" 'exceeds the worker cap of 120' "worker deny names worker cap 120"

# ── P2: env ROLE_CAPS overlays reviewer cap ──
reset_state
write_child_transcript agent-r 'Role: reviewer'
export AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS='reviewer=6'
for i in $(seq 1 6); do
  if [ "$i" -ge 4 ]; then
    run_hook foreman-guard.js "$(bash_payload_tx agent-r "git status")"
    if [ "$i" -eq 4 ]; then
      assert_contains "$__RUN_STDOUT" 'Close-out reserve' "reviewer call 4 carries Close-out reserve directive"
    else
      assert_eq "" "$__RUN_STDOUT" "reviewer call $i within env cap 6 allowed"
    fi
  else
    run_hook foreman-guard.js "$(bash_payload_tx agent-r "echo r $i")"
    assert_eq "" "$__RUN_STDOUT" "reviewer call $i within env cap 6 allowed"
  fi
done
run_hook foreman-guard.js "$(bash_payload_tx agent-r 'echo r 7')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "reviewer call 7 denied"
assert_contains "$__RUN_STDOUT" 'exceeds the reviewer cap of 6' "reviewer env overlay took effect"
unset AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS

# ── P2: Role line on line 6 is ignored; same content on line 5 is worker ──
reset_state
write_child_transcript agent-l6 "$(printf 'L1\nL2\nL3\nL4\nL5\nRole: worker')"
assert_foreman_denies_at_3 "Role on line 6" agent-l6

reset_state
write_child_transcript agent-l5 "$(printf 'L1\nL2\nL3\nL4\nRole: worker')"
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
run_hook foreman-guard.js "$(bash_payload_tx agent-l5 'echo 1')"
run_hook foreman-guard.js "$(bash_payload_tx agent-l5 'echo 2')"
run_hook foreman-guard.js "$(bash_payload_tx agent-l5 'echo 3')"
assert_eq "" "$__RUN_STDOUT" "Role on line 5: still under worker default 120 (not foreman cap 2)"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── P2: lowercase role: worker → foreman ──
write_child_transcript agent-lc 'role: worker'
assert_foreman_denies_at_3 "lowercase role:" agent-lc

# ── P2: trailing extra text on Role line → foreman ──
write_child_transcript agent-tr 'Role: worker extra'
assert_foreman_denies_at_3 "Role line extra text" agent-tr

# ── P2: bare word worker elsewhere → foreman ──
write_child_transcript agent-bare 'Please behave as a worker on this task'
assert_foreman_denies_at_3 "bare worker word" agent-bare

# ── P2: no transcript_path → foreman ──
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
reset_state
run_hook foreman-guard.js "$(bash_payload agent-nt 'echo 1')"
run_hook foreman-guard.js "$(bash_payload agent-nt 'git status')"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "no transcript_path: call 2 carries Close-out reserve directive"
run_hook foreman-guard.js "$(bash_payload agent-nt 'echo 3')"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 2' "no transcript_path: foreman cap"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── P2: transcript_path file does not exist → foreman ──
reset_state
write_child_transcript agent-miss 'Role: worker'
MISSING_PAYLOAD="$(node -e '
  const p = JSON.parse(process.argv[1]);
  p.transcript_path = process.argv[2];
  process.stdout.write(JSON.stringify(p));
' "$(bash_payload_tx agent-miss 'echo 1')" "$TEST_TMP/no-such-transcript-root/missing.jsonl")"
# rewrite calls with missing root (and no child under that dirname)
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
run_hook foreman-guard.js "$(node -e '
  const p = JSON.parse(process.argv[1]);
  p.transcript_path = process.argv[2];
  p.tool_input.command = "echo 1";
  process.stdout.write(JSON.stringify(p));
' "$MISSING_PAYLOAD" "$TEST_TMP/no-such-transcript-root/missing.jsonl")"
run_hook foreman-guard.js "$(node -e '
  const p = JSON.parse(process.argv[1]);
  p.transcript_path = process.argv[2];
  p.tool_input.command = "git status";
  process.stdout.write(JSON.stringify(p));
' "$MISSING_PAYLOAD" "$TEST_TMP/no-such-transcript-root/missing.jsonl")"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "missing transcript_path file: call 2 carries Close-out reserve directive"
run_hook foreman-guard.js "$(node -e '
  const p = JSON.parse(process.argv[1]);
  p.transcript_path = process.argv[2];
  p.tool_input.command = "echo 3";
  process.stdout.write(JSON.stringify(p));
' "$MISSING_PAYLOAD" "$TEST_TMP/no-such-transcript-root/missing.jsonl")"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 2' "missing transcript_path file: foreman cap"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── P2: first record type !== user → foreman ──
write_child_transcript_record agent-ty '{"type":"assistant","agentId":"agent-ty","sessionId":"fg-test-session","message":{"content":"Role: worker"}}'
assert_foreman_denies_at_3 "type not user" agent-ty

# ── P2: agentId mismatch → foreman ──
write_child_transcript_record agent-mm '{"type":"user","agentId":"other-agent","sessionId":"fg-test-session","message":{"content":"Role: worker"}}'
assert_foreman_denies_at_3 "agentId mismatch" agent-mm

# ── P2: message.content is array → foreman ──
write_child_transcript_record agent-arr '{"type":"user","agentId":"agent-arr","sessionId":"fg-test-session","message":{"content":["Role: worker"]}}'
assert_foreman_denies_at_3 "content array" agent-arr

# ── P2: first line past 64 KiB → foreman ──
node -e '
  const fs = require("fs");
  const path = require("path");
  const root = process.argv[1];
  const dir = path.join(root, "fg-test-session", "subagents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent-huge.jsonl"), `${"x".repeat(65537)}\n`);
' "$TRANSCRIPT_ROOT"
assert_foreman_denies_at_3 "first line >64KiB" agent-huge

# ── P2: malformed ROLE_CAPS pair ignored; well-formed still applies ──
reset_state
write_child_transcript agent-mal 'Role: reviewer'
export AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS='worker=abc,reviewer=7'
for i in $(seq 1 7); do
  if [ "$i" -ge 5 ]; then
    run_hook foreman-guard.js "$(bash_payload_tx agent-mal "git status")"
    if [ "$i" -eq 5 ]; then
      assert_contains "$__RUN_STDOUT" 'Close-out reserve' "malformed env: call 5 carries Close-out reserve directive"
    else
      assert_eq "" "$__RUN_STDOUT" "malformed env: reviewer call $i within 7 allowed"
    fi
  else
    run_hook foreman-guard.js "$(bash_payload_tx agent-mal "echo m $i")"
    assert_eq "" "$__RUN_STDOUT" "malformed env: reviewer call $i within 7 allowed"
  fi
done
run_hook foreman-guard.js "$(bash_payload_tx agent-mal 'echo m 8')"
assert_contains "$__RUN_STDOUT" 'exceeds the reviewer cap of 7' "malformed worker=abc ignored; reviewer=7 applied"
unset AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS

# ── P2: no agent_id stays inert even if a worker transcript exists ──
write_child_transcript agent-d0 'Role: worker'
reset_state
BEFORE_STATE="$(ls -1 "$AUTOPILOT_FOREMAN_GUARD_DIR" 2>/dev/null | wc -l)"
run_hook foreman-guard.js "$(bash_payload "" 'echo depth0')"
assert_eq 0 "$__RUN_EXIT" "no agent_id: exit 0"
assert_eq "" "$__RUN_STDOUT" "no agent_id: empty stdout"
AFTER_STATE="$(ls -1 "$AUTOPILOT_FOREMAN_GUARD_DIR" 2>/dev/null | wc -l)"
assert_eq "$BEFORE_STATE" "$AFTER_STATE" "no agent_id: no new counting state"

# ── P2: state file never stores a role field ──
reset_state
write_child_transcript agent-st 'Role: worker'
run_hook foreman-guard.js "$(bash_payload_tx agent-st 'echo state')"
STATE_ST="$(cat "$AUTOPILOT_FOREMAN_GUARD_DIR"/fg-test-session-agent-st.json)"
assert_not_contains "$STATE_ST" 'role' "state JSON has no role key/substring"

# ── P2: poll-deny suffix uses the role cap ──
reset_state
write_child_transcript agent-poll 'Role: reviewer'
export AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS='reviewer=6'
run_hook foreman-guard.js "$(bash_payload_tx agent-poll 'sleep 30')"
assert_contains "$__RUN_STDOUT" 'Bash call 1/6 spent' "poll deny suffix uses reviewer cap"
unset AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS

# RED at 9514ced7:
# FAIL [foreman-guard-roles] worker call 113 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] reviewer call 4 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] Role on line 6: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] lowercase role:: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] Role line extra text: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] bare worker word: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] no transcript_path: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] missing transcript_path file: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] type not user: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] agentId mismatch: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] content array: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] first line >64KiB: call 2 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] malformed env: call 5 carries Close-out reserve directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 git commit at 33: additionalContext: 'additionalContext' not found in output
# FAIL [foreman-guard-roles] P3 git commit at 33: reserve-entry directive: 'Close-out reserve: 8 call(s) left before the cap. Allowed now: cd; git status/diff/add/commit/log/show/rev-parse/restore --staged; kill <pid>; rm/rmdir under /tmp or $TMPDIR; mkdir -p; ls; test; writing a file (cat >, tee, printf >). Commit, clean up, write your handoff, and end the turn.' not found in output
# FAIL [foreman-guard-roles] P3 cargo build in reserve denied: '"permissionDecision":"deny"' not found in output
# FAIL [foreman-guard-roles] P3 cargo deny names allowed verbs via directive: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 cargo deny names allowed verbs: 'git status/diff/add/commit' not found in output
# FAIL [foreman-guard-roles] P3 rm outside /tmp denied in reserve: '"permissionDecision":"deny"' not found in output
# FAIL [foreman-guard-roles] P3 rm outside /tmp: reserve deny: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 1 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 2 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 3 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 4 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 5 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 6 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 7 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 exhaust cargo deny 8 is reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 cap 5: effective reserve 2: 'Close-out reserve: 2 call(s) left' not found in output
# FAIL [foreman-guard-roles] 318 passed, 29 failed

# ── P3: close-out reserve ──
RESERVE_DIR='Close-out reserve: 8 call(s) left before the cap. Allowed now: cd; git status/diff/add/commit/log/show/rev-parse/restore --staged; kill <pid>; rm/rmdir under /tmp or $TMPDIR; mkdir -p; ls; test; writing a file (cat >, tee, printf >). Commit, clean up, write your handoff, and end the turn.'

set_marker l4
reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3a "echo ordinary $i")"
  assert_eq "" "$__RUN_STDOUT" "P3 default cap: call $i ordinary allowed"
done
run_hook foreman-guard.js "$(bash_payload agent-p3a 'git commit -m x')"
assert_eq 0 "$__RUN_EXIT" "P3 git commit at 33: exit 0"
assert_contains "$__RUN_STDOUT" 'additionalContext' "P3 git commit at 33: additionalContext"
assert_contains "$__RUN_STDOUT" "$RESERVE_DIR" "P3 git commit at 33: reserve-entry directive"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 git commit at 33: allowed"
run_hook foreman-guard.js "$(bash_payload agent-p3a 'cargo build')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 cargo build in reserve denied"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 cargo deny names allowed verbs via directive"
assert_contains "$__RUN_STDOUT" 'git status/diff/add/commit' "P3 cargo deny names allowed verbs"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3rm "echo r $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3rm 'rm -rf /home/not-tmp/secret')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 rm outside /tmp denied in reserve"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 rm outside /tmp: reserve deny"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3rmt "echo t $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3rmt 'rm -rf /tmp/autopilot-p3-safe')"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 rm under /tmp allowed in reserve"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3rmd "echo d $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3rmd "rm -rf ${TMPDIR}/autopilot-p3-safe")"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 rm under \$TMPDIR allowed in reserve"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3ex "echo e $i")" >/dev/null
done
for i in $(seq 1 8); do
  run_hook foreman-guard.js "$(bash_payload agent-p3ex 'cargo build')"
  assert_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 exhaust cargo deny $i is reserve"
done
run_hook foreman-guard.js "$(bash_payload agent-p3ex 'git commit -m x')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 after reserve exhausted: deny"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 40' "P3 after reserve exhausted: ordinary cap, role+cap"
assert_not_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 after reserve exhausted: not a reserve deny"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3sl "echo s $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3sl 'sleep 30')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 sleep in reserve denied"
assert_contains "$__RUN_STDOUT" 'rule sleep' "P3 sleep in reserve denied as poll"
assert_not_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 sleep in reserve is not a reserve deny"

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3q "echo q $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3q 'git commit -m "fix; a | b"')"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 quoted semicolon/pipe in commit message allowed"

reset_state
export AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS=0
for i in $(seq 1 40); do
  run_hook foreman-guard.js "$(bash_payload agent-p3z "echo z $i")"
  assert_eq "" "$__RUN_STDOUT" "P3 reserve_calls=0: call $i ordinary allowed"
done
run_hook foreman-guard.js "$(bash_payload agent-p3z 'echo z 41')"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 40' "P3 reserve_calls=0: 41st hits cap"
unset AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS

reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=5
for i in $(seq 1 3); do
  run_hook foreman-guard.js "$(bash_payload agent-p3c5 "echo c $i")"
  assert_eq "" "$__RUN_STDOUT" "P3 cap 5: call $i ordinary allowed"
done
run_hook foreman-guard.js "$(bash_payload agent-p3c5 'git status')"
assert_contains "$__RUN_STDOUT" 'Close-out reserve: 2 call(s) left' "P3 cap 5: effective reserve 2"
run_hook foreman-guard.js "$(bash_payload agent-p3c5 'git status')"
assert_eq "" "$__RUN_STDOUT" "P3 cap 5: call 5 allowed without repeating directive"
run_hook foreman-guard.js "$(bash_payload agent-p3c5 'echo c 6')"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 5' "P3 cap 5: 6th hits cap"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=1
run_hook foreman-guard.js "$(bash_payload agent-p3c1 'echo only')"
assert_eq "" "$__RUN_STDOUT" "P3 cap 1: no reserve, first call ordinary allowed"
run_hook foreman-guard.js "$(bash_payload agent-p3c1 'echo two')"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 1' "P3 cap 1: second call is ordinary cap"
assert_not_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 cap 1: no reserve deny"
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

reset_state
node -e '
  const fs = require("fs");
  const path = require("path");
  const [, root, sid, aid] = process.argv;
  const dir = path.join(root, sid, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const rec1 = { type: "user", agentId: aid, sessionId: sid, message: { content: "Hello, no role on first record." } };
  const rec2 = { type: "user", agentId: aid, sessionId: sid, message: { content: "Role: worker" } };
  fs.writeFileSync(path.join(dir, `agent-${aid}.jsonl`), `${JSON.stringify(rec1)}\n${JSON.stringify(rec2)}\n`);
' "$TRANSCRIPT_ROOT" "fg-test-session" "agent-p3inv"
for i in $(seq 1 40); do
  if [ "$i" -ge 33 ]; then
    run_hook foreman-guard.js "$(bash_payload_tx agent-p3inv 'git status')"
  else
    run_hook foreman-guard.js "$(bash_payload_tx agent-p3inv "echo inv $i")"
    assert_eq "" "$__RUN_STDOUT" "P3 inversion: call $i allowed under foreman 40"
  fi
done
run_hook foreman-guard.js "$(bash_payload_tx agent-p3inv 'echo inv 41')"
assert_contains "$__RUN_STDOUT" 'exceeds the foreman cap of 40' "P3 inversion: first record wins, later Role: worker ignored"

# RED at 6d7a8606:
# FAIL [foreman-guard-roles] P3 empty RESERVE_CALLS env: cargo at 33 denied as reserve: '"permissionDecision":"deny"' not found in output
# FAIL [foreman-guard-roles] P3 empty RESERVE_CALLS env: still Close-out reserve: 'Close-out reserve' not found in output
# FAIL [foreman-guard-roles] P3 rm /tmp/ (bare trailing slash) denied in reserve: '"permissionDecision":"deny"' not found in output
# FAIL [foreman-guard-roles] 380 passed, 3 failed

reset_state
export AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS=
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3empty "echo empty $i")"
  assert_eq "" "$__RUN_STDOUT" "P3 empty RESERVE_CALLS env: call $i ordinary allowed"
done
run_hook foreman-guard.js "$(bash_payload agent-p3empty 'cargo build')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 empty RESERVE_CALLS env: cargo at 33 denied as reserve"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 empty RESERVE_CALLS env: still Close-out reserve"
unset AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS

reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-p3rmslash "echo slash $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-p3rmslash 'rm -rf /tmp/')"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 rm /tmp/ (bare trailing slash) denied in reserve"
assert_contains "$__RUN_STDOUT" 'Close-out reserve' "P3 rm /tmp/: reserve deny"

finalize_test
