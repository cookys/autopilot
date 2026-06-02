#!/usr/bin/env bash
# audit-log transcript fallback (B-P4): with no stdin (ENXIO on real PostToolUse),
# audit-log recovers the Bash command from the transcript and logs it.
. "$(dirname "$0")/lib.sh"

export CLAUDE_CODE_SESSION_ID="dddd0000-1111-2222-3333-444455556666"
TDIR="$HOOK_HOME/.claude/projects/-enc"
mkdir -p "$TDIR"
cat > "$TDIR/$CLAUDE_CODE_SESSION_ID.jsonl" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"b1","name":"Bash","input":{"command":"echo hello-from-transcript","description":"x"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b1","content":"hello-from-transcript","is_error":false}]}}
EOF

run_hook audit-log.js   # empty stdin → transcript fallback
assert_exit_code "$__RUN_EXIT" 0 "fail-open with empty stdin"

LOG="$HOOK_HOME/.claude/bash-commands.log"
assert_file_exists "$LOG" "bash-commands.log written via transcript"
assert_contains "$(cat "$LOG" 2>/dev/null)" "echo hello-from-transcript" "command recovered from transcript"

# Negative: no transcript → no command → no log, still fail-open.
rm -f "$TDIR/$CLAUDE_CODE_SESSION_ID.jsonl"
export CLAUDE_CODE_SESSION_ID="00000000-0000-0000-0000-000000000000"
run_hook audit-log.js
assert_exit_code "$__RUN_EXIT" 0 "fail-open when no transcript"

finalize_test
