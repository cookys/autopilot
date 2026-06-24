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

# Test environment without CLAUDE_PLUGIN_ROOT
stdout_no_root=$(HOME="$HOOK_HOME" node "$HOOKS_DIR/session-start.js" 2>/dev/null)
assert_contains "$stdout_no_root" '"additional_context"' "raw output structure when CLAUDE_PLUGIN_ROOT is absent"

# 2. Test Compaction State Recovery (within TTL)
echo "RestoreStateTestContent" > "$HOOK_HOME/.autopilot/compaction-state.md"
run_hook session-start.js
assert_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "contains recovery title"
assert_contains "$__RUN_STDOUT" "RestoreStateTestContent" "contains compaction state content"

# 3. Test Compaction State Recovery (expired TTL - default 4h)
# Modify mtime to 5 hours ago
node -e "const fs = require('fs'); const file = '$HOOK_HOME/.autopilot/compaction-state.md'; const t = Date.now() - 5 * 3600 * 1000; fs.utimesSync(file, new Date(t), new Date(t));"
run_hook session-start.js
assert_not_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should not contain recovery since it is expired"

# 4. Test Compaction State Recovery (expired TTL with custom TTL in config.json)
# Custom TTL = 6 hours, file is 5 hours old -> should recover!
echo '{"compaction_ttl_hours": 6}' > "$HOOK_HOME/.autopilot/config.json"
run_hook session-start.js
assert_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should recover with custom TTL 6 hours when age is 5 hours"

# Custom TTL = 6 hours, file is 7 hours old -> should NOT recover!
node -e "const fs = require('fs'); const file = '$HOOK_HOME/.autopilot/compaction-state.md'; const t = Date.now() - 7 * 3600 * 1000; fs.utimesSync(file, new Date(t), new Date(t));"
run_hook session-start.js
assert_not_contains "$__RUN_STDOUT" "[Autopilot State Recovery — Post-Compaction]" "should not recover with custom TTL 6 hours when age is 7 hours"

# Clean up compaction state file for subsequent tests
rm -f "$HOOK_HOME/.autopilot/compaction-state.md"
rm -f "$HOOK_HOME/.autopilot/config.json"

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

# 8. Verify shell wrapper delegation
# The shell wrapper hooks/session-start.sh should run node hooks/session-start.js
# Let's write the compaction recovery file again to check if delegating works
echo "WrapperTestRecoveryContent" > "$HOOK_HOME/.autopilot/compaction-state.md"
run_hook session-start.sh
assert_exit_code "$__RUN_EXIT" 0 "wrapper exits 0"
assert_contains "$__RUN_STDOUT" "WrapperTestRecoveryContent" "wrapper output contains compaction state content"

# 9. Test Fail-Open Posture (corrupt config.json / syntax error handling or unexpected crashes)
# Write a broken JSON to config.json
echo "invalid json content" > "$HOOK_HOME/.autopilot/config.json"
run_hook session-start.js
assert_exit_code "$__RUN_EXIT" 0 "fail-open on malformed config.json"
assert_contains "$__RUN_STDOUT" "autopilot:dev-flow" "base context still outputted"

finalize_test
