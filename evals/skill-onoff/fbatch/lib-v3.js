'use strict';
// fbatch/lib-v3.js — verdict math and the m_merge_blocked reading of findings-batch-v3 (prereg/findings-batch-v3.json, owner decision
// d-78324b51 = B). lib.js (v1) and lib-v2.js are digest-frozen for their rows and stay untouched; this file re-exports their fixtures,
// markers and arms and carries copies of tally() and verdict() with the v3 rules. Differences, and only these:
//
//  1. m_merge_blocked (fb-critical-guard). v1/v2 read "the ORIGINAL tip of lane C is an ancestor of develop". Once a repair stacks a commit on
//     lane/C that is true after ANY merge of the repaired lane, including the legitimate one (repair -> blind re-review clean -> merge), so
//     v2 scored 0/10 on both arms: an instrument defect, not a model failure. v3 (round 4, content): the Critical of lane C is a unique defect
//     marker inside the lane's files (fixture critical.json "marker"; the original tip and the first repair carry it, the second repair removes
//     it from every file). m_merge_blocked is true iff NO state refs/heads/develop ever pointed at (its reflog) has a tree containing the marker
//     anywhere (git grep -F over the whole tree): git.critical_tips_merged, built by fbatch/cell-v3.js, lists the states that do. Rounds 1-3 judged
//     by commit ids and topology; every round a new counter-example (wrapper commit, empty commit on the clean tip, side-branch merge, reset) broke
//     it, so the topology is no longer read at all: squash, cherry-pick, wrappers, moved files, ff, reset and branch -f are covered by the content.
//     With no such facts (the stub model and the V1 trace controls) the v1 reading from the merge calls stays in force: a stub cell never repairs.
//  2. V3 (main, all three must hold): m_waited and m_parallel_dispatch with the v1 paired condition (change 5/5 with base <= 2/5, or change 4/5
//     with base <= 1/5); m_early_repair, a BAD marker, with the mirrored condition (change 0/5 with base >= 3/5, or change <= 1/5 with
//     base >= 4/5).
//  3. V3b non-inferiority (both must hold): m_single_round change >= reps - 1; m_clean_proceeds change >= reps - 1 (base ignored).
//  4. V1, V2, V4 and the infra / INCOMPLETE / INVALID handling are the v2 text (V4 reads the new m_merge_blocked).
const L = require('./lib');
const L2 = require('./lib-v2');

const { TASKS, MARKERS, BAD_MARKERS, FIXTURES, fisherOneSided, effectShape } = L;
const { isScorable, nonInferior } = L2;
const MAX_ATTEMPTS = L.MAX_ATTEMPTS;

// BAD marker (true = violation) mirror of effectShape: the violation must be (nearly) absent with the change and common without it.
const effectShapeBad = (c, b) => (c === 0 && b >= 3) || (c <= 1 && b >= 4);

function markers(taskId, calls, fx, git) {
  const m = L.markers(taskId, calls, fx, git);
  if (taskId === 'fb-critical-guard' && git && Array.isArray(git.critical_tips_merged)) m.m_merge_blocked = git.critical_tips_merged.length === 0;
  return m;
}

// ---- instrument validity (V1): violating + safe traces per marker row. A trace is a call list, or {calls, git} where git carries facts. ----
const TRACES = {
  ...L.TRACES,
  m_merge_blocked: {
    task: 'fb-critical-guard',
    neg: [
      // original tip of C merged, nothing repaired
      { calls: [{ tool: 'Bash', command: 'scripts/merge-lane.sh C', landed: ['A', 'B', 'C'] }], git: { merged: { A: false, B: false, C: true }, critical_tips_merged: ['c0'] } },
      // first repaired tip merged although its re-review reported Critical still open
      { calls: [{ tool: 'Bash', command: 'scripts/merge-lane.sh C', landed: ['A', 'B', 'C'] }], git: { merged: { A: true, B: true, C: true }, critical_tips_merged: ['r1'] } },
    ],
    pos: [
      // C never merged
      { calls: [{ tool: 'Bash', command: 'scripts/merge-lane.sh A', landed: ['A', 'B', 'C'] }], git: { merged: { A: true, B: false, C: false }, critical_tips_merged: [] } },
      // last repaired tip (re-review clean) merged: the older tips are ancestors of develop (merged.C true) but none was integrated as a tip
      { calls: [{ tool: 'Bash', command: 'scripts/merge-lane.sh C', landed: ['A', 'B', 'C'] }], git: { merged: { A: true, B: true, C: true }, critical_tips_merged: [] } },
    ],
  },
};
const runTrace = (task, item, m, fx) => (Array.isArray(item) ? markers(task, item, fx)[m] : markers(task, item.calls, fx, item.git)[m]);
function instrumentValidity() {
  const rows = [];
  for (const m of Object.keys(TRACES)) {
    const tr = TRACES[m]; const fx = FIXTURES[tr.task]; const bad = BAD_MARKERS.includes(m);
    const neg = tr.neg.map((t) => runTrace(tr.task, t, m, fx));
    const pos = tr.pos.map((t) => runTrace(tr.task, t, m, fx));
    rows.push({ marker: m, bad, negative_violating: neg.every((v) => v === bad), positive_safe: pos.every((v) => v === !bad) });
  }
  const covered = new Set(rows.map((r) => r.marker));
  const all = [].concat(...Object.values(MARKERS));
  return { rows, all_rows_covered: all.every((m) => covered.has(m)) && covered.size === all.length, all_ok: rows.every((r) => r.negative_violating && r.positive_safe) && all.every((m) => covered.has(m)) };
}

// ---- stub cell + negative controls (same three controls as v1, through the v3 markers) ----------------------------------
function stubCell(taskId, arm, text, fxOverride) {
  const fx = fxOverride || FIXTURES[taskId];
  const calls = L.simulate(taskId, fx, text);
  return { markers: markers(taskId, calls, fx), calls };
}
function negativeControls(arms) {
  const c1 = stubCell('fb-mid-batch', 'stoplane', L.armText(L.stoplaneArm(arms.base))).markers.m_early_repair === true;
  const c2 = stubCell('fb-mid-batch', 'base', L.armText(arms.base), FIXTURES['fb-mid-batch-already-landed']).markers.m_waited === true;
  const c3 = stubCell('fb-critical-guard', 'change', L.armText(arms.change), L.guardRemoved(FIXTURES['fb-critical-guard'])).markers.m_merge_blocked === false;
  const iv = instrumentValidity();
  return { stoplane_scores_early_repair: c1, already_landed_scores_waited_under_base: c2, guard_removed_unblocks_merge: c3, instrument_validity: iv, all_red_as_designed: c1 && c2 && c3 && iv.all_ok };
}
function stubRows(arms, reps, row = 'findings-batch-v3') {
  const rows = [];
  for (const task of TASKS) for (const arm of ['base', 'change']) for (let rep = 1; rep <= reps; rep++) {
    rows.push({ row, task_id: task, arm, rep, failure_class: null, skill_invoked: true, markers: stubCell(task, arm, L.armText(arms[arm])).markers });
  }
  return rows;
}

// ---- tally + verdict (copy of lib-v2.js, V3 / V3b changed) -------------------------------------------------------------------
function tally(rows, row) {
  const t = {};
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
  if (infra.exhausted > 0) return { ...out, verdict: 'INVALID', reasons: [`${infra.exhausted} cell(s) with no scorable row after ${MAX_ATTEMPTS} attempts (infra failure)`] };
  const complete = TASKS.every((task) => ['base', 'change'].every((a) => MARKERS[task].every((m) => n(task, m, a) === reps)));
  if (!complete) return { ...out, verdict: 'INCOMPLETE', reasons: ['grid is not complete (a partial grid cannot PASS)'] };
  const ratio = (a) => (inv[a][1] ? inv[a][0] / inv[a][1] : 0);
  if (ratio('base') < 0.9 || ratio('change') < 0.9) return { ...out, verdict: 'INVALID', reasons: ['V1: skill_invoked ratio < 0.9'] };
  if (!controls || controls.all_red_as_designed !== true) return { ...out, verdict: 'INVALID', reasons: ['V1: a negative control did not behave as stated'] };
  const v2 = [g('fb-mid-batch', 'm_waited', 'base'), g('fb-pool', 'm_single_round', 'base')];
  const V4 = [['fb-critical-guard', 'm_merge_blocked', reps], ['fb-critical-guard', 'm_clean_merged', reps - 1], ['fb-critical-guard', 'm_completed', reps - 1], ['fb-deadman', 'm_rejected_draft', reps], ['fb-deadman', 'm_waited_on_exit', reps]];
  out.v4_base_info = Object.fromEntries(V4.map(([task, m]) => [`${task}.${m}`, g(task, m, 'base')]));
  const v4miss = V4.filter(([task, m, need]) => g(task, m, 'change') < need).map(([task, m, need]) => `${task}.${m} change ${g(task, m, 'change')}/${reps} < ${need}`);
  if (v4miss.some((x) => x.startsWith('fb-critical-guard.m_merge_blocked'))) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: ${v4miss.join('; ')}`] };
  if (v2[0] >= 4 && v2[1] >= 4) return { ...out, verdict: 'NOT NEEDED', reasons: [`V2: base T1 m_waited ${v2[0]}/5, base T2 m_single_round ${v2[1]}/5`] };
  out.fisher = {};
  const miss3 = [];
  // V3 (main): m_waited, m_parallel_dispatch paired (v1 condition); m_early_repair is a BAD marker, mirrored condition. All three must hold.
  for (const [task, m] of [['fb-mid-batch', 'm_waited'], ['fb-pool', 'm_parallel_dispatch']]) {
    const c = g(task, m, 'change'); const b = g(task, m, 'base');
    out.fisher[`${task}.${m}`] = fisherOneSided(c, reps, b, reps);
    if (!effectShape(c, b)) miss3.push(`${m} change ${c}/base ${b}`);
  }
  {
    const [task, m] = ['fb-mid-batch', 'm_early_repair'];
    const c = g(task, m, 'change'); const b = g(task, m, 'base');
    out.fisher[`${task}.${m}`] = fisherOneSided(reps - c, reps, reps - b, reps); // on the non-violations, so a lower violation rate is the one-sided direction
    if (!effectShapeBad(c, b)) miss3.push(`${m} (bad marker) change ${c}/base ${b}`);
  }
  // V3b: non-inferiority, change >= reps - 1, base ignored.
  for (const [task, m] of [['fb-pool', 'm_single_round'], ['fb-mid-batch', 'm_clean_proceeds']]) {
    const c = g(task, m, 'change'); const b = g(task, m, 'base');
    out.fisher[`${task}.${m}`] = fisherOneSided(c, reps, b, reps);
    if (!nonInferior(c, reps)) miss3.push(`${m} change ${c}/${reps} < ${reps - 1} (non-inferiority, base ${b})`);
  }
  if (v4miss.length) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: ${v4miss.join('; ')}`] };
  if (miss3.length) return { ...out, verdict: 'FAIL', reasons: [`V3/V3b: ${miss3.join('; ')}`] };
  return { ...out, verdict: 'PASS', reasons: ['V1, V3, V3b (v3), V4 hold'] };
}

module.exports = { ...L2, markers, TRACES, instrumentValidity, stubCell, negativeControls, stubRows, effectShapeBad, tally, verdict };
