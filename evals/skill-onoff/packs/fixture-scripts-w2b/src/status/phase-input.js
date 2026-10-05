'use strict';

// src/status/phase-input.js — the phase a session declared on its session-mode marker (mods P1W W2b-m, read side).
// The writer is `session-mode.js set --phase <name>` (marker fields `phase` + `phase_set_at`). Only markers the caller
// already filtered as unexpired and of this project count; here the root must also match the scope (null for unbound).
// Two markers with a phase on one scope: the newest phase_set_at wins. Invalid phase (not a trimmed 1-64 char string
// without control characters) is ignored. Returns { phase, phase_set_at, session_id } or null.

function validPhase(p) {
  return typeof p === 'string' && p.length >= 1 && p.length <= 64 && p === p.trim() && !/[\u0000-\u001f\u007f]/.test(p);
}

function readMarkerPhase({ markers, key, root }) {
  let best = null;
  for (const m of markers || []) {
    if (!m || m.project_key !== key || (m.root_run_id || null) !== (root || null) || !validPhase(m.phase)) continue;
    const at = Date.parse(m.phase_set_at);
    const t = Number.isFinite(at) ? at : -Infinity;
    if (!best || t > best.t) best = { t, phase: m.phase, phase_set_at: typeof m.phase_set_at === 'string' ? m.phase_set_at : null, session_id: typeof m.session_id === 'string' ? m.session_id : null };
  }
  return best ? { phase: best.phase, phase_set_at: best.phase_set_at, session_id: best.session_id } : null;
}

module.exports = { readMarkerPhase, validPhase };
