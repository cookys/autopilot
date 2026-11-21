#!/usr/bin/env node
/**
 * session-mode-refresh — UserPromptSubmit hook: the /clear fallback refresh (plan §5.A, Fleet-Task
 * 01M7YVR04S7M46JNCTRGR68C47).
 *
 * /clear fires SessionEnd (hooks/session-mode-end.js clamps the l3–l6 marker to now + 20 min) but does
 * NOT reliably re-fire SessionStart (unverified — the design deliberately does not depend on it), so the
 * first prompt does the resume refresh: scripts/session-mode.js
 * `refreshClampedMarkerOnUserPromptSubmit(session_id)` re-extends a still-unexpired clamped l3–l6 marker
 * to prompt time + 24 h, in place under the marker lock, keeping level, stage, root_run_id and every
 * other field. An EXPIRED marker is never revived (the first prompt must arrive before the clamped
 * expiry); plain markers and markers whose expiry is still beyond the 20-minute resume grace are
 * untouched (a running session's own TTL keeps its own algorithm).
 *
 * Silent by design: UserPromptSubmit stdout becomes model context, so the hook prints nothing on
 * success and exits 0 on every path (fail-open; one stderr line on error only). It never guesses a
 * session id.
 */

'use strict';

const fs = require('fs');

const TAG = 'session-mode-refresh';

function main() {
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; } // not JSON: fail open, touch nothing
  if (!payload || typeof payload !== 'object') return;
  const sid = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!sid) return; // nothing to key the refresh by
  const { refreshClampedMarkerOnUserPromptSubmit } = require('../scripts/session-mode.js');
  // absent | mismatch | unreadable | expired | refreshed | untouched — every outcome is legal and silent.
  refreshClampedMarkerOnUserPromptSubmit(sid);
}

try { main(); } catch (error) {
  process.stderr.write(`${TAG}: ${error.message}\n`);
}
process.exit(0);
