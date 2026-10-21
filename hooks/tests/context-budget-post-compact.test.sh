#!/usr/bin/env bash
# BL-0271: after PostCompact, the next context-budget read of the statusline live file
# advises once when the remaining tokens exceed context_budget.post_compact_warn.
# RED at 84f106ad43771bd0387f00c5208f48ca1073ae7b: no post-compact advisory; 120000 after PostCompact left the advisory count at 0, so the exactly-one check exited 1.
. "$(dirname "$0")/lib.sh"

SID="postcompact-size"
TRANSCRIPT="$TEST_TMP/t.jsonl"
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":1}}}' > "$TRANSCRIPT"

# Keep T1/T2 above every fixture so the only advisory under test is the post-compact one.
export AUTOPILOT_CONTEXT_BUDGET_T1=1000000
export AUTOPILOT_CONTEXT_BUDGET_T2=2000000

write_live() {
  local tokens="$1"
  mkdir -p "$AUTOPILOT_LIVE_DIR/context"
  node -e '
    const fs = require("fs");
    const [file, sid, tokens] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({
      schema_version: 1,
      session_id: sid,
      written_at: new Date().toISOString(),
      writer: "statusline",
      model: {},
      context_window: {
        context_window_size: 200000,
        used_percentage: 1,
        total_input_tokens: Number(tokens),
      },
    }));
  ' "$AUTOPILOT_LIVE_DIR/context/${SID}.json" "$SID" "$tokens"
}

reset_case() {
  rm -rf "$AUTOPILOT_LIVE_DIR/advisories" "$AUTOPILOT_LIVE_DIR/context-budget"
  rm -f "$HOOK_HOME/.autopilot/config.json"
  unset AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN
}

post_compact() {
  local payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({session_id:process.argv[1],hook_event_name:"PostCompact",trigger:"auto",compact_summary:"x",cwd:process.argv[2],transcript_path:process.argv[3]}))' "$SID" "$TEST_TMP" "$TRANSCRIPT")"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/state-checkpoint.js" >"$TEST_TMP/.pc.out" 2>"$TEST_TMP/.pc.err" <<< "$payload"
  PC_EXIT=$?
}

budget() {
  local payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({session_id:process.argv[1],transcript_path:process.argv[2],cwd:process.argv[3]}))' "$SID" "$TRANSCRIPT" "$TEST_TMP")"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/context-budget.js" >"$TEST_TMP/.cb.out" 2>"$TEST_TMP/.cb.err" <<< "$payload"
  CB_EXIT=$?
}

advisory_count() {
  local f="$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl"
  if [ ! -f "$f" ]; then
    echo 0
    return
  fi
  grep -c 'tokens remain after compaction' "$f" || true
}

[ -n "${AUTOPILOT_LIVE_DIR:-}" ] || fail "AUTOPILOT_LIVE_DIR was not set to a temp live dir"
case "$AUTOPILOT_LIVE_DIR" in
  "$HOME"|"$HOME"/*) fail "live dir must not be the real home" ;;
esac

# 40000 is at or below the default 100000: no advisory.
reset_case
write_live 40000
post_compact
assert_exit_code "$PC_EXIT" 0 "PostCompact exits 0 at 40000"
budget
assert_exit_code "$CB_EXIT" 0 "context-budget exits 0 at 40000"
assert_eq "$(advisory_count)" "0" "40000 produces no post-compact advisory"

# 120000 advises exactly once; a second tool call after the same compaction stays silent.
reset_case
write_live 120000
post_compact
budget
assert_exit_code "$CB_EXIT" 0 "context-budget exits 0 at 120000"
assert_eq "$(advisory_count)" "1" "120000 produces exactly one post-compact advisory"
assert_contains "$(cat "$TEST_TMP/.cb.err" "$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl")" "120000 tokens remain after compaction" "advisory states the remaining tokens"
assert_contains "$(cat "$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl")" "43K" "advisory cites the fresh-conversation figure"
assert_contains "$(cat "$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl")" "unverified" "the 43K figure is marked unverified"
assert_contains "$(cat "$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl")" "state file" "advisory suggests updating the state file"
assert_contains "$(cat "$AUTOPILOT_LIVE_DIR/advisories/${SID}.jsonl")" "hand off" "advisory suggests handing off"
budget
assert_eq "$(advisory_count)" "1" "a second call after the same compaction stays silent"

# A new PostCompact re-arms the one reminder.
post_compact
budget
assert_eq "$(advisory_count)" "2" "a second PostCompact re-arms one advisory"

# 0 disables.
reset_case
write_live 120000
export AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN=0
post_compact
budget
assert_eq "$(advisory_count)" "0" "post_compact_warn 0 disables the advisory"
unset AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN

# Invalid value falls back to 100000, so 120000 still advises once.
reset_case
write_live 120000
export AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN=nope
post_compact
budget
assert_eq "$(advisory_count)" "1" "invalid post_compact_warn falls back to 100000"
unset AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN

# Env override beats the default: 200000 is above 120000, so no advisory.
reset_case
write_live 120000
export AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN=200000
post_compact
budget
assert_eq "$(advisory_count)" "0" "env AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN overrides the default"
unset AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN

# Missing live file: measure fails open, exit 0, no advisory.
reset_case
rm -f "$AUTOPILOT_LIVE_DIR/context/${SID}.json"
post_compact
budget
assert_exit_code "$CB_EXIT" 0 "missing live file fails open with exit 0"
assert_eq "$(advisory_count)" "0" "missing live file produces no advisory"

finalize_test
