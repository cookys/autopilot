#!/usr/bin/env bash
# R10-D — newest turn contains only a `thinking` block. Hook must NOT
# binary-drop it (per v2.7.2 fix); the thinking content should appear truncated
# inside a <thinking>…</thinking> wrapper.
. "$(dirname "$0")/lib.sh"

FIXTURE="$(dirname "$0")/fixtures/transcript-thinking-only.jsonl"
SANDBOX_FIXTURE="$HOOK_HOME/transcript-thinking-only.jsonl"
cp "$FIXTURE" "$SANDBOX_FIXTURE"

payload="{\"transcript_path\":\"$SANDBOX_FIXTURE\",\"session_id\":\"r10d\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open with thinking-only newest turn"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
assert_contains "$state_content" "<thinking>" "thinking block preserved (not binary-dropped)"
assert_contains "$state_content" "internal reasoning" "thinking content rendered"

finalize_test
