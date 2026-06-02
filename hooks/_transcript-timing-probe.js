'use strict';
// TEMPORARY diagnostic (B-P2, hook-transcript-pivot). NOT a shipped hook.
//
// PostToolUse probe: on each fire, record the latest tool event recovered from
// the transcript via transcript-reader-lib. This answers the one spike unknown
// that static analysis can't — the intra-cycle race between Claude Code flushing
// the tool entry to the transcript and dispatching PostToolUse.
//
// HOW TO RUN (the human gate before re-enabling any blocker hook):
//   1. On branch feat/hook-transcript-pivot, in a NEW terminal:  claude
//      (the branch hooks.json wires this probe into PostToolUse)
//   2. In that session run a few DISTINCTIVE tool calls, e.g.:
//        echo PROBE_MARKER_ONE
//        (read any file)
//        echo PROBE_MARKER_TWO
//   3. Exit, then:  cat ~/.autopilot/timing-probe.log
//   4. GREEN if each line's "tool"/"input" tracks the command you JUST ran
//      (PROBE_MARKER_ONE appears on the fire right after that echo, etc.).
//      RED if it consistently lags by one tool → transcript flushed AFTER
//      PostToolUse → pivot is NO-GO for same-cycle data (document + close).
//   5. Remove this entry from hooks.json (done in B-P3).
//
// Fail-open: any error → silent exit 0.
const fs = require('fs');
const os = require('os');
const path = require('path');

try {
  const { readLatestToolEvent } = require(path.join(__dirname, 'transcript-reader-lib.js'));
  const ev = readLatestToolEvent({ env: process.env });
  const dir = path.join(os.homedir(), '.autopilot');
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    found: !!ev,
    tool: ev ? ev.tool_name : null,
    input: ev ? JSON.stringify(ev.tool_input).slice(0, 120) : null,
    has_response: ev ? ev.tool_response !== undefined : false,
  }) + '\n';
  fs.appendFileSync(path.join(dir, 'timing-probe.log'), line);
} catch {
  /* fail-open — never block */
}
process.exit(0);
