#!/usr/bin/env bash
# transcript-reader-tail: integration tests for bounded tail-window, canary, and fallback.
. "$(dirname "$0")/lib.sh"

# Create a temporary projects dir
PROJ_DIR="$HOOK_HOME/.claude/projects/some-project"
mkdir -p "$PROJ_DIR"

# Case 1: Small file (no canary, event found)
# We use a session id
export CLAUDE_CODE_SESSION_ID="session-small"
cat <<EOF > "$PROJ_DIR/session-small.jsonl"
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"done"}]}}
EOF

output=$(node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  const ev = reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
  console.log(JSON.stringify(ev));
")
assert_contains "$output" '"tool_name":"Bash"' "found event in small file"
assert_file_absent "$HOOK_HOME/.autopilot/transcript-canary.log" "no canary for small file"

# Case 2: Schema changed (returns null + triggers canary once)
export CLAUDE_CODE_SESSION_ID="session-canary"
cat <<EOF > "$PROJ_DIR/session-canary.jsonl"
{"type":"assistant","message":{"role":"assistant","content":[{"type":"wrong_key","id":"t1"}]}}
EOF

# Call once
node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
" 2>/dev/null

assert_file_exists "$HOOK_HOME/.autopilot/transcript-canary.log" "canary log created"
assert_file_exists "$HOOK_HOME/.autopilot/.canary-session-canary" "marker file created"

log_count=$(wc -l < "$HOOK_HOME/.autopilot/transcript-canary.log")
assert_eq "$log_count" "1" "canary logged exactly once"

# Call twice
node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
" 2>/dev/null
log_count=$(wc -l < "$HOOK_HOME/.autopilot/transcript-canary.log")
assert_eq "$log_count" "1" "canary still logged exactly once (deduped)"

# Case 3: AUTOPILOT_NO_CANARY=1 disables canary
export CLAUDE_CODE_SESSION_ID="session-disabled"
cat <<EOF > "$PROJ_DIR/session-disabled.jsonl"
{"type":"assistant","message":{"role":"assistant","content":[{"type":"wrong_key","id":"t2"}]}}
EOF

export AUTOPILOT_NO_CANARY=1
node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
" 2>/dev/null
assert_file_absent "$HOOK_HOME/.autopilot/.canary-session-disabled" "marker not created when disabled"
unset AUTOPILOT_NO_CANARY

# Case 4: Tail-window read vs Fallback
export CLAUDE_CODE_SESSION_ID="session-tail"
# We'll override the window size in the node command
output=$(export AUTOPILOT_TAIL_WINDOW_BYTES=200; node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  
  // Create a file larger than 200 bytes with noise at start
  const fs = require('fs');
  const path = require('path');
  const noise = '{\"type\":\"system\",\"content\":\"' + 'x'.repeat(400) + '\"}\n';
  const event1 = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] }
  }) + '\n';
  const event2 = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'res' }] }
  }) + '\n';
  
  fs.writeFileSync('$PROJ_DIR/session-tail.jsonl', noise + event1 + event2);
  
  const ev = reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
  console.log(JSON.stringify(ev));
")
assert_contains "$output" '"tool_name":"Bash"' "found event in tail-window path"

# Case 5: Event beyond window fallback
export CLAUDE_CODE_SESSION_ID="session-fallback"
output=$(export AUTOPILOT_TAIL_WINDOW_BYTES=200; node -e "
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  const fs = require('fs');
  
  const event1 = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] }
  }) + '\n';
  const event2 = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'res' }] }
  }) + '\n';
  const noise = '{\"type\":\"system\",\"content\":\"' + 'x'.repeat(400) + '\"}\n';
  
  fs.writeFileSync('$PROJ_DIR/session-fallback.jsonl', event1 + event2 + noise);
  
  const ev = reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
  console.log(JSON.stringify(ev));
")
assert_contains "$output" '"tool_name":"Bash"' "found event beyond window via fallback"

# Case 6: Line boundary alignment tail-read (no fallback)
export CLAUDE_CODE_SESSION_ID="session-boundary"
output=$(export AUTOPILOT_TAIL_WINDOW_BYTES=200; node -e "
  const fs = require('fs');
  const path = require('path');
  
  // Spy on fs.readFileSync to detect if fallback occurs
  const originalRead = fs.readFileSync;
  let fallbackCalled = false;
  fs.readFileSync = function(p, opts) {
    if (p.includes('session-boundary')) {
      fallbackCalled = true;
    }
    return originalRead.call(fs, p, opts);
  };
  
  const reader = require('$HOOKS_DIR/transcript-reader-lib.js');
  
  const noise = '{\"type\":\"system\",\"content\":\"' + 'x'.repeat(400) + '\"}\n';
  const event1 = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] }
  }) + '\n';
  const event2 = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'res' }] }
  }) + '\n';
  
  // Total size of event1 + event2
  const eventBytes = Buffer.byteLength(event1 + event2, 'utf8');
  
  // We write the file with noise + event1 + event2.
  fs.writeFileSync('$PROJ_DIR/session-boundary.jsonl', noise + event1 + event2);
  
  // Set windowBytes exactly to eventBytes
  process.env.AUTOPILOT_TAIL_WINDOW_BYTES = String(eventBytes);
  
  const ev = reader.readLatestToolEvent({ homedir: '$HOOK_HOME' });
  console.log(JSON.stringify({ ev, fallbackCalled }));
")
assert_contains "$output" '"tool_name":"Bash"' "found event when aligned exactly on boundary"
assert_contains "$output" '"fallbackCalled":false' "did not fall back to full file read"

finalize_test
