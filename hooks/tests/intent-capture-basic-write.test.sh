#!/usr/bin/env bash
# intent-capture: basic write path. Hook receives a tool_use payload, writes
# the per-cwd intent file, exits 0, and the resulting file has the expected
# shape + mode 0600.
. "$(dirname "$0")/lib.sh"

payload='{"session_id":"basic","tool_name":"Bash","tool_input":{"command":"echo test","description":"smoke"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open on normal payload"

INTENT_DIR="$HOOK_HOME/.autopilot/intent"
assert_file_exists "$INTENT_DIR" "intent dir created"

# Exactly one intent file (per-cwd hash) should appear.
count=$(find "$INTENT_DIR" -maxdepth 1 -name '*.json' | wc -l)
assert_eq "$count" "1" "one per-cwd intent file written"

intent_file=$(find "$INTENT_DIR" -maxdepth 1 -name '*.json' | head -1)
content=$(cat "$intent_file")
assert_contains "$content" '"session_id": "basic"' "payload session id recorded"
assert_contains "$content" '"last_tool": "Bash"' "last_tool recorded"
assert_contains "$content" "echo test" "summary field includes command"
assert_contains "$content" '"tool_count_session": 1' "tool count recorded"
assert_file_exists "$HOOK_TMPDIR/claude-intent-tool-count-basic" "tool counter uses payload session id"

# mode 0600 (POSIX stat for Linux + macOS)
mode=$(stat -c '%a' "$intent_file" 2>/dev/null || stat -f '%Lp' "$intent_file" 2>/dev/null)
assert_eq "$mode" "600" "intent file has mode 0600"

finalize_test
