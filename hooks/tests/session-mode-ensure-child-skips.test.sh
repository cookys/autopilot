#!/usr/bin/env bash
# BL-0174 -- `session-mode.js ensure-child` (the SessionStart hook on dispatched claude children) must say WHY it
# wrote no marker: one stderr line `session-mode ensure-child: skipped (<code>): ...` per skip reason, and the exit
# code stays 0 (the hook never blocks the child). One cell per reason code.
# Negative control: a copy of session-mode.js with one skip line removed must turn that cell red.
. "$(dirname "$0")/lib.sh"
SM="$REPO_ROOT/scripts/session-mode.js"
MD="$TEST_TMP/markers"; mkdir -p "$MD"
unset AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_RUNS_WATCH_AUTOSTART=0

# cell <script> <stdin> -> sets RC, ERR, OUT
cell() {
  local script="$1" input="$2"
  ERR="$TEST_TMP/err"; OUT="$TEST_TMP/out"
  printf '%s' "$input" | node "$script" ensure-child >"$OUT" 2>"$ERR"; RC=$?
}
expect_skip() { # <label> <code> -> asserts exit 0, no stdout, stderr names the code
  assert_eq "$RC" "0" "$1: exit code stays 0"
  assert_eq "$(cat "$OUT")" "" "$1: no stdout"
  assert_contains "$(cat "$ERR")" "ensure-child: skipped ($2)" "$1: stderr names $2"
}

script="$SM"
cell "$script" 'not json at all'
expect_skip "payload_unreadable" payload_unreadable
cell "$script" '{"cwd":"/tmp"}'
expect_skip "no_session_id" no_session_id
cell "$script" '{"session_id":"","cwd":"/tmp"}'
expect_skip "empty_session_id" empty_session_id
AUTOPILOT_PARENT_SESSION_ID="pp-1" cell "$script" '{"session_id":"pp-1","cwd":"/tmp"}'
expect_skip "child_is_parent" child_is_parent
assert_file_absent "$MD/pp-1.json" "parent marker not written"
printf 'garbage' > "$MD/bad-1.json"
cell "$script" '{"session_id":"bad-1","cwd":"/tmp"}'
expect_skip "marker_unreadable" marker_unreadable
# write_failed: the marker dir sits under a regular file, so mkdir fails
: > "$TEST_TMP/afile"
AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/afile/sub" cell "$script" '{"session_id":"w-1","cwd":"/tmp"}'
expect_skip "write_failed" write_failed
# a successful write stays silent
cell "$script" '{"session_id":"ok-1","cwd":"/tmp"}'
assert_eq "$RC" "0" "success exit 0"
assert_eq "$(cat "$ERR")" "" "success: stderr silent"
assert_file_exists "$MD/ok-1.json" "success wrote marker"

# Negative control: drop the child_is_parent skip line -> that cell must go red.
NC="$TEST_TMP/nc"; mkdir -p "$NC"
sed_mutant "$SM" "$NC/session-mode.js" "s#require('\\.\\./#require('$REPO_ROOT/#g"
sed_mutate "$NC/session-mode.js" "s#require('\\./#require('$REPO_ROOT/scripts/#g"
sed_mutate "$NC/session-mode.js" "/result === 'refused_parent'/d"
AUTOPILOT_PARENT_SESSION_ID="pp-1" cell "$NC/session-mode.js" '{"session_id":"pp-1","cwd":"/tmp"}'
assert_eq "$RC" "0" "negative control: exit code still 0"
assert_not_contains "$(cat "$ERR")" "skipped (child_is_parent)" "negative control: stderr line removed -> the child_is_parent cell would be red"
finalize_test
