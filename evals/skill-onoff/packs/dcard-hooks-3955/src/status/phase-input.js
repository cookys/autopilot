'use strict';

// src/status/phase-input.js — the work position a session recorded on its session-mode marker (read side).
// The marker phase fields were removed in stage-graph P2b (plan §0.7); the position now comes from the §2.9
// fields `stage` / `stage_set_at` (written by scripts/stage-advance.js) plus `size`, `urgent`, `level`, `unit`,
// `review_families`. The file keeps its name (plan §2.9 reader list); there is no dual-read of the old fields.
// Only markers the caller already filtered as unexpired and of this project count; the root must also match the scope
// (null for unbound). Two markers with a stage on one scope: the newest stage_set_at wins. A marker without a valid
// `stage` is ignored (size alone is not a position). Returns
// { stage, stage_set_at, size, urgent, level, unit, review_families, session_id } or null.

const STAGES = ['intent', 'diagnose', 'research', 'proposal', 'plan', 'plan-review', 'implement', 'verify', 'code-review', 'qc-gate', 'finish'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

function validStage(s) { return typeof s === 'string' && STAGES.includes(s); }

function cleanUnit(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const { kind, index, total, label } = u;
  if (kind !== 'phase' && kind !== 'deliverable') return null;
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1) return null;
  return { kind, index, total, label: typeof label === 'string' ? label : '' };
}

function readMarkerStage({ markers, key, root }) {
  let best = null;
  for (const m of markers || []) {
    if (!m || m.project_key !== key || (m.root_run_id || null) !== (root || null) || !validStage(m.stage)) continue;
    const at = Date.parse(m.stage_set_at);
    const t = Number.isFinite(at) ? at : -Infinity;
    if (best && t <= best.t) continue;
    best = {
      t,
      value: {
        stage: m.stage,
        stage_set_at: typeof m.stage_set_at === 'string' ? m.stage_set_at : null,
        size: SIZES.includes(m.size) ? m.size : null,
        urgent: m.urgent === true,
        level: typeof m.level === 'string' ? m.level : null,
        unit: cleanUnit(m.unit),
        review_families: Array.isArray(m.review_families) ? m.review_families.filter((f) => typeof f === 'string' && f) : [],
        session_id: typeof m.session_id === 'string' ? m.session_id : null,
      },
    };
  }
  return best ? best.value : null;
}

module.exports = { readMarkerStage, validStage };
