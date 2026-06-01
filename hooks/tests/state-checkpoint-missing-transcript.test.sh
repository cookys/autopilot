#!/usr/bin/env bash
# R10-B — payload references a transcript file that doesn't exist. Hook must
# fail-open with a clear "transcript file not found" message in the state file.
. "$(dirname "$0")/lib.sh"

payload='{"transcript_path":"/nonexistent/path/to/transcript.jsonl","session_id":"test-session"}'
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open on missing transcript file"
assert_file_exists "$HOOK_HOME/.autopilot/compaction-state.md" "state file written"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
assert_contains "$state_content" "transcript file not found" "state records the missing-file reason"

finalize_test
