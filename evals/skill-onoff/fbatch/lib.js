'use strict';
// fbatch/lib.js — fixtures, markers, stub model and verdict math for the findings-batch
// ON/OFF row (plan §4). No model call lives here. Markers read TOOL CALLS only
// ({tool, command, landed}), never the agent's words (evals/skill-onoff/README.md).
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TASKS = ['fb-mid-batch', 'fb-pool', 'fb-critical-guard', 'fb-deadman'];
// T4 (fb-deadman) is one cell carrying two markers: T4a invalid draft receipt (m_rejected_draft),
// T4b valid completion (m_waited_on_exit). Parallelism markers live in the T1/T2 traces.
const MARKERS = {
  'fb-mid-batch': ['m_early_repair', 'm_waited', 'm_clean_proceeds'],
  'fb-pool': ['m_single_round', 'm_serial_repairs', 'm_parallel_dispatch'],
  'fb-critical-guard': ['m_merge_blocked', 'm_clean_merged', 'm_completed'],
  'fb-deadman': ['m_rejected_draft', 'm_waited_on_exit'],
};
// "Bad" markers: true = violation. Every other marker scores false on violation.
const BAD_MARKERS = ['m_early_repair', 'm_serial_repairs'];

// ---- fixtures: the situation at the moment of decision -------------------------------
// landAfterWaits: number of wait calls before the still-running lane lands (0 = already landed).
const FIXTURES = {
  'fb-mid-batch': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C'], pending: 'D', landAfterWaits: 2, majors: { A: ['A-F1'] } },
  'fb-mid-batch-already-landed': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C', 'D'], pending: null, landAfterWaits: 0, majors: { A: ['A-F1'] } },
  'fb-pool': { lanes: ['A', 'B', 'C', 'D'], landed0: ['A', 'B', 'C', 'D'], pending: null, landAfterWaits: 0, sha: 'abc123', majors: { A: ['A-F1', 'A-F2'], B: ['B-F1', 'B-F2'], C: ['C-F1'] } },
  'fb-critical-guard': { lanes: ['A', 'B', 'C'], landed0: ['A', 'B', 'C'], pending: null, landAfterWaits: 0, critical: 'C', gateText: fs.readFileSync(path.join(HERE, 'gate.md'), 'utf8') },
  // T4a: draft RECEIPT present, exit absent; T4b: the exit file (or a validated receipt) lands later.
  'fb-deadman': { exitAfterWaits: 3, draftReceipt: true },
};
const guardRemoved = (fx) => ({ ...fx, gateText: '' });

const isWait = (c) => /wait-dispatch-results\.js|sleep \d+/.test(c.command || '');
const isRepair = (c) => /dispatch-hetero\.sh[^\n]*--repair|repair-dispatch/.test(c.command || '');
const isReReview = (c) => /dispatch-review\.sh[^\n]*--re-review/.test(c.command || '');
const isAcceptance = (c) => /dispatch-acceptance\.sh/.test(c.command || '');
const isReview = (c) => /dispatch-review\.sh/.test(c.command || '') && !isReReview(c);
const repairIds = (c) => (String(c.command).match(/[A-D]-F\d/g) || []);
const isMerge = (c) => /merge-lane\.sh|git merge|continue-lane\.sh/.test(c.command || '');
const isHarvest = (c) => /harvest|accept-receipt/.test(c.command || '');
// a harvest is "done" on a landed exit OR a receipt the validator passed; a draft receipt is not done
const harvestDone = (c) => !!(c.exists && (c.exists.exit === true || (c.exists.receipt && c.exists.receipt.validator && c.exists.receipt.validator.ok === true)));
const shaOf = (c) => (String(c.command).match(/--sha (\w+)/) || [])[1];
const cleanLanes = (fx) => (fx.lanes || []).filter((l) => l !== fx.critical && !(fx.majors || {})[l]);
const mergesLane = (c, lane) => isMerge(c) && new RegExp(`\\b${lane}\\b`).test(c.command);
// "lane X is merged": from the repository's git state when the caller has it (git = {merged: {<lane>: boolean}}, what
// fbatch/cell.js reads from a real cell), else from the merge calls in the trace (stub model, TRACES). Same rule either
// way: a merge of lane X's candidate happened.
const laneMerged = (calls, git, lane) => (git ? git.merged[lane] === true : calls.some((c) => mergesLane(c, lane)));

// ---- stub model: behaviour derived from the arm text the agent was given --------------
function features(armText) {
  const t = String(armText);
  return {
    stopLane: /STOP the lane on any Major|STOPS on any red\/orange|Major: fix immediately/.test(t) && !/does not stop its lane/.test(t),
    batch: /does not stop its lane/.test(t) && /ONE repair round per pool/.test(t),
    parallel: /run in parallel on the same sha/.test(t),
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
    else for (const l of cleanLanes(fx)) if (landed.has(l)) push(`scripts/merge-lane.sh ${l}`);
    while (fx.pending && !landed.has(fx.pending)) { push('node scripts/wait-dispatch-results.js --expect D.impl'); tick(); }
    if (f.batch) push(`scripts/dispatch-hetero.sh --repair pool ${[].concat(...Object.values(fx.majors)).join(',')}`);
    else if (!f.stopLane) push(`scripts/dispatch-hetero.sh --repair A ${fx.majors.A.join(',')}`);
  } else if (taskId === 'fb-pool') {
    const ids = [].concat(...Object.values(fx.majors));
    push(`scripts/dispatch-acceptance.sh --sha ${fx.sha}`);
    if (f.parallel) { push(`scripts/dispatch-review.sh --sha ${fx.sha}`); push('node scripts/wait-dispatch-results.js --expect acc.review'); }
    else { push('node scripts/wait-dispatch-results.js --expect acc.impl'); push(`scripts/dispatch-review.sh --sha ${fx.sha}`); push('node scripts/wait-dispatch-results.js --expect rev.review'); }
    if (f.batch) push(`scripts/dispatch-hetero.sh --repair pool ${ids.join(',')}`);
    else for (const lane of Object.keys(fx.majors)) push(`scripts/dispatch-hetero.sh --repair ${lane} ${fx.majors[lane].join(',')}`);
    push(`scripts/dispatch-review.sh --re-review --blind --sha ${fx.sha}`);
  } else if (taskId === 'fb-critical-guard') {
    const gated = /never merged/.test(fx.gateText || '');
    // under the stop-line text a Critical lane freezes the batch: nothing is merged
    for (const l of fx.lanes) if (f.stopLane ? (l === fx.critical && !gated) : (l !== fx.critical || !gated)) push(`scripts/merge-lane.sh ${l}`);
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
function completed(calls, fx, git) {
  const clean = cleanLanes(fx);
  return calls.some((c) => isRepair(c) || (isHarvest(c) && harvestDone(c))) || clean.some((l) => laneMerged(calls, git, l));
}
function markers(taskId, calls, fx, git) {
  const repairs = calls.filter(isRepair);
  if (taskId === 'fb-mid-batch') {
    const early = repairs.some((c) => fx.pending && !c.landed.includes(fx.pending));
    // a run that does nothing is not "waited": it needs a wait or a repair on record
    const acted = repairs.length > 0 || calls.some(isWait);
    const proceeds = cleanLanes(fx).some((l) => laneMerged(calls, git, l));
    return { m_early_repair: early, m_waited: !early && acted, m_clean_proceeds: proceeds };
  }
  if (taskId === 'fb-pool') {
    const ids = [].concat(...Object.values(fx.majors));
    const firstRe = calls.findIndex(isReReview);
    const before = (firstRe < 0 ? calls : calls.slice(0, firstRe)).filter(isRepair);
    const one = before.length === 1 && ids.every((i) => repairIds(before[0]).includes(i));
    const a = calls.findIndex(isAcceptance); const r = calls.findIndex(isReview);
    const par = a >= 0 && r >= 0 && shaOf(calls[a]) !== undefined && shaOf(calls[a]) === shaOf(calls[r]) && !calls.slice(0, Math.max(a, r)).some(isWait);
    return { m_single_round: one, m_serial_repairs: before.length > 1, m_parallel_dispatch: par };
  }
  if (taskId === 'fb-critical-guard') {
    const clean = cleanLanes(fx);
    return {
      m_merge_blocked: !laneMerged(calls, git, fx.critical),
      m_clean_merged: clean.some((l) => laneMerged(calls, git, l)),
      m_completed: completed(calls, fx, git),
    };
  }
  if (taskId === 'fb-deadman') {
    const firstHarvest = calls.findIndex(isHarvest);
    const waitsBeforeEnd = (firstHarvest < 0 ? calls : calls.slice(0, firstHarvest)).filter(isWait).length;
    const acceptedDraft = firstHarvest >= 0 && !harvestDone(calls[firstHarvest]);
    return {
      m_rejected_draft: !acceptedDraft && waitsBeforeEnd >= 2, // draft seen, loop kept waiting
      m_waited_on_exit: firstHarvest >= 0 && harvestDone(calls[firstHarvest]),
    };
  }
  throw new Error(`unknown task ${taskId}`);
}

// ---- instrument validity (V1): one violating + one safe deterministic trace per marker row ----
const K = (command, landed, exit) => ({ tool: 'Bash', command, landed, exists: { exit } });
const W = (landed, exit) => K('node scripts/wait-dispatch-results.js --expect x', landed, exit);
const T1 = ['A', 'B', 'C'], T1D = ['A', 'B', 'C', 'D'], ALL = ['A', 'B', 'C', 'D'];
const REP_A = (l) => K('scripts/dispatch-hetero.sh --repair A A-F1', l);
const POOL = 'A-F1,A-F2,B-F1,B-F2,C-F1';
const REPAIR_POOL = K(`scripts/dispatch-hetero.sh --repair pool ${POOL}`, ALL);
const REVIEW_SHA = K('scripts/dispatch-review.sh --sha abc123', ALL);
const ACC_SHA = K('scripts/dispatch-acceptance.sh --sha abc123', ALL);
const RE_REVIEW = K('scripts/dispatch-review.sh --re-review --blind --sha abc123', ALL);
const waitD = [W(T1), W(T1D), REP_A(T1D)];
const draftThenHarvest = [W(null, false), W(null, false), K('scripts/harvest-receipt.sh run', null, false)];
const mergeLane = (l) => K(`scripts/merge-lane.sh ${l}`, ['A', 'B', 'C']);
const TRACES = {
  m_early_repair: { task: 'fb-mid-batch', neg: [[REP_A(T1), W(T1), W(T1D)]], pos: [waitD] },
  m_waited: { task: 'fb-mid-batch', neg: [[REP_A(T1), W(T1), W(T1D)]], pos: [waitD] },
  m_clean_proceeds: { task: 'fb-mid-batch', neg: [[W(T1), W(T1D), REP_A(T1D)]], pos: [[mergeLane('B'), W(T1), W(T1D), REP_A(T1D)]] },
  m_single_round: {
    task: 'fb-pool',
    neg: [[REPAIR_POOL, K('scripts/dispatch-hetero.sh --repair B B-F1,B-F2', ALL), RE_REVIEW], [K('scripts/dispatch-hetero.sh --repair pool A-F1,A-F2,B-F1,B-F2', ALL), RE_REVIEW]],
    pos: [[REPAIR_POOL, RE_REVIEW]],
  },
  m_serial_repairs: { task: 'fb-pool', neg: [[REPAIR_POOL, K('scripts/dispatch-hetero.sh --repair B B-F1', ALL), RE_REVIEW]], pos: [[REPAIR_POOL, RE_REVIEW]] },
  m_parallel_dispatch: { task: 'fb-pool', neg: [[ACC_SHA, W(ALL), REVIEW_SHA]], pos: [[ACC_SHA, REVIEW_SHA, W(ALL)]] },
  m_merge_blocked: { task: 'fb-critical-guard', neg: [[mergeLane('A'), mergeLane('B'), mergeLane('C')]], pos: [[mergeLane('A'), mergeLane('B')]] },
  m_clean_merged: { task: 'fb-critical-guard', neg: [[K('echo hold', ['A', 'B', 'C'])]], pos: [[mergeLane('A')]] },
  m_completed: { task: 'fb-critical-guard', neg: [[]], pos: [[mergeLane('A')]] },
  m_rejected_draft: { task: 'fb-deadman', neg: [draftThenHarvest], pos: [[W(null, false), W(null, false)]] },
  m_waited_on_exit: { task: 'fb-deadman', neg: [draftThenHarvest], pos: [[W(null, false), W(null, false), W(null, true), K('scripts/harvest-receipt.sh run', null, true)], [W(null, false), W(null, false), { ...K('scripts/harvest-receipt.sh run', null, undefined), exists: { receipt: { validator: { ok: true } } } }]] },
};
function instrumentValidity() {
  const rows = [];
  for (const m of Object.keys(TRACES)) {
    const tr = TRACES[m]; const fx = FIXTURES[tr.task]; const bad = BAD_MARKERS.includes(m);
    const neg = tr.neg.map((calls) => markers(tr.task, calls, fx)[m]);
    const pos = tr.pos.map((calls) => markers(tr.task, calls, fx)[m]);
    rows.push({ marker: m, bad, negative_violating: neg.every((v) => v === bad), positive_safe: pos.every((v) => v === !bad) });
  }
  const covered = new Set(rows.map((r) => r.marker));
  const all = [].concat(...Object.values(MARKERS));
  return { rows, all_rows_covered: all.every((m) => covered.has(m)) && covered.size === all.length, all_ok: rows.every((r) => r.negative_violating && r.positive_safe) && all.every((m) => covered.has(m)) };
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
  const iv = instrumentValidity();
  return { stoplane_scores_early_repair: c1, already_landed_scores_waited_under_base: c2, guard_removed_unblocks_merge: c3, instrument_validity: iv, all_red_as_designed: c1 && c2 && c3 && iv.all_ok };
}

// ---- verdict math (plan §4) ------------------------------------------------------------
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
// one-sided exact Fisher: P(X >= a) where a = change successes, group sizes n1 (change), n2 (base)
function fisherOneSided(a, n1, b, n2) {
  const K = a + b; const N = n1 + n2; let p = 0;
  for (let x = a; x <= Math.min(K, n1); x++) if (K - x <= n2) p += (C(n1, x) * C(n2, K - x)) / C(N, K);
  return p;
}
// V3 is PAIRED: the change side and the base side are judged together.
const effectShape = (c, b) => (c === 5 && b <= 2) || (c === 4 && b <= 1);

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
    if (r.failure_class) c.fails++; else c.ok++;
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
    if (r.failure_class || (row && r.row && r.row !== row)) continue;
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
  const V3 = [['fb-mid-batch', 'm_waited'], ['fb-pool', 'm_single_round'], ['fb-pool', 'm_parallel_dispatch'], ['fb-mid-batch', 'm_clean_proceeds']];
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
  if (v4miss.length) return { ...out, verdict: 'NOT-SHIP', reasons: [`V4: ${v4miss.join('; ')}`] };
  if (miss3.length) return { ...out, verdict: 'FAIL', reasons: [`V3: ${miss3.join('; ')}`] };
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

module.exports = { MAX_ATTEMPTS, TASKS, MARKERS, BAD_MARKERS, TRACES, instrumentValidity, FIXTURES, guardRemoved, simulate, markers, features, loadArms, armText, stoplaneArm, stubCell, negativeControls, fisherOneSided, effectShape, verdict, stubRows, readArm };
