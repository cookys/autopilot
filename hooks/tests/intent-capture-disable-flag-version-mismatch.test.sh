#!/usr/bin/env bash
# intent-capture: disable flag stamped with a different plugin_version must
# auto-clear (release-bump treats prior failure as resolved).
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOOK_HOME/.autopilot"
DISABLE_FLAG="$HOOK_HOME/.autopilot/intent-capture.disabled"

# The hook reads .claude-plugin/plugin.json under CLAUDE_PLUGIN_ROOT to get the
# current version. Stamp the flag with a deliberately-wrong version so the
# version-mismatch branch fires.
echo '{"disabled_at":"2026-01-01T00:00:00Z","plugin_version":"0.0.0-test-mismatch"}' > "$DISABLE_FLAG"

payload='{"session_id":"vermismatch","tool_name":"Bash","tool_input":{"command":"x"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "exit 0 after version-mismatch clear"
assert_file_absent "$DISABLE_FLAG" "version-mismatched flag auto-cleared"

count=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
assert_eq "$count" "1" "intent file written after version-mismatch clear"

finalize_test
