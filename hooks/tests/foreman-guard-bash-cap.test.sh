#!/usr/bin/env bash
# RED at 0968fc9c4: Bash-Cap 60 call 41 is denied on the unmodified hook
# (expected '', got deny "Bash call 41 exceeds the foreman cap of 40");
# deny text has no "Bash-Cap line was ignored" and no "git diff --stat" sentence.
# 13 passed, 10 failed.
# foreman-guard.js — brief "Bash-Cap: <n>" (BL-0022) overrides the shared Bash cap.
# A line in the first 10 lines of the child's first user message sets that agent's
# cap (1..200). Out of range or malformed is ignored and named on the bash-cap deny.
# The deny also names whether `git diff --stat` of payload.cwd is empty.
. "$(dirname "$0")/lib.sh"

export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_FOREMAN_GUARD_DIR="$TEST_TMP/foreman-guard"
export AUTOPILOT_SESSION_ID="fg-bash-cap-session"
unset AUTOPILOT_FOREMAN_GUARD_MODE AUTOPILOT_FOREMAN_GUARD_BASH_CAP AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS
# A rail parent id makes session-mode treat AUTOPILOT_SESSION_ID as read-only and refuse the marker.
unset AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$AUTOPILOT_FOREMAN_GUARD_DIR"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email "fg@example.com"
git -C "$REPO" config user.name "fg"
set_marker() { node "$REPO_ROOT/scripts/session-mode.js" set --level "$1" --repo-root "$REPO" >/dev/null 2>&1 || fail "marker set $1"; }
reset_state() { rm -f "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.json "$AUTOPILOT_FOREMAN_GUARD_DIR"/*.lock; }

TRANSCRIPT_ROOT="$TEST_TMP/transcripts"
TRANSCRIPT_PATH="$TRANSCRIPT_ROOT/root.jsonl"
mkdir -p "$TRANSCRIPT_ROOT"
printf '%s\n' '{}' > "$TRANSCRIPT_PATH"

bash_payload_at() { # <agent_id> <cwd> <command>
  node -e '
    const payload = {
      tool_name: "Bash",
      agent_id: process.argv[1],
      session_id: "fg-bash-cap-session",
      transcript_path: process.argv[4],
      tool_input: { command: process.argv[3], run_in_background: false },
      hook_event_name: "PreToolUse",
      cwd: process.argv[2],
    };
    process.stdout.write(JSON.stringify(payload));
  ' "$1" "$2" "$3" "$TRANSCRIPT_PATH"
}

write_brief() { # <agent_id> <brief text>
  node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(process.argv[1], "fg-bash-cap-session", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    const rec = {
      type: "user",
      agentId: process.argv[2],
      sessionId: "fg-bash-cap-session",
      message: { content: process.argv[3] },
    };
    fs.writeFileSync(path.join(dir, `agent-${process.argv[2]}.jsonl`), JSON.stringify(rec) + "\n");
  ' "$TRANSCRIPT_ROOT" "$1" "$2"
}

# git status stays on the close-out allowlist, so only the bash-cap rule denies.
burn() { # <agent_id> <cwd> <n>
  local i
  for i in $(seq 1 "$3"); do
    run_hook foreman-guard.js "$(bash_payload_at "$1" "$2" "git status")"
  done
}

set_marker l4

# ── brief cap 60: call 41 allowed, call 61 denied ─────────────────────
BRIEF60=$'Engine: grok\nRole: foreman\nLane: bl0022\nBash-Cap: 60\nDo the work.'
write_brief agent-60 "$BRIEF60"
reset_state
burn agent-60 "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-60 "$REPO" "git status")"
assert_eq "$__RUN_STDOUT" "" "Bash-Cap 60: call 41 is not denied"
burn agent-60 "$REPO" 19
run_hook foreman-guard.js "$(bash_payload_at agent-60 "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "Bash-Cap 60: call 61 is denied"
assert_contains "$__RUN_STDOUT" 'cap of 60' "Bash-Cap 60: deny names cap 60"

# ── 500 ignored: default 40, deny mentions the ignored line ───────────
write_brief agent-500 $'Engine: grok\nRole: foreman\nLane: bl0022\nBash-Cap: 500\n'
reset_state
burn agent-500 "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-500 "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "Bash-Cap 500: call 41 denied"
assert_contains "$__RUN_STDOUT" 'cap of 40' "Bash-Cap 500: default cap 40"
assert_contains "$__RUN_STDOUT" 'Bash-Cap line was ignored' "Bash-Cap 500: deny mentions the ignored line"
assert_contains "$__RUN_STDOUT" '1 to 200' "Bash-Cap 500: deny says why (out of range)"

# ── abc and 0 ignored ─────────────────────────────────────────────────
write_brief agent-abc $'Engine: grok\nRole: foreman\nLane: bl0022\nBash-Cap: abc\n'
reset_state
burn agent-abc "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-abc "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" 'cap of 40' "Bash-Cap abc: default cap 40"
assert_contains "$__RUN_STDOUT" 'Bash-Cap line was ignored' "Bash-Cap abc: deny mentions the ignored line"
assert_contains "$__RUN_STDOUT" 'plain digits' "Bash-Cap abc: deny says why (malformed)"

write_brief agent-zero $'Engine: grok\nRole: foreman\nLane: bl0022\nBash-Cap: 0\n'
reset_state
burn agent-zero "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-zero "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" 'cap of 40' "Bash-Cap 0: default cap 40"
assert_contains "$__RUN_STDOUT" 'Bash-Cap line was ignored' "Bash-Cap 0: deny mentions the ignored line"

# ── no line: default 40 ───────────────────────────────────────────────
write_brief agent-none $'Engine: grok\nRole: foreman\nLane: bl0022\nNo cap here.\n'
reset_state
burn agent-none "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-none "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" 'cap of 40' "no Bash-Cap line: default cap 40"
assert_not_contains "$__RUN_STDOUT" 'Bash-Cap line was ignored' "no Bash-Cap line: deny does not mention an ignored line"

# ── line 11 is outside the first 10 lines ─────────────────────────────
write_brief agent-late $'Engine: grok\nRole: foreman\nLane: bl0022\n4\n5\n6\n7\n8\n9\n10\nBash-Cap: 60\n'
reset_state
burn agent-late "$REPO" 40
run_hook foreman-guard.js "$(bash_payload_at agent-late "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" 'cap of 40' "Bash-Cap past line 10: ignored, default 40"
assert_not_contains "$__RUN_STDOUT" 'Bash-Cap line was ignored' "Bash-Cap past line 10: not reported as a parsed line"

# ── git diff --stat sentence ──────────────────────────────────────────
# Empty tree: nothing written.
write_brief agent-empty $'Engine: grok\nRole: foreman\nLane: bl0022\n'
reset_state
export AUTOPILOT_FOREMAN_GUARD_BASH_CAP=2
burn agent-empty "$REPO" 2
run_hook foreman-guard.js "$(bash_payload_at agent-empty "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "empty repo: bash-cap still denies"
assert_contains "$__RUN_STDOUT" 'git diff --stat of your working directory is empty: nothing is written yet' "empty repo: deny says diff is empty"

# Dirty tracked file.
DIRTY="$TEST_TMP/dirty"
mkdir -p "$DIRTY"
git -C "$DIRTY" init -q
git -C "$DIRTY" config user.email "fg@example.com"
git -C "$DIRTY" config user.name "fg"
echo base > "$DIRTY/f.txt"
git -C "$DIRTY" add f.txt
git -C "$DIRTY" commit -q -m base
echo more >> "$DIRTY/f.txt"
write_brief agent-dirty $'Engine: grok\nRole: foreman\nLane: bl0022\n'
reset_state
burn agent-dirty "$DIRTY" 2
run_hook foreman-guard.js "$(bash_payload_at agent-dirty "$DIRTY" "git status")"
assert_contains "$__RUN_STDOUT" 'git diff --stat of your working directory is not empty: uncommitted work exists, commit it before ending' "dirty repo: deny says diff is not empty"

# Not a git repo: deny without the sentence.
PLAIN="$TEST_TMP/not-a-repo"
mkdir -p "$PLAIN"
write_brief agent-plain $'Engine: grok\nRole: foreman\nLane: bl0022\n'
reset_state
burn agent-plain "$PLAIN" 2
run_hook foreman-guard.js "$(bash_payload_at agent-plain "$PLAIN" "echo work")"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "non-repo cwd: bash-cap still denies"
assert_contains "$__RUN_STDOUT" 'cap of 2' "non-repo cwd: cap still applies"
assert_not_contains "$__RUN_STDOUT" 'git diff --stat' "non-repo cwd: no git diff sentence"

unset AUTOPILOT_FOREMAN_GUARD_BASH_CAP

# ── brief beats the role cap ──────────────────────────────────────────
write_brief agent-role $'Engine: grok\nRole: worker\nLane: bl0022\nBash-Cap: 3\n'
reset_state
burn agent-role "$REPO" 3
run_hook foreman-guard.js "$(bash_payload_at agent-role "$REPO" "git status")"
assert_contains "$__RUN_STDOUT" 'cap of 3' "Bash-Cap overrides the worker role cap"

finalize_test
