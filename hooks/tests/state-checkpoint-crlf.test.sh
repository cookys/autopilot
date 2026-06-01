#!/usr/bin/env bash
# R10-H — transcript with CRLF line endings (Windows-origin) must be parsed
# correctly. Both turns should appear in the rendered tail.
. "$(dirname "$0")/lib.sh"

FIXTURE="$(dirname "$0")/fixtures/transcript-crlf.jsonl"
SANDBOX_FIXTURE="$HOOK_HOME/transcript-crlf.jsonl"
cp "$FIXTURE" "$SANDBOX_FIXTURE"

# Sanity: the fixture really does contain CRLF
crlf_bytes=$(grep -c $'\r' "$SANDBOX_FIXTURE")
assert_neq "$crlf_bytes" "0" "fixture genuinely contains CRLF"

payload="{\"transcript_path\":\"$SANDBOX_FIXTURE\",\"session_id\":\"r10h\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open with CRLF transcript"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
assert_contains "$state_content" "crlf-line1" "first CRLF turn parsed"
assert_contains "$state_content" "crlf-line2" "second CRLF turn parsed"

finalize_test
