#!/usr/bin/env bash
# hooks/tests/session-start.test.sh — tests for the session-start Node.js hook.

. "$(dirname "$0")/lib.sh"

# Ensure ~/.autopilot directories are set up in the sandboxed HOOK_HOME
mkdir -p "$HOOK_HOME/.autopilot"
mkdir -p "$HOOK_HOME/.autopilot/intent"

# 1. Test Base Context
run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "exit code 0 for normal run"
assert_contains "$__RUN_STDOUT" '"hookSpecificOutput"' "plugin output structure when CLAUDE_PLUGIN_ROOT is set"
assert_contains "$__RUN_STDOUT" "autopilot:dev-flow" "contains dev-flow skill trigger"

# Test environment without CLAUDE_PLUGIN_ROOT. Keep the parent stdin deliberately
# open through a FIFO while the direct hook invocation receives explicit EOF. The
# bounded timeout is an assertion: rc=124 means the hook inherited stdin and hung.
held_open_stdin="$TEST_TMP/held-open.stdin"
mkfifo "$held_open_stdin"
(
  exec 9>"$held_open_stdin"
  sleep 30
) &
stdin_holder_pid=$!
set +e
stdout_no_root=$(timeout 3s bash -c \
  'env -u CLAUDE_PLUGIN_ROOT HOME="$1" TMPDIR="$2" node "$3" </dev/null' \
  _ "$HOOK_HOME" "$HOOK_TMPDIR" "$HOOKS_DIR/session-start.js" \
  < "$held_open_stdin" 2>/dev/null)
stdout_no_root_exit=$?
set +e
kill "$stdin_holder_pid" 2>/dev/null || true
wait "$stdin_holder_pid" 2>/dev/null || true
assert_exit_code "$stdout_no_root_exit" 0 "no-root hook completes while parent stdin remains open"
assert_contains "$stdout_no_root" '"additional_context"' "raw output structure when CLAUDE_PLUGIN_ROOT is absent"

# 2. Compaction state recovery: per-session file, injected only on source=compact
# for the same session id, consumed (deleted) by the hook.
AP="$HOOK_HOME/.autopilot"
mkdir -p "$AP"
COMPACT_A='{"source":"compact","session_id":"sess-a"}'
COMPACT_B='{"source":"compact","session_id":"sess-b"}'
STARTUP_A='{"source":"startup","session_id":"sess-a"}'
age_file() { node -e "const fs=require('fs');const t=Date.now()-Number(process.argv[2])*3600*1000;fs.utimesSync(process.argv[1],new Date(t),new Date(t));" "$1" "$2"; }

echo "RestoreStateTestContent" > "$AP/compaction-state-sess-a.md"
run_hook session-start.js "$COMPACT_B"
assert_not_contains "$__RUN_STDOUT" "RestoreStateTestContent" "another session's compaction never injects this state"
assert_file_exists "$AP/compaction-state-sess-a.md" "another session's compaction leaves the file alone"

run_hook session-start.js "$STARTUP_A"
assert_not_contains "$__RUN_STDOUT" "RestoreStateTestContent" "startup for the same session id does not inject"
assert_file_exists "$AP/compaction-state-sess-a.md" "startup leaves a fresh file alone"

run_hook session-start.js "$COMPACT_A"
assert_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "contains recovery title"
assert_contains "$__RUN_STDOUT" "RestoreStateTestContent" "contains compaction state content"
assert_file_absent "$AP/compaction-state-sess-a.md" "the hook consumes the file after injecting"
run_hook session-start.js "$COMPACT_A"
assert_not_contains "$__RUN_STDOUT" "RestoreStateTestContent" "a consumed checkpoint is not injected twice"

# 3. Expired TTL (default 4h): not injected, and removed.
echo "RestoreStateTestContent" > "$AP/compaction-state-sess-a.md"
age_file "$AP/compaction-state-sess-a.md" 5
run_hook session-start.js "$COMPACT_A"
assert_not_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should not contain recovery since it is expired"
assert_file_absent "$AP/compaction-state-sess-a.md" "an expired checkpoint is removed"

# 4. Custom TTL in config.json: 6h recovers a 5h-old file, not a 7h-old one.
echo '{"compaction_ttl_hours": 6}' > "$AP/config.json"
echo "RestoreStateTestContent" > "$AP/compaction-state-sess-a.md"
age_file "$AP/compaction-state-sess-a.md" 5
run_hook session-start.js "$COMPACT_A"
assert_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should recover with custom TTL 6 hours when age is 5 hours"
echo "RestoreStateTestContent" > "$AP/compaction-state-sess-a.md"
age_file "$AP/compaction-state-sess-a.md" 7
run_hook session-start.js "$COMPACT_A"
assert_not_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should not recover with custom TTL 6 hours when age is 7 hours"
rm -f "$AP/config.json"

# 4b. Sweep: the legacy global file goes at any age; another session's file
# goes only past the TTL.
echo "legacy" > "$AP/compaction-state.md"
echo "fresh" > "$AP/compaction-state-sess-c.md"
echo "stale" > "$AP/compaction-state-sess-d.md"
age_file "$AP/compaction-state-sess-d.md" 5
run_hook session-start.js "$STARTUP_A"
assert_file_absent "$AP/compaction-state.md" "legacy global checkpoint swept"
assert_file_exists "$AP/compaction-state-sess-c.md" "another session's fresh checkpoint kept"
assert_file_absent "$AP/compaction-state-sess-d.md" "another session's expired checkpoint swept"
rm -f "$AP"/compaction-state-*.md

# 5. Test Intent Resume Hint (Matching Hostname)
cwd_hash=$(node -e "const fs = require('fs'); const crypto = require('crypto'); console.log(crypto.createHash('sha1').update(fs.realpathSync('.')).digest('hex'));")
hostname=$(node -e "console.log(require('os').hostname() || 'unknown')")

intent_file="$HOOK_HOME/.autopilot/intent/${cwd_hash}.json"
echo "{\"hostname\":\"$hostname\",\"last_updated\":\"12:34\",\"last_tool_input_summary\":\"git commit -m 'hello'\",\"git_branch\":\"feat/test-branch\"}" > "$intent_file"

run_hook session-start.js
assert_contains "$__RUN_STDOUT" "[Autopilot Resume Hint]" "contains resume hint title"
assert_contains "$__RUN_STDOUT" "12:34" "contains last updated time"
assert_contains "$__RUN_STDOUT" "git commit -m 'hello'" "contains tool summary"
assert_contains "$__RUN_STDOUT" "Branch: feat/test-branch" "contains branch name"

# 6. Test Intent Resume Hint (Mismatching Hostname)
echo "{\"hostname\":\"different-host-name\",\"last_updated\":\"12:34\",\"last_tool_input_summary\":\"git commit -m 'hello'\",\"git_branch\":\"feat/test-branch\"}" > "$intent_file"
run_hook session-start.js
assert_not_contains "$__RUN_STDOUT" "[Autopilot Resume Hint]" "should not contain resume hint for mismatching hostname"

# Clean up intent file
rm -f "$intent_file"

# 7. Test Intent Capture Disabled Warning
echo "1" > "$HOOK_HOME/.autopilot/intent-capture.disabled"
run_hook session-start.js
assert_contains "$__RUN_STDOUT" "⚠ intent-capture hook disabled" "contains disabled warning"

# Clean up warning flag
rm -f "$HOOK_HOME/.autopilot/intent-capture.disabled"

# 9. Test Fail-Open Posture (corrupt config.json / syntax error handling or unexpected crashes)
# Write a broken JSON to config.json
echo "invalid json content" > "$HOOK_HOME/.autopilot/config.json"
run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "fail-open on malformed config.json"
assert_contains "$__RUN_STDOUT" "autopilot:dev-flow" "base context still outputted"

finalize_test
