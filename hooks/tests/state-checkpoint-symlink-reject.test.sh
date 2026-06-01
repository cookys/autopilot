#!/usr/bin/env bash
# R10-K — transcript path that resolves OUTSIDE the user's $HOME via symlink
# must be rejected (security guard, per v2.7.2 plan). Hook still fail-opens.
. "$(dirname "$0")/lib.sh"

# Create a real transcript outside $HOOK_HOME, then a symlink inside it.
OUTSIDE_TRANSCRIPT="$TEST_TMP/outside-transcript.jsonl"
cp "$(dirname "$0")/fixtures/transcript-minimal.jsonl" "$OUTSIDE_TRANSCRIPT"

# The sandbox $HOOK_HOME is $TEST_TMP/home. The symlink lives outside it
# (still in $TEST_TMP) so resolving it should land outside HOME → rejection
# fires when state-checkpoint inspects realpath.
SYMLINK_PATH="$HOOK_HOME/symlinked.jsonl"
mkdir -p "$(dirname "$SYMLINK_PATH")"
ln -sf "$OUTSIDE_TRANSCRIPT" "$SYMLINK_PATH"

# Sanity: symlink resolves outside $HOOK_HOME
realtarget=$(readlink -f "$SYMLINK_PATH")
assert_not_contains "$realtarget" "$HOOK_HOME/" "symlink target lives outside sandbox HOME"

payload="{\"transcript_path\":\"$SYMLINK_PATH\",\"session_id\":\"r10k\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open on symlink rejection"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")
# Reject path emits a diag (look for either "symlink" or "outside" marker)
case "$state_content" in
  *"symlink"*|*"outside"*|*"resolves"*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "expected symlink-reject diagnostic in state file (got: $(echo "$state_content" | head -3))" ;;
esac

# The diag must surface the resolved $HOME so the user understands the rejection
# (backlog: "Context-handoff state-checkpoint symlink reject — diag detail").
assert_contains "$state_content" "HOME=$HOOK_HOME" "diag echoes the resolved \$HOME value"

finalize_test
