#!/usr/bin/env bash
# intent-capture transcript fallback (B-P3): when stdin yields nothing (the
# ENXIO case on real PostToolUse hooks), the hook recovers the tool from the
# session transcript JSONL via transcript-reader-lib, instead of writing
# last_tool: <unknown>.
. "$(dirname "$0")/lib.sh"

# A known session id; the transcript file is named <id>.jsonl and located under
# a projects/* dir (transcript-reader uses a UUID glob, so the dir name is free).
export CLAUDE_CODE_SESSION_ID="abc12345-1111-2222-3333-444455556666"
TDIR="$HOOK_HOME/.claude/projects/-any-encoded-dir"
mkdir -p "$TDIR"
cat > "$TDIR/$CLAUDE_CODE_SESSION_ID.jsonl" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"u1","name":"Grep","input":{"pattern":"needle","path":"src"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"u1","content":"3 matches","is_error":false}]}}
EOF

# Empty stdin (second arg omitted → run_hook feeds /dev/null) = the broken-pipe case.
run_hook intent-capture.js

assert_exit_code "$__RUN_EXIT" 0 "fail-open with empty stdin"

intent_file=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | head -1)
assert_file_exists "$intent_file" "intent file written despite empty stdin"
content=$(cat "$intent_file" 2>/dev/null)
assert_contains "$content" '"last_tool": "Grep"' "last_tool recovered from transcript (not <unknown>)"
assert_contains "$content" '"last_tool_source": "transcript"' "source marked transcript"
assert_not_contains "$content" '"last_tool": "<unknown>"' "no longer <unknown> when transcript available"

# Negative: no transcript present → graceful <unknown>, still fail-open.
rm -f "$TDIR/$CLAUDE_CODE_SESSION_ID.jsonl"
export CLAUDE_CODE_SESSION_ID="ffffffff-0000-0000-0000-000000000000"
run_hook intent-capture.js
assert_exit_code "$__RUN_EXIT" 0 "fail-open when no transcript found"

finalize_test
