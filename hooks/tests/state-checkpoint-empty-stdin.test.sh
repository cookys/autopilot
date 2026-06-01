#!/usr/bin/env bash
# R10-A — state-checkpoint with empty stdin must fail-open (exit 0) and emit a
# compaction-state file recording the failure rather than crashing.
. "$(dirname "$0")/lib.sh"

run_hook state-checkpoint.js '{}'

assert_exit_code "$__RUN_EXIT" 0 "fail-open on empty stdin"

# Empty `{}` parses fine but has no transcript_path → hook records the failure
# in the state file (per hooks/state-checkpoint.js emitFailure path, ~line 307).
STATE_FILE="$HOOK_HOME/.autopilot/compaction-state.md"
assert_file_exists "$STATE_FILE" "state file written under sandbox"

state_content=$(cat "$STATE_FILE" 2>/dev/null || echo "")
assert_contains "$state_content" "empty transcript_path" "state file records the failure reason"

# Also confirms our sandbox redirection works: nothing leaked to the real HOME.
assert_file_absent "$HOME/.autopilot/.state-checkpoint.log.test-leak" "sandbox isolation guard (no leak marker)"

finalize_test
