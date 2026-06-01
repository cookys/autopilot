#!/usr/bin/env bash
# R10-E — newest turn ≤ byte-cap should be preserved verbatim, NOT truncated by
# the per-turn budget that applies to older turns. This was the v2.7.2 critical
# fix the test suite is here to regress-net.
. "$(dirname "$0")/lib.sh"

# Build a fixture inline: 1 small older turn + 1 large (3000 byte) newest turn.
BIG=$(printf 'X%.0s' {1..3000})
SANDBOX_FIXTURE="$HOOK_HOME/transcript-newest-verbatim.jsonl"
{
  printf '%s\n' "$(printf '{"type":"user","timestamp":"T1","message":{"content":"older small"}}')"
  printf '%s\n' "$(printf '{"type":"assistant","timestamp":"T2","message":{"content":"%s"}}' "$BIG")"
} > "$SANDBOX_FIXTURE"

payload="{\"transcript_path\":\"$SANDBOX_FIXTURE\",\"session_id\":\"r10e\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open with large newest turn"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
# Newest verbatim: the 3000 X's appear AND no "turn truncated" marker for newest.
big_count=$(grep -oE "X{3000}" "$HOOK_HOME/.autopilot/compaction-state.md" | wc -l)
assert_neq "$big_count" "0" "full 3000-char newest body preserved verbatim"
assert_not_contains "$state_content" "[...turn truncated, original size: 3000B]" "newest NOT per-turn-truncated"

finalize_test
