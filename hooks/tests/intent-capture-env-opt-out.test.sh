#!/usr/bin/env bash
# intent-capture: AUTOPILOT_INTENT_CAPTURE=false must short-circuit before any
# fs writes. No intent file, no failure counter, no disable flag.
. "$(dirname "$0")/lib.sh"

# Manual invocation — bypass run_hook so we can inject the opt-out env var.
mkdir -p "$HOOK_HOME"
payload='{"session_id":"opt-out","tool_name":"Bash","tool_input":{"command":"x"}}'
HOME="$HOOK_HOME" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" AUTOPILOT_INTENT_CAPTURE=false \
  node "$HOOKS_DIR/intent-capture.js" <<< "$payload"
ec=$?

assert_exit_code "$ec" 0 "exit 0 when env-disabled"
assert_file_absent "$HOOK_HOME/.autopilot/intent" "no intent dir created when opted out"

finalize_test
