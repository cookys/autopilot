#!/usr/bin/env bash
# intent-capture: a stale (>24h old) disable flag must auto-clear and the hook
# must write the intent file as normal.
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOOK_HOME/.autopilot"
DISABLE_FLAG="$HOOK_HOME/.autopilot/intent-capture.disabled"
echo '{"disabled_at":"2020-01-01T00:00:00Z","plugin_version":"unknown"}' > "$DISABLE_FLAG"
# Mark the flag as 30 hours old (well past STALE_DISABLE_HOURS=24)
touch -d "30 hours ago" "$DISABLE_FLAG" 2>/dev/null || touch -A -300000 "$DISABLE_FLAG"

payload='{"session_id":"stale","tool_name":"Bash","tool_input":{"command":"x"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "exit 0 after stale-flag clear"
assert_file_absent "$DISABLE_FLAG" "stale disable flag auto-cleared"

# Intent file written (proof flag didn't suppress the write)
count=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
assert_eq "$count" "1" "intent file written after stale-clear"

finalize_test
