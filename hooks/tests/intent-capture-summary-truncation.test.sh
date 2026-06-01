#!/usr/bin/env bash
# intent-capture: very long command field must be truncated with ellipsis in
# the intent file's last_tool_input_summary (end-to-end mirror of the L1
# summarizeToolInput-truncation test).
. "$(dirname "$0")/lib.sh"

LONG=$(printf 'A%.0s' {1..200})
payload=$(printf '{"session_id":"sumtrunc","tool_name":"Bash","tool_input":{"command":"%s"}}' "$LONG")
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open with long command"

intent_file=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' | head -1)
content=$(cat "$intent_file")

assert_contains "$content" "..." "summary truncated with ellipsis"
# The summary line shouldn't echo the full 200 A's
a_count=$(grep -oE 'A{100}' "$intent_file" | wc -l)
assert_eq "$a_count" "0" "full 200-A run NOT present in intent file"

finalize_test
