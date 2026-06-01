#!/usr/bin/env bash
# intent-capture: a 0-byte disable flag (the most common partial-write outcome
# — truncate-then-die before any byte lands) must auto-clear. Regression guard
# for the lib/.ts parity gap found in review: lib's `if (flagContentJson)`
# guard used to treat '' as falsy and leave the hook wedged.
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOOK_HOME/.autopilot"
DISABLE_FLAG="$HOOK_HOME/.autopilot/intent-capture.disabled"
# Fresh (not stale) + 0 bytes — only the malformed/empty branch can clear it.
: > "$DISABLE_FLAG"
assert_eq "$(wc -c < "$DISABLE_FLAG" | tr -d ' ')" "0" "fixture flag is genuinely 0 bytes"

payload='{"session_id":"empty","tool_name":"Bash","tool_input":{"command":"x"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "exit 0 after empty-flag clear"
assert_file_absent "$DISABLE_FLAG" "0-byte disable flag auto-cleared (self-heal)"

count=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
assert_eq "$count" "1" "intent file written after empty-flag clear"

finalize_test
