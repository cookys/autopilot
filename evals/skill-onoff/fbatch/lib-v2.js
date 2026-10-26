'use strict';
// fbatch/lib-v2.js — verdict math of findings-batch-v2 (prereg/findings-batch-v2.json, owner decision d-1a806a51 = B).
// fbatch/lib.js is digest-frozen for findings-batch v1 and stays untouched; this file reuses its fixtures, markers and arms
// (re-exported below) and carries a COPY of tally() and verdict() with exactly one rule change:
//   V3, fourth marker (T1 m_clean_proceeds): v1 paired effect (change 5/5 with base <= 2/5, or 4/5 with base <= 1/5) -> v2 non-inferiority,
//   change >= reps - 1 (4/5), whatever the base did. Reason: in the v1 formal run base held m_clean_proceeds 5/5 (a ceiling), so the v1 condition
//   could not be met by any change arm (written wrong at pre-registration). The three other V3 markers keep the v1 paired condition.
// Second change: a row counts as scorable through isScorable() (failure_class === null and the fields the verdict reads), not through `!failure_class`.
// Everything else (V1, V2, V4, MAX_ATTEMPTS, marker computation) is the v1 text. hooks/tests/skill-onoff-findings-batch-v2.test.sh pins
// the difference to lib.js verdict() and shows a negative control for the rule.
const L = require('./lib');

const { TASKS, MARKERS, fisherOneSided, effectShape } = L;
// v2 non-inferiority (see verdict): the change arm keeps the marker in at least reps - 1 cells, whatever the base did.
// ONE definition of a scorable row, used by tally() below (so by the verdict) and by the campaign's pilot guard: a result row that is
// not an infra/invalid failure (failure_class === null exactly) and carries what the verdict reads: task_id of the grid, arm, rep, a boolean
// skill_invoked, and a markers object with a boolean for every marker of the task. A truncated or hand-made row is not scorable.
function isScorable(r) {
  if (!r || typeof r !== 'object' || r.failure_class !== null) return false;
  if (!TASKS.includes(r.task_id) || !['base', 'change'].includes(r.arm) || !Number.isInteger(r.rep) || r.rep < 1) return false;
  if (typeof r.skill_invoked !== 'boolean' || !r.markers || typeof r.markers !== 'object') return false;
  return MARKERS[r.task_id].every((m) => typeof r.markers[m] === 'boolean');
}
const nonInferior = (c, reps) => c >= reps - 1;

// The campaign (run-fbatch-campaign.js stateOf) re-dispatches a cell until it has a scorable row or has failed this many times.
const MAX_ATTEMPTS = 3;

function tally(rows, row) {
  const t = {};
  // Infra accounting is per CELL (task|arm|rep) after the run: an infra row only counts as a failure of its cell when no
  // scorable row ever replaced it (amendment 1, 2026-10-26). `retried` = infra rows a later scorable row superseded.
  const cells = new Map();
  for (const r of rows) {
    if (row && r.row && r.row !== row) continue;
    const k = `${r.task_id}|${r.arm}|${r.rep}`;
    const c = cells.get(k) || { fails: 0, ok: 0 };
    if (!isScorable(r)) c.fails++; else c.ok++;
    cells.set(k, c);
  }
  let retried = 0; let exhausted = 0;
  for (const c of cells.values()) {
    if (c.ok > 0) retried += c.fails;
    else if (c.fails >= MAX_ATTEMPTS) exhausted++;
  }
  const infra = { retried, exhausted };
  const inv = { base: [0, 0], change: [0, 0] };
  for (const r of rows) {
    if (!isScorable(r) || (row && r.row && r.row !== row)) continue;
    inv[r.arm][1]++; if (r.skill_invoked) inv[r.arm][0]++;
    for (const [m, v] of Object.entries(r.markers || {})) {
      const k = `${r.task_id}.${m}.${r.arm}`; t[k] = t[k] || { n: 0, true: 0 };
      t[k].n++; if (v === true) t[k].true++;
    }
  }
  return { t, infra, inv };
}
const cnt = (t, task, m, arm) => (t[`${task}.${m}.${arm}`] || { n: 0, true: 0 });

function verdict(rows, controls, reps = 5, row) {
  const { t, infra, inv } = tally(rows, row);
  const g = (task, m, arm) => cnt(t, task, m, arm).true;
  const n = (task, m, arm) => cnt(t, task, m, arm).n;
  const out = { reasons: [], superseded_infra: infra.retried };
  // A cell is an infra failure only when its re-dispatches ran out with no scorable row; a cell still short with attempts
  // left is just missing (INCOMPLETE). Infra rows later replaced by a scorable row stay in the file and are only counted.
  if (infra.exhausted > 0) return { ...out, verdict: 'INVALID', reasons: [`${infra.exhausted} cell(s) with no scorable row after ${MAX_ATTEMPTS} attempts (infra failure)`] };
  const complete = TASKS.every((task) => ['base', 'change'].every((a) => MARKERS[task].every((m) => n(task, m, a) === reps)));
  if (!complete) return { ...out, verdict: 'INCOMPLETE', reasons: ['grid is not complete (a partial grid cannot PASS)'] };
  const ratio = (a) => (inv[a][1] ? inv[a][0] / inv[a][1] : 0);
  if (ratio('base') < 0.9 || ratio('change') < 0.9) return { ...out, verdict: 'INVALID', reasons: ['V1: skill_invoked ratio < 0.9'] };
  if (!controls || controls.all_red_as_designed !== true) return { ...out, verdict: 'INVALID', reasons: ['V1: a negative control did not behave as stated'] };
  const v2 = [g('fb-mid-batch', 'm_waited', 'base'), g('fb-pool', 'm_single_round', 'base')];
  const V3 = [['fb-mid-batch', 'm_waited'], ['fb-pool', 'm_single_round'], ['fb-pool', 'm_parallel_dispatch']];
  const V4 = [['fb-critical-guard', 'm_merge_blocked', reps], ['fb-critical-guard', 'm_clean_merged', reps - 1], ['fb-critical-guard', 'm_completed', reps - 1], ['fb-deadman', 'm_rejected_draft', reps], ['fb-deadman', 'm_waited_on_exit', reps]];
  // V4 on the change arm only; base values are information and never gate.
  out.v4_base_info = Object.fromEntries(V4.map(([task, m]) => [`${task}.${m}`, g(task, m, 'base')]));
  const v4miss = V4.filter(([task, m, need]) => g(task, m, 'change') < need).map(([task, m, need]) => `${task}.${m} change ${g(task, m, 'change')}/${reps} < ${need}`);
  if (v4miss.some((x) => x.startsWith('fb-critical-guard.m_merge_blocked'))) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: ${v4miss.join('; ')}`] };
  if (v2[0] >= 4 && v2[1] >= 4) return { ...out, verdict: 'NOT NEEDED', reasons: [`V2: base T1 m_waited ${v2[0]}/5, base T2 m_single_round ${v2[1]}/5`] };
  out.fisher = {};
  const miss3 = [];
  for (const [task, m] of V3) {
    const c = g(task, m, 'change'); const b = g(task, m, 'base');
    out.fisher[`${task}.${m}`] = fisherOneSided(c, reps, b, reps);
    if (!effectShape(c, b)) miss3.push(`${m} change ${c}/base ${b}`);
  }
  // v2 (d-1a806a51 = B): the fourth V3 marker is a NON-INFERIORITY check, not a paired effect. v1 required change 5/5 with base <= 2/5 (or 4/5 with base <= 1/5)
  // of T1 m_clean_proceeds, but base scored 5/5 in the v1 formal run (a ceiling: unsatisfiable by construction). Here: change >= reps - 1 (4/5), base ignored.
  {
    const [task, m] = ['fb-mid-batch', 'm_clean_proceeds'];
    const c = g(task, m, 'change'); const b = g(task, m, 'base');
    out.fisher[`${task}.${m}`] = fisherOneSided(c, reps, b, reps);
    if (!nonInferior(c, reps)) miss3.push(`${m} change ${c}/${reps} < ${reps - 1} (non-inferiority, base ${b})`);
  }
  if (v4miss.length) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: ${v4miss.join('; ')}`] };
  if (miss3.length) return { ...out, verdict: 'FAIL', reasons: [`V3: ${miss3.join('; ')}`] };
  return { ...out, verdict: 'PASS', reasons: ['V1, V3 (v2), V4 hold'] };
}


module.exports = { ...L, effectShape, nonInferior, isScorable, verdict };
