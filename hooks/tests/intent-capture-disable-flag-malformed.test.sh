#!/usr/bin/env bash
# intent-capture: a malformed (non-JSON) disable flag must auto-clear so the
# user isn't permanently wedged after a partial write (ENOSPC etc.). The hook
# then writes the intent file as normal.
# Backlog: "intent-capture disable flag — malformed → STALE handling".
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOOK_HOME/.autopilot"
DISABLE_FLAG="$HOOK_HOME/.autopilot/intent-capture.disabled"
# Fresh (not stale) but invalid JSON — only the malformed branch can clear it.
printf '{this is a partial wri' > "$DISABLE_FLAG"

payload='{"session_id":"malformed","tool_name":"Bash","tool_input":{"command":"x"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "exit 0 after malformed-flag clear"
assert_file_absent "$DISABLE_FLAG" "malformed disable flag auto-cleared"

count=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
assert_eq "$count" "1" "intent file written after malformed-flag clear (self-heal)"

finalize_test
