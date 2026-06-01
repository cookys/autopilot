#!/usr/bin/env bash
# R10-C — transcript contains invalid JSON lines mixed with valid ones. Hook
# must parse the valid lines and surface the malformed ones in the error count
# without crashing.
. "$(dirname "$0")/lib.sh"

FIXTURE="$(dirname "$0")/fixtures/transcript-malformed.jsonl"
SANDBOX_FIXTURE="$HOOK_HOME/transcript-malformed.jsonl"
cp "$FIXTURE" "$SANDBOX_FIXTURE"

payload="{\"transcript_path\":\"$SANDBOX_FIXTURE\",\"session_id\":\"r10c\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open on malformed lines"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
# The 2 valid lines should make it into the rendered tail
assert_contains "$state_content" "valid" "first valid turn rendered"
assert_contains "$state_content" "also valid" "second valid turn rendered"

finalize_test
