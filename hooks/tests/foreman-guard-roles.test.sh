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
# RED-by-inversion at b76283d7: these assertions currently pass by asserting
# the defect (permissionDecision allow on advisory paths), and must be re-expected.
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "warn poll: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "warn poll: stdout has additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "warn poll: no permissionDecision"

reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=1
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-2 'echo 1')"
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-2 'echo 2')"
assert_eq 0 "$__RUN_EXIT" "warn over-cap: exit 0"
assert_contains "$__RUN_STDERR" 'mode=warn' "warn over-cap: stderr copy still present"
assert_contains "$__RUN_STDOUT" 'hookSpecificOutput' "warn over-cap: stdout has hookSpecificOutput"
assert_contains "$__RUN_STDOUT" 'additionalContext' "warn over-cap: stdout has additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "warn over-cap: no permissionDecision"
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
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "0-row diagnostic: no permissionDecision"
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
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "2-row diagnostic: no permissionDecision"
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
# Pin TMPDIR to a real non-/tmp prefix so isTmpSafePath cannot take the /tmp/
# short-circuit. Restore afterward so later cases keep lib.sh's HOOK_TMPDIR.
# Needs /dev/shm to hand out a real non-/tmp dir; a host without it (e.g. some
# containers) skips this case instead of failing the suite.
_p3_saved_tmpdir="${TMPDIR-}"
_p3_tmpdir_was_set=0
[ -n "${TMPDIR+x}" ] && _p3_tmpdir_was_set=1
if [ ! -d /dev/shm ] || [ ! -w /dev/shm ]; then
  echo "SKIP: P3 TMPDIR case needs a writable /dev/shm to get a temp dir not under /tmp"
else
  P3_TMPDIR_CASE="$(mktemp -d /dev/shm/fg-p3-tmpdir-XXXXXX 2>/dev/null || true)"
  if [ -z "$P3_TMPDIR_CASE" ] || [ "${P3_TMPDIR_CASE#/tmp/}" != "$P3_TMPDIR_CASE" ]; then
    fail "P3 TMPDIR case: need a temp dir not under /tmp to exercise the TMPDIR branch"
  fi
  export TMPDIR="$P3_TMPDIR_CASE"
  _p3_stdout="$TEST_TMP/.stdout.p3tmpdir"
  _p3_stderr="$TEST_TMP/.stderr.p3tmpdir"
  HOME="$HOOK_HOME" TMPDIR="$P3_TMPDIR_CASE" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/foreman-guard.js" >"$_p3_stdout" 2>"$_p3_stderr" \
    <<< "$(bash_payload agent-p3rmd "rm -rf ${TMPDIR}/autopilot-p3-safe")"
  __RUN_EXIT=$?
  __RUN_STDOUT=$(cat "$_p3_stdout")
  __RUN_STDERR=$(cat "$_p3_stderr")
  rm -f "$_p3_stdout" "$_p3_stderr"
  assert_contains "$__RUN_STDOUT" 'additionalContext' "P3 rm under \$TMPDIR allowed in reserve: additionalContext"
  assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "P3 rm under \$TMPDIR allowed in reserve: no permissionDecision"

  P3_TMPDIR_UNRELATED="$(mktemp -d /dev/shm/fg-p3-tmpdir-unrel-XXXXXX 2>/dev/null || true)"
  if [ -z "$P3_TMPDIR_UNRELATED" ] || [ "${P3_TMPDIR_UNRELATED#/tmp/}" != "$P3_TMPDIR_UNRELATED" ]; then
    fail "P3 TMPDIR sibling: need an unrelated temp dir not under /tmp"
  fi
  HOME="$HOOK_HOME" TMPDIR="$P3_TMPDIR_UNRELATED" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/foreman-guard.js" >"$_p3_stdout" 2>"$_p3_stderr" \
    <<< "$(bash_payload agent-p3rmd "rm -rf ${P3_TMPDIR_CASE}/autopilot-p3-safe")"
  __RUN_EXIT=$?
  __RUN_STDOUT=$(cat "$_p3_stdout")
  __RUN_STDERR=$(cat "$_p3_stderr")
  rm -f "$_p3_stdout" "$_p3_stderr"
  assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P3 rm not under \$TMPDIR denied in reserve"
  if [ "$_p3_tmpdir_was_set" -eq 1 ]; then
    export TMPDIR="$_p3_saved_tmpdir"
  else
    unset TMPDIR
  fi
  rm -rf "$P3_TMPDIR_CASE" "$P3_TMPDIR_UNRELATED"
fi

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

# RED at 70dc78cb:
# FAIL [foreman-guard-roles] P4 default cadence: call 40 names count: '40' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 40 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 40 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 80 names count: '80' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 80 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 80 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 120 names count: '120' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 120 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 default cadence: call 120 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 3 names count: '3' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 3 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 3 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 6 names count: '6' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 6 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 6 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 9 names count: '9' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 9 commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 every=3: call 9 handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=0 falls back: advisory at 40: '40' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=0: commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=0: handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=abc falls back: advisory at 40: '40' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=abc: commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 EVERY=abc: handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 l3: advisory at 40: '40' not found in output
# FAIL [foreman-guard-roles] P4 l3: commit: 'commit' not found in output
# FAIL [foreman-guard-roles] P4 l3: handoff: 'handoff' not found in output
# FAIL [foreman-guard-roles] P4 GC: stale json deleted: /tmp/autopilot-test-foreman-guard-roles-EQ207F/foreman-guard/stale-old.json exists but should not
# FAIL [foreman-guard-roles] P4 GC: stamp file should exist
# FAIL [foreman-guard-roles] P4 GC: stamp exists:  does not exist
# FAIL [foreman-guard-roles] P4 GC: stale deleted after stamp aged: /tmp/autopilot-test-foreman-guard-roles-EQ207F/foreman-guard/stale-second.json exists but should not
# FAIL [foreman-guard-roles] 915 passed, 31 failed

engine_content() { printf 'Engine: sonnet\nRole: worker\nDo the work.\n'; }

monitor_payload_tx() {
  printf '{"tool_name":"Monitor","agent_id":"%s","session_id":"fg-test-session","transcript_path":%s,"tool_input":{"command":"tail -f x"},"hook_event_name":"PreToolUse"}' \
    "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$TRANSCRIPT_PATH")"
}

state_for() { printf '%s/%s-%s.json' "$AUTOPILOT_FOREMAN_GUARD_DIR" "fg-test-session" "$1"; }

# ── P4: no-marker Engine:-first, default advisory every 40 ──
clear_marker
reset_state
unset AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS
write_child_transcript agent-adv "$(engine_content)"
for i in $(seq 1 120); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-adv "echo adv $i")"
  assert_eq 0 "$__RUN_EXIT" "P4 default cadence: call $i exit 0"
  assert_eq "" "$__RUN_STDERR" "P4 default cadence: call $i no stderr"
  if [ "$i" -eq 40 ] || [ "$i" -eq 80 ] || [ "$i" -eq 120 ]; then
    assert_contains "$__RUN_STDOUT" "$i" "P4 default cadence: call $i names count"
    assert_contains "$__RUN_STDOUT" 'commit' "P4 default cadence: call $i commit"
    assert_contains "$__RUN_STDOUT" 'handoff' "P4 default cadence: call $i handoff"
    assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P4 default cadence: call $i never deny"
  else
    assert_eq "" "$__RUN_STDOUT" "P4 default cadence: call $i silent allow"
  fi
done

# ── P4: advisory_every=3 ──
reset_state
write_child_transcript agent-adv3 "$(engine_content)"
export AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY=3
for i in $(seq 1 9); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-adv3 "echo every3 $i")"
  assert_eq 0 "$__RUN_EXIT" "P4 every=3: call $i exit 0"
  if [ "$i" -eq 3 ] || [ "$i" -eq 6 ] || [ "$i" -eq 9 ]; then
    assert_contains "$__RUN_STDOUT" "$i" "P4 every=3: call $i names count"
    assert_contains "$__RUN_STDOUT" 'commit' "P4 every=3: call $i commit"
    assert_contains "$__RUN_STDOUT" 'handoff' "P4 every=3: call $i handoff"
  else
    assert_eq "" "$__RUN_STDOUT" "P4 every=3: call $i silent"
  fi
done
unset AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY

# ── P4: env 0 and non-numeric fall back to default 40 ──
reset_state
write_child_transcript agent-adv0 "$(engine_content)"
export AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY=0
for i in $(seq 1 40); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-adv0 "echo z $i")"
  if [ "$i" -eq 40 ]; then
    assert_contains "$__RUN_STDOUT" '40' "P4 EVERY=0 falls back: advisory at 40"
    assert_contains "$__RUN_STDOUT" 'commit' "P4 EVERY=0: commit"
    assert_contains "$__RUN_STDOUT" 'handoff' "P4 EVERY=0: handoff"
  else
    assert_eq "" "$__RUN_STDOUT" "P4 EVERY=0: call $i silent (not every-zero)"
  fi
done
unset AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY

reset_state
write_child_transcript agent-advn "$(engine_content)"
export AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY=abc
for i in $(seq 1 40); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-advn "echo n $i")"
  if [ "$i" -eq 40 ]; then
    assert_contains "$__RUN_STDOUT" '40' "P4 EVERY=abc falls back: advisory at 40"
    assert_contains "$__RUN_STDOUT" 'commit' "P4 EVERY=abc: commit"
    assert_contains "$__RUN_STDOUT" 'handoff' "P4 EVERY=abc: handoff"
  else
    assert_eq "" "$__RUN_STDOUT" "P4 EVERY=abc: call $i silent"
  fi
done
unset AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY

# ── P4: never deny even with tiny bash cap + worker role_caps ──
reset_state
write_child_transcript agent-tiny "$(printf 'Engine: sonnet\nRole: worker\n')"
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
export AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS='worker=2'
for i in $(seq 1 8); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-tiny "echo tiny $i")"
  assert_eq 0 "$__RUN_EXIT" "P4 tiny cap: call $i exit 0"
  assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "P4 tiny cap: call $i never deny"
done
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS

# ── P4: poll-shaped sleep allowed (poll rules marker-scoped) ──
reset_state
write_child_transcript agent-sleep "$(engine_content)"
run_hook foreman-guard.js "$(bash_payload_tx agent-sleep 'sleep 30')"
assert_eq 0 "$__RUN_EXIT" "P4 sleep poll: exit 0"
assert_eq "" "$__RUN_STDOUT" "P4 sleep poll: no deny/advisory on call 1"
assert_eq "" "$__RUN_STDERR" "P4 sleep poll: no stderr"

# ── P4: context ceiling marker-scoped ──
LIVE_DIR_P4="$(mktemp -d /dev/shm/fg-guard-live-p4-XXXXXX 2>/dev/null || mktemp -d "$TEST_TMP/live-p4-XXXXXX")"
mkdir -p "$LIVE_DIR_P4/context"
export AUTOPILOT_LIVE_DIR="$LIVE_DIR_P4"
write_tasks() { # redefine if needed
  node -e '
    const fs = require("fs");
    const [, sid, tasksJson, dir] = process.argv;
    const obj = { schema_version: 1, session_id: sid, written_at: new Date().toISOString(), tasks: JSON.parse(tasksJson) };
    fs.writeFileSync(`${dir}/context/${sid}.tasks.json`, JSON.stringify(obj));
  ' "$1" "$2" "$LIVE_DIR_P4"
}
reset_state
write_child_transcript agent-ceil "$(engine_content)"
write_tasks fg-test-session '[{"id":"other-agent","tokenCount":190000,"contextWindowSize":200000}]'
run_hook foreman-guard.js "$(bash_payload_tx agent-ceil 'echo ceil')"
assert_eq 0 "$__RUN_EXIT" "P4 ceiling no-marker: exit 0"
assert_eq "" "$__RUN_STDOUT" "P4 ceiling no-marker: no deny/diagnostic stdout"
assert_eq "" "$__RUN_STDERR" "P4 ceiling no-marker: no stderr diagnostic"
unset AUTOPILOT_LIVE_DIR

# ── P4: Monitor + Engine: still empty (not Bash) ──
reset_state
write_child_transcript agent-mon "$(engine_content)"
run_hook foreman-guard.js "$(monitor_payload_tx agent-mon)"
assert_eq 0 "$__RUN_EXIT" "P4 Monitor Engine: exit 0"
assert_eq "" "$__RUN_STDOUT" "P4 Monitor Engine: empty stdout"
assert_eq "" "$__RUN_STDERR" "P4 Monitor Engine: empty stderr"
assert_file_absent "$(state_for agent-mon)" "P4 Monitor Engine: no state file"

# ── P4: first line not Engine: — no state ──
reset_state
write_child_transcript agent-roleonly $'Role: worker\nno engine\n'
run_hook foreman-guard.js "$(bash_payload_tx agent-roleonly 'echo explore')"
assert_eq 0 "$__RUN_EXIT" "P4 Role-first: exit 0"
assert_eq "" "$__RUN_STDOUT" "P4 Role-first: empty stdout"
assert_eq "" "$__RUN_STDERR" "P4 Role-first: empty stderr"
assert_file_absent "$(state_for agent-roleonly)" "P4 Role-first: no state file"

write_child_transcript agent-explore 'Explore this repository'
run_hook foreman-guard.js "$(bash_payload_tx agent-explore 'echo explore2')"
assert_eq "" "$__RUN_STDOUT" "P4 Explore: empty stdout"
assert_file_absent "$(state_for agent-explore)" "P4 Explore: no state file"

# ── P4: Engine: on line 2 only ──
write_child_transcript agent-e2 $'Hello first\nEngine: sonnet\n'
run_hook foreman-guard.js "$(bash_payload_tx agent-e2 'echo line2')"
assert_eq "" "$__RUN_STDOUT" "P4 Engine line2: empty stdout"
assert_file_absent "$(state_for agent-e2)" "P4 Engine line2: no state file"

# ── P4: no transcript_path ──
run_hook foreman-guard.js "$(bash_payload agent-notx 'echo notx')"
assert_eq 0 "$__RUN_EXIT" "P4 no transcript_path: exit 0"
assert_eq "" "$__RUN_STDOUT" "P4 no transcript_path: empty stdout"
assert_file_absent "$(state_for agent-notx)" "P4 no transcript_path: no state file"

# ── P4: l3 marker still advisory path ──
reset_state
set_marker l3
write_child_transcript agent-l3 "$(engine_content)"
for i in $(seq 1 40); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-l3 "echo l3 $i")"
  if [ "$i" -eq 40 ]; then
    assert_contains "$__RUN_STDOUT" '40' "P4 l3: advisory at 40"
    assert_contains "$__RUN_STDOUT" 'commit' "P4 l3: commit"
    assert_contains "$__RUN_STDOUT" 'handoff' "P4 l3: handoff"
  else
    assert_eq "" "$__RUN_STDOUT" "P4 l3: call $i silent"
  fi
done
clear_marker

# ── P4: GC ──
reset_state
find "$AUTOPILOT_FOREMAN_GUARD_DIR" -maxdepth 1 -type f ! -name '*.json' -delete 2>/dev/null || true
STALE_JSON="$AUTOPILOT_FOREMAN_GUARD_DIR/stale-old.json"
FRESH_JSON="$AUTOPILOT_FOREMAN_GUARD_DIR/fresh-keep.json"
STALE_OTHER="$AUTOPILOT_FOREMAN_GUARD_DIR/stale-keep.dat"
echo '{"bash_calls":1}' > "$STALE_JSON"
echo '{"bash_calls":1}' > "$FRESH_JSON"
echo leftover > "$STALE_OTHER"
touch -d '8 days ago' "$STALE_JSON" "$STALE_OTHER"
write_child_transcript agent-gc1 "$(engine_content)"
run_hook foreman-guard.js "$(bash_payload_tx agent-gc1 'echo gc1')"
assert_file_absent "$STALE_JSON" "P4 GC: stale json deleted"
assert_file_exists "$FRESH_JSON" "P4 GC: fresh json remains"
assert_file_exists "$STALE_OTHER" "P4 GC: stale non-json remains"
GC_STAMP=""
for f in "$AUTOPILOT_FOREMAN_GUARD_DIR"/*; do
  case "$f" in
    *.json) continue ;;
  esac
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    stale-keep.dat) continue ;;
  esac
  GC_STAMP="$f"
done
[ -n "$GC_STAMP" ] || fail "P4 GC: stamp file should exist"
assert_file_exists "$GC_STAMP" "P4 GC: stamp exists"

STALE2="$AUTOPILOT_FOREMAN_GUARD_DIR/stale-second.json"
echo '{"bash_calls":1}' > "$STALE2"
touch -d '8 days ago' "$STALE2"
write_child_transcript agent-gc2 "$(engine_content)"
run_hook foreman-guard.js "$(bash_payload_tx agent-gc2 'echo gc2')"
assert_file_exists "$STALE2" "P4 GC: second stale not deleted while stamp fresh"

touch -d '2 hours ago' "$GC_STAMP"
write_child_transcript agent-gc3 "$(engine_content)"
run_hook foreman-guard.js "$(bash_payload_tx agent-gc3 'echo gc3')"
assert_file_absent "$STALE2" "P4 GC: stale deleted after stamp aged"

# ── P4: bounded GC pass ──
reset_state
rm -f "$AUTOPILOT_FOREMAN_GUARD_DIR"/gc.stamp "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.stamp 2>/dev/null || true
# drop leftover stamp from previous GC (unknown name): remove non-json except .dat we don't have
find "$AUTOPILOT_FOREMAN_GUARD_DIR" -maxdepth 1 -type f ! -name '*.json' -delete 2>/dev/null || true
i=0
while [ "$i" -lt 520 ]; do
  echo '{"bash_calls":1}' > "$AUTOPILOT_FOREMAN_GUARD_DIR/stale-bound-$i.json"
  i=$((i + 1))
done
touch -d '8 days ago' "$AUTOPILOT_FOREMAN_GUARD_DIR"/stale-bound-*.json
write_child_transcript agent-gcb "$(engine_content)"
run_hook foreman-guard.js "$(bash_payload_tx agent-gcb 'echo gcb')"
remain="$(find "$AUTOPILOT_FOREMAN_GUARD_DIR" -maxdepth 1 -name 'stale-bound-*.json' | wc -l)"
remain="$(echo "$remain" | tr -d ' ')"
# examined at most 500 entries; at least one stale-bound remains
[ "$remain" -gt 0 ] || fail "P4 GC bound: expected leftover stale files, remain=$remain"

# RED at b76283d7:
# FAIL [foreman-guard-roles] emitAllowContext P1 warn: no permissionDecision: 'permissionDecision' found in output
# FAIL [foreman-guard-roles] emitAllowContext P4 no-marker: no permissionDecision: 'permissionDecision' found in output
# FAIL [foreman-guard-roles] emitAllowContext P3 reserve-entry: no permissionDecision: 'permissionDecision' found in output
# ── emitAllowContext: no permissionDecision on any of the three call sites ──
set_marker l4
reset_state
unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS
AUTOPILOT_FOREMAN_GUARD_MODE=warn run_hook foreman-guard.js "$(bash_payload agent-eac-p1 'sleep 30')"
assert_contains "$__RUN_STDOUT" 'additionalContext' "emitAllowContext P1 warn: additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "emitAllowContext P1 warn: no permissionDecision"
unset AUTOPILOT_FOREMAN_GUARD_MODE

clear_marker
reset_state
write_child_transcript agent-eac-p4 "$(engine_content)"
for i in $(seq 1 40); do
  run_hook foreman-guard.js "$(bash_payload_tx agent-eac-p4 "echo eac $i")"
done
assert_contains "$__RUN_STDOUT" 'additionalContext' "emitAllowContext P4 no-marker: additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "emitAllowContext P4 no-marker: no permissionDecision"

set_marker l4
reset_state
for i in $(seq 1 32); do
  run_hook foreman-guard.js "$(bash_payload agent-eac-p3 "echo eacp3 $i")" >/dev/null
done
run_hook foreman-guard.js "$(bash_payload agent-eac-p3 'git commit -m x')"
assert_contains "$__RUN_STDOUT" 'additionalContext' "emitAllowContext P3 reserve-entry: additionalContext"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "emitAllowContext P3 reserve-entry: no permissionDecision"

finalize_test
