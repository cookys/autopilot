#!/usr/bin/env bash
# LLM Context guidance must enumerate the six Fable-5.1 compaction-preservation
# categories (Anthropic "Prompting Claude Fable 5.1" guide, "Tell the model
# what to preserve in compaction summaries"): difficulties encountered, options
# considered (incl. ruled out), exact decisions/constraints/preferences,
# current state, open items, and exact names/paths/values. Before this change
# the section only prompted for "excluded possibilities" — options considered
# was implicit and "ruled out ... stated exactly" wasn't prompted for at all.
. "$(dirname "$0")/lib.sh"

FIXTURE="$(dirname "$0")/fixtures/transcript-minimal.jsonl"
SANDBOX_FIXTURE="$HOOK_HOME/transcript-minimal.jsonl"
cp "$FIXTURE" "$SANDBOX_FIXTURE"

payload="{\"transcript_path\":\"$SANDBOX_FIXTURE\",\"session_id\":\"llm-ctx-categories\"}"
run_hook state-checkpoint.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "fail-open on minimal transcript"

state_content=$(cat "$HOOK_HOME/.autopilot/compaction-state.md" 2>/dev/null || echo "")

assert_contains "$state_content" "Difficulties or problems encountered" "category 1 (difficulties) prompted"
assert_contains "$state_content" "Options considered (including ones ruled out, and why)" "category 2 (options considered / ruled out) prompted"
assert_contains "$state_content" "quote it EXACTLY, do not paraphrase" "category 3 (stated exactly, not paraphrased) prompted"
assert_contains "$state_content" "Current state of the work" "category 4 (current state) prompted"
assert_contains "$state_content" "Open items / what remains" "category 5 (open items) prompted"
assert_contains "$state_content" "Exact names, paths, and values" "category 6 (exact details) prompted"

hook_source=$(cat "$HOOKS_DIR/state-checkpoint.js")
assert_contains "$hook_source" "prompting-claude-fable-5-1" "guide cited as the source in the hook comment"

finalize_test
