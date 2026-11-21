#!/usr/bin/env node
/**
 * session-mode-end — SessionEnd hook: the marker dies with the session (plan §5.A, Fleet-Task
 * 01M7YVR04S7M46JNCTRGR68C47).
 *
 * Reads the SessionEnd payload on fd 0 ({ session_id, reason, ... }) and calls
 * scripts/session-mode.js `endSession(session_id, { parentSessionId })`, which under the per-marker
 * write lock:
 *   - deletes a PLAIN marker (level null) — SessionStart's ensurePlainMarker rebuilds it on resume;
 *   - deletes an already-EXPIRED marker BEFORE any retention check;
 *   - keeps an unexpired l5/l6 marker with campaign_roots (the only session↔campaign link);
 *   - clamps an unexpired l3–l6 marker without campaigns IN PLACE to now + 20 min (RESUME_GRACE_MS):
 *     an immediate resume or /clear still finds level, stage, root_run_id; unresumed, it is
 *     collected 20 minutes later. The first prompt after a /clear re-arms the full 24 h TTL via
 *     hooks/session-mode-refresh.js (UserPromptSubmit) while the clamped expiry is still live.
 *
 * SessionEnd does not always fire (crash, kill -9): expired residue then dies through the sweep
 * (`node scripts/session-mode.js sweep --grace-ms 0`) and the reader-side unlink — this hook is the
 * fast path, not the only one. The payload `reason` is NOT consulted (its value list is unverified;
 * the behaviour is per marker state, and reason=clear is handled exactly like any other end —
 * pinned by hooks/session-mode-end.test.js test 11).
 *
 * Opt out: AUTOPILOT_SESSION_END_CLEANUP=0 (also off/false/no, case-insensitive). Fail-open: bad or
 * empty stdin, a missing/empty session_id, or any error exits 0 and touches nothing. The hook
 * never guesses a session id (a wrong-keyed deletion is worse than none) and prints nothing on
 * success (SessionEnd stdout is not model context anyway; one stderr line on failure only).
 */

'use strict';

const fs = require('fs');

const TAG = 'session-mode-end';

function knobOff() {
  const v = process.env.AUTOPILOT_SESSION_END_CLEANUP;
  if (typeof v !== 'string') return false;
  return ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function main() {
  if (knobOff()) return;
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; } // not JSON: fail open, delete nothing
  if (!payload || typeof payload !== 'object') return;
  const sid = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!sid) return; // nothing to key the deletion by
  const { endSession } = require('../scripts/session-mode.js');
  // absent | mismatch | refused_parent | removed | kept_campaign | clamped — every outcome is legal,
  // nothing is printed on success.
  endSession(sid, { parentSessionId: process.env.AUTOPILOT_PARENT_SESSION_ID });
}

try { main(); } catch (error) {
  process.stderr.write(`${TAG}: ${error.message}\n`);
}
process.exit(0);
