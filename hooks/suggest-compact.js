#!/usr/bin/env node
/**
 * suggest-compact — PostToolUse/Write|Edit (Tier A, default-on; re-enabled v2.8.1)
 *
 * Counts Write|Edit tool calls per session; nudges /compact at 50, then every 25
 * (unbounded: 50, 75, 100, …). Counter at /tmp/claude-tool-count-{sessionId}.
 *
 * Does NOT need tool_name — the Write|Edit matcher does the filtering — so unlike
 * the other PostToolUse hooks it needs no transcript recovery. The ONE thing that
 * broke it pre-v2.8.1: opening /dev/stdin throws ENXIO (broken stdin pipe, #6305)
 * and that read used to be the first statement in the sole try, so the counter
 * never incremented. Fix: the stdin read is now isolated in its own inner try and
 * the counter logic runs regardless (see consumeStdin / main).
 *
 * Self-disable: AUTOPILOT_SUGGEST_COMPACT=false → skip.
 * Fail-open: exit 0 always.
 *
 * Caveat (shared by every PostToolUse hook): if the dispatch table is dead
 * mid-session (after /clear, before a full restart — see hooks/README.md "Is my
 * dispatch dead?"), this hook stops firing and the nudge goes silent.
 *
 * Known/accepted: the /tmp counter is never GC-ed, and on a session-id collision
 * (CLAUDE_CODE_SESSION_ID unset → cwd fallback) an inherited count can cross a
 * threshold on the first tool call of a new session. Low harm (a stale nudge).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { compactDecision } = require('./suggest-compact-lib.js');

function getSessionId() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.cwd();
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// Consume stdin if Claude Code ever pipes it. Isolated so an ENXIO/parse failure
// on the broken stdin pipe does NOT abort the counter increment below.
// The read path is overridable (AUTOPILOT_SUGGEST_COMPACT_STDIN) ONLY so the test
// can point it at a guaranteed-throwing path to prove the isolation holds — /dev/null
// returns '' without throwing, so it cannot exercise the ENXIO branch. Prod: /dev/stdin.
function consumeStdin() {
  try {
    fs.readFileSync(process.env.AUTOPILOT_SUGGEST_COMPACT_STDIN || '/dev/stdin', 'utf8');
  } catch {
    /* ENXIO/parse — broken stdin pipe (#6305). Counting does not need stdin. */
  }
}

(function main() {
  try {
    // Env opt-out
    if (process.env.AUTOPILOT_SUGGEST_COMPACT === 'false') {
      process.exit(0);
    }

    consumeStdin();

    const sid = getSessionId();
    const countFile = path.join(os.tmpdir(), `claude-tool-count-${sid}`);

    let count = 0;
    try {
      count = parseInt(fs.readFileSync(countFile, 'utf8'), 10) || 0;
    } catch {
      // First call this session
    }

    count += 1;
    fs.writeFileSync(countFile, String(count));

    const decision = compactDecision(count);
    if (decision.warn) {
      process.stderr.write(decision.message + '\n');
    }
  } catch (e) {
    process.stderr.write(`suggest-compact error: ${e.message}\n`);
  }
  process.exit(0);
})();
