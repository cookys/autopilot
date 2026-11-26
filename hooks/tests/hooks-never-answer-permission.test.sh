#!/usr/bin/env bash
# A hook that rewrites tool input must not also grant permission: with permissionDecision "allow" the
# user's own prompt for that call is answered by the hook. Covers depth0-delegate-gate (Bash rewrite);
# fleet-dispatch-class and dispatch-model-guard assert the same in their own suites.
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID
. "$(dirname "$0")/lib.sh"

HOOK_PATH="$REPO_ROOT/hooks/depth0-delegate-gate.js"
PAYLOAD='{"hook_event_name":"PreToolUse","tool_name":"Bash","session_id":"s-never-answer","cwd":"/tmp","tool_input":{"command":"ls"}}'

__RUN_STDOUT="$(printf '%s' "$PAYLOAD" | env -u AUTOPILOT_SESSION_ID HOME="$TEST_TMP" node "$HOOK_PATH" 2>/dev/null)"
assert_contains "$__RUN_STDOUT" '"updatedInput"' "bare ls is rewritten through updatedInput"
assert_contains "$__RUN_STDOUT" 'command ls' "rewrite is the command-ls form"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "rewrite never carries a permission decision"

finalize_test
