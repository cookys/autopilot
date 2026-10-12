#!/usr/bin/env bash
# R10-A — state-checkpoint with an empty payload must fail-open (exit 0). With
# no session_id there is nothing session-start could match the file to, so no
# checkpoint is written; the log records why.
. "$(dirname "$0")/lib.sh"

run_hook state-checkpoint.js '{}'

assert_exit_code "$__RUN_EXIT" 0 "fail-open on empty stdin"
assert_eq "$__RUN_STDOUT" "" "nothing on stdout (it would reach the compaction summarizer)"

shopt -s nullglob
written=("$HOOK_HOME"/.autopilot/compaction-state*.md)
assert_eq "${#written[@]}" "0" "no checkpoint file without a session id"

log_content=$(cat "$HOOK_HOME/.autopilot/.state-checkpoint.log" 2>/dev/null || echo "")
assert_contains "$log_content" "no_session_id" "log records the missing session id"

# Also confirms our sandbox redirection works: nothing leaked to the real HOME.
assert_file_absent "$HOME/.autopilot/.state-checkpoint.log.test-leak" "sandbox isolation guard (no leak marker)"

finalize_test
