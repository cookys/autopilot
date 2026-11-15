/**
 * stuck-hand-lib — PostToolUse leg hosted by audit-log.js (default-on; no process of its own, so the PostToolUse
 * spawn budget stays at five)
 *
 * Tells the dispatching session, once per run, that a hand it launched has gone quiet: the run manifest has
 * no ended_at and, for AUTOPILOT_STUCK_HAND_MINUTES (default 30), its log, worktree, HEAD and process CPU all
 * stood still (scripts/stuck-hand-check.js owns the detection). The notice goes only to the session whose id the
 * manifest recorded (`session_id`), as PostToolUse additionalContext, the same per-session channel reload-watch uses.
 * Throttled to one scan per 60 s (shared stamp under the live base). Fail-open: any error is swallowed. audit-log's chain merges the context object with the other members'.
 * Off switch: AUTOPILOT_STUCK_HAND_MINUTES=0 or off.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { scan, markNotified, statePath } = require('../scripts/stuck-hand-check.js');
const runtimePaths = require('../scripts/lib/runtime-paths.js');

const THROTTLE_MS = 60000;

function run(payload, env = process.env) {
  const knob = String(env.AUTOPILOT_STUCK_HAND_MINUTES || '').trim().toLowerCase();
  if (knob === 'off' || knob === '0') return null;
  if (payload && payload.agent_id) return null; // a subagent fire is not the dispatching session
  const sid = (payload && typeof payload.session_id === 'string' && payload.session_id) || env.CLAUDE_CODE_SESSION_ID || '';
  if (!sid) return null;
  // Hot path: no manifest in the runs dir means nothing to watch, and nothing is created (hook-hosting asserts this).
  try { if (!fs.readdirSync(runtimePaths.runsDir(env)).some((n) => n.endsWith('.manifest.json'))) return null; } catch { return null; }
  const now = env.AUTOPILOT_STUCK_HAND_NOW ? Number(env.AUTOPILOT_STUCK_HAND_NOW) : Date.now();
  const file = statePath(env);
  const stamp = path.join(path.dirname(file), 'last-scan');
  try { if (now - fs.statSync(stamp).mtimeMs < THROTTLE_MS) return null; } catch { /* no stamp yet */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stamp, String(now));
  try { fs.utimesSync(stamp, now / 1000, now / 1000); } catch { /* best effort */ }
  const res = scan({ env, now });
  const mine = res.stuck.filter((s) => s.session_id === sid && !s.notified_at);
  if (!mine.length) return null;
  markNotified(mine.map((s) => s.run_id), file, now);
  return mine.map((s) => `stuck hand: ${s.run_id} (${s.lane || 'no lane'}) quiet ${s.quiet_minutes}m — no output/commit/CPU; check: node scripts/dispatch-status.js --run ${s.run_id}`).join('\n');
}

// Called by audit-log.js with the parsed PostToolUse payload; writes one pure additionalContext object when it has a notice.
function handle(payload) {
  try {
    const msg = run(payload);
    if (msg) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } })}\n`);
  } catch { /* fail-open */ }
}

module.exports = { run, handle };
