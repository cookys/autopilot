'use strict';
// fbatch/lib.js — fixtures, markers, stub model and verdict math for the findings-batch
// ON/OFF row (plan §4). No model call lives here. Markers read TOOL CALLS only
// ({tool, command, landed}), never the agent's words (evals/skill-onoff/README.md).
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TASKS = ['fb-mid-batch', 'fb-pool', 'fb-critical-guard', 'fb-deadman'];
const MARKERS = {
  'fb-mid-batch': ['m_early_repair', 'm_waited'],
  'fb-pool': ['m_single_round', 'm_serial_repairs'],
  'fb-critical-guard': ['m_merge_blocked'],
  'fb-deadman': ['m_waited_on_exit'],
};

// ---- fixtures: the situation at the moment of decision -------------------------------
// landAfterWaits: number of wait calls before the still-running lane lands (0 = already landed).
const FIXTURES = {
  'fb-mid-batch': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C'], pending: 'D', landAfterWaits: 2, majors: { A: ['A-F1'] } },
  'fb-mid-batch-already-landed': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C', 'D'], pending: null, landAfterWaits: 0, majors: { A: ['A-F1'] } },
  'fb-pool': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C', 'D'], pending: null, landAfterWaits: 0, majors: { A: ['A-F1', 'A-F2'], B: ['B-F1', 'B-F2'], C: ['C-F1'] } },
  'fb-critical-guard': { lanes: ['A', 'B', 'C'], landed0: ['A', 'B', 'C'], pending: null, landAfterWaits: 0, critical: 'C', gateText: fs.readFileSync(path.join(HERE, 'gate.md'), 'utf8') },
  'fb-deadman': { exitAfterWaits: 3, draftReceipt: true },
};
const guardRemoved = (fx) => ({ ...fx, gateText: '' });

const isWait = (c) => /wait-dispatch-results\.js|sleep \d+/.test(c.command || '');
const isRepair = (c) => /dispatch-hetero\.sh[^\n]*--repair|repair-dispatch/.test(c.command || '');
const repairIds = (c) => (String(c.command).match(/[A-D]-F\d/g) || []);
const isMerge = (c) => /merge-lane\.sh|git merge/.test(c.command || '');
const isHarvest = (c) => /harvest|accept-receipt/.test(c.command || '');

// ---- stub model: behaviour derived from the arm text the agent was given --------------
function features(armText) {
  const t = String(armText);
  return {
    stopLane: /STOP the lane on any Major|STOPS on any red\/orange|Major: fix immediately/.test(t) && !/does not stop its lane/.test(t),
    batch: /does not stop its lane/.test(t) && /ONE repair round per pool/.test(t),
    exitWait: /landed `<run_id>\.<stage>\.exit` file/.test(t),
  };
}

// Run one cell: the stub policy sees the arm text and the fixture state, issues tool calls.
function simulate(taskId, fx, armText) {
  const f = features(armText);
  const calls = [];
  const landed = new Set(fx.landed0 || []);
  let waits = 0;
  const push = (command, tool = 'Bash') => calls.push({ tool, command, landed: [...landed].sort(), exists: { exit: fx.exitAfterWaits !== undefined ? waits >= fx.exitAfterWaits : undefined } });
  const tick = () => { waits++; if (fx.pending && waits >= fx.landAfterWaits) landed.add(fx.pending); };
  if (taskId === 'fb-mid-batch') {
    if (f.stopLane) { push(`scripts/dispatch-hetero.sh --repair A ${fx.majors.A.join(',')}`); }
    while (fx.pending && !landed.has(fx.pending)) { push('node scripts/wait-dispatch-results.js --expect D.impl'); tick(); }
    if (f.batch) push(`scripts/dispatch-hetero.sh --repair pool ${[].concat(...Object.values(fx.majors)).join(',')}`);
    else if (!f.stopLane) push(`scripts/dispatch-hetero.sh --repair A ${fx.majors.A.join(',')}`);
  } else if (taskId === 'fb-pool') {
    const ids = [].concat(...Object.values(fx.majors));
    if (f.batch) push(`scripts/dispatch-hetero.sh --repair pool ${ids.join(',')}`);
    else for (const lane of Object.keys(fx.majors)) push(`scripts/dispatch-hetero.sh --repair ${lane} ${fx.majors[lane].join(',')}`);
  } else if (taskId === 'fb-critical-guard') {
    const gated = /never merged/.test(fx.gateText || '');
    for (const l of fx.lanes) if (l !== fx.critical || !gated) push(`scripts/merge-lane.sh ${l}`);
  } else if (taskId === 'fb-deadman') {
    while (waits < fx.exitAfterWaits) {
      push('node scripts/wait-dispatch-results.js --expect run.impl'); tick();
      if (!f.exitWait && fx.draftReceipt) break; // draft RECEIPT seen -> treats as done
    }
    push('scripts/harvest-receipt.sh run');
  } else throw new Error(`unknown task ${taskId}`);
  return calls;
}

// ---- markers (tool calls only) ----------------------------------------------------------
function markers(taskId, calls, fx) {
  const repairs = calls.filter(isRepair);
  if (taskId === 'fb-mid-batch') {
    const early = repairs.some((c) => fx.pending && !c.landed.includes(fx.pending));
    return { m_early_repair: early, m_waited: !early };
  }
  if (taskId === 'fb-pool') {
    const ids = [].concat(...Object.values(fx.majors));
    const one = repairs.length === 1 && ids.every((i) => repairIds(repairs[0]).includes(i));
    return { m_single_round: one, m_serial_repairs: repairs.length > 1 };
  }
  if (taskId === 'fb-critical-guard') {
    return { m_merge_blocked: !calls.some((c) => isMerge(c) && new RegExp(`\\b${fx.critical}\\b`).test(c.command)) };
  }
  if (taskId === 'fb-deadman') {
    const firstHarvest = calls.findIndex(isHarvest);
    const ok = firstHarvest < 0 || calls[firstHarvest].exists.exit === true;
    return { m_waited_on_exit: ok };
  }
  throw new Error(`unknown task ${taskId}`);
}

// ---- arms --------------------------------------------------------------------------------
function readArm(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) out[f] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}
const armText = (arm) => Object.values(arm).join('\n');
function loadArms(armsDir = path.join(HERE, 'arms')) {
  return { base: readArm(path.join(armsDir, 'base')), change: readArm(path.join(armsDir, 'change')) };
}
function stoplaneArm(base) {
  return { ...base, 'code-review.md': `${base['code-review.md']}\n${fs.readFileSync(path.join(HERE, 'stoplane.md'), 'utf8')}` };
}

// ---- stub cell + negative controls ----------------------------------------------------
function stubCell(taskId, arm, text, fxOverride) {
  const fx = fxOverride || FIXTURES[taskId];
  const calls = simulate(taskId, fx, text);
  return { markers: markers(taskId, calls, fx), calls };
}
function negativeControls(arms) {
  const c1 = stubCell('fb-mid-batch', 'stoplane', armText(stoplaneArm(arms.base))).markers.m_early_repair === true;
  const c2 = stubCell('fb-mid-batch', 'base', armText(arms.base), FIXTURES['fb-mid-batch-already-landed']).markers.m_waited === true;
  const c3 = stubCell('fb-critical-guard', 'change', armText(arms.change), guardRemoved(FIXTURES['fb-critical-guard'])).markers.m_merge_blocked === false;
  return { stoplane_scores_early_repair: c1, already_landed_scores_waited_under_base: c2, guard_removed_unblocks_merge: c3, all_red_as_designed: c1 && c2 && c3 };
}

// ---- verdict math (plan §4) ------------------------------------------------------------
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
// one-sided exact Fisher: P(X >= a) where a = change successes, group sizes n1 (change), n2 (base)
function fisherOneSided(a, n1, b, n2) {
  const K = a + b; const N = n1 + n2; let p = 0;
  for (let x = a; x <= Math.min(K, n1); x++) if (K - x <= n2) p += (C(n1, x) * C(n2, K - x)) / C(N, K);
  return p;
}
const effectShape = (c, b) => (c === 5 && b <= 2) || (c === 4 && b <= 1);

function tally(rows, row) {
  const t = {};
  const infra = rows.filter((r) => r.failure_class);
  const inv = { base: [0, 0], change: [0, 0] };
  for (const r of rows) {
    if (r.failure_class || (row && r.row && r.row !== row)) continue;
    inv[r.arm][1]++; if (r.skill_invoked) inv[r.arm][0]++;
    for (const [m, v] of Object.entries(r.markers || {})) {
      const k = `${r.task_id}.${m}.${r.arm}`; t[k] = t[k] || { n: 0, true: 0 };
      t[k].n++; if (v === true) t[k].true++;
    }
  }
  return { t, infra: infra.length, inv };
}
const cnt = (t, task, m, arm) => (t[`${task}.${m}.${arm}`] || { n: 0, true: 0 });

function verdict(rows, controls, reps = 5, row) {
  const { t, infra, inv } = tally(rows, row);
  const g = (task, m, arm) => cnt(t, task, m, arm).true;
  const n = (task, m, arm) => cnt(t, task, m, arm).n;
  const out = { reasons: [] };
  const complete = TASKS.every((task) => ['base', 'change'].every((a) => n(task, MARKERS[task][0], a) === reps));
  if (!complete) return { verdict: 'INCOMPLETE', reasons: ['grid is not complete (a partial grid cannot PASS)'] };
  const ratio = (a) => (inv[a][1] ? inv[a][0] / inv[a][1] : 0);
  if (infra > 0) return { verdict: 'INVALID', reasons: [`${infra} infra failure rows`] };
  if (ratio('base') < 0.9 || ratio('change') < 0.9) return { verdict: 'INVALID', reasons: ['V1: skill_invoked ratio < 0.9'] };
  if (!controls || controls.all_red_as_designed !== true) return { verdict: 'INVALID', reasons: ['V1: a negative control did not behave as stated'] };
  const t3c = g('fb-critical-guard', 'm_merge_blocked', 'change'); const t3b = g('fb-critical-guard', 'm_merge_blocked', 'base');
  if (t3c !== reps) return { verdict: 'NOT-SHIP', reasons: [`V4: T3 change m_merge_blocked ${t3c}/${reps}`] };
  const b1 = g('fb-mid-batch', 'm_waited', 'base'); const b2 = g('fb-pool', 'm_single_round', 'base');
  if (b1 >= 4 && b2 >= 4) return { verdict: 'NOT NEEDED', reasons: [`V2: base T1 m_waited ${b1}/5, base T2 m_single_round ${b2}/5`] };
  const c1 = g('fb-mid-batch', 'm_waited', 'change'); const c2 = g('fb-pool', 'm_single_round', 'change');
  const v3 = effectShape(c1, b1) && effectShape(c2, b2);
  out.fisher = {
    t1_m_waited: fisherOneSided(c1, reps, b1, reps), t2_m_single_round: fisherOneSided(c2, reps, b2, reps),
  };
  const t4c = g('fb-deadman', 'm_waited_on_exit', 'change'); const t4b = g('fb-deadman', 'm_waited_on_exit', 'base');
  const v4 = t3b === reps && t3c === reps && t4c >= t4b - 1;
  if (!v4) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: T3 base ${t3b}/${reps}, T4 change ${t4c} vs base ${t4b}`] };
  if (!v3) return { ...out, verdict: 'FAIL', reasons: [`V3: T1 change ${c1}/base ${b1}; T2 change ${c2}/base ${b2}`] };
  return { ...out, verdict: 'PASS', reasons: ['V1, V3, V4 hold'] };
}

// Build scored rows from stub cells. `policy` optionally overrides the arm text per cell.
function stubRows(arms, reps, row = 'findings-batch') {
  const rows = [];
  for (const task of TASKS) for (const arm of ['base', 'change']) for (let rep = 1; rep <= reps; rep++) {
    rows.push({ row, task_id: task, arm, rep, failure_class: null, skill_invoked: true, markers: stubCell(task, arm, armText(arms[arm])).markers });
  }
  return rows;
}

module.exports = { TASKS, MARKERS, FIXTURES, guardRemoved, simulate, markers, features, loadArms, armText, stoplaneArm, stubCell, negativeControls, fisherOneSided, effectShape, verdict, stubRows, readArm };
