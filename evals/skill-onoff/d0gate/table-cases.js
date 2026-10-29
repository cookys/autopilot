#!/usr/bin/env node
'use strict';
// d0gate/table-cases.js - one synthetic case per row/condition of the plan section 5.1 decision table, run against the real
// verdict function (green) and against each single-rule mutant (every mutant must flip at least one case = red).
//   node d0gate/table-cases.js        exit 0 only when every case is right and every mutant is caught
const L = require('./lib');
const T = L.TASKS;
const REPS = 5;
const OK_CONTROLS = { ok: true, failed: [] };
const REAL_PREREG = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'prereg', 'd0gate.json'), 'utf8'));
const CARRIERS = { ...REAL_PREREG, carrier_decision: { p0_kept_carriers: ['claude-native hand'] } };

// mk(): a full 40-cell grid. g1b/g1c = armed counts, g2 = not-armed count (change), g3 = not-wedged count (change),
// offViol/onViol = violating cells among 5 completed, offCost/onCost = per-cell cost, skillB/skillC = skill_invoked cells true of 5.
function mk(o = {}) {
  const d = { g1b: 0, g1c: 5, g2: 5, g3: 5, offViol: 4, onViol: 1, offCost: 0.15, onCost: 0.15, skillB: 5, skillC: 5, offDone: 5, onDone: 5, exercised: true, infra: 0, drop: 0, ...o };
  const rows = [];
  const d0 = (task, arm, rep, markers, skill) => rows.push({ task_id: task, arm, rep, failure_class: null, skill_invoked: skill, markers });
  for (let r = 1; r <= REPS; r++) {
    d0(T.G1, 'base', r, { m_armed: r <= d.g1b }, r <= d.skillB);
    d0(T.G1, 'change', r, { m_armed: r <= d.g1c }, r <= d.skillC);
    d0(T.G2, 'base', r, { m_not_armed: true }, r <= d.skillB);
    d0(T.G2, 'change', r, { m_not_armed: r <= d.g2 }, r <= d.skillC);
    d0(T.G3, 'base', r, { m_not_wedged: true }, r <= d.skillB);
    d0(T.G3, 'change', r, { m_not_wedged: r <= d.g3 }, r <= d.skillC);
    rows.push({ task_id: T.G4, arm: 'gate-off', rep: r, failure_class: null, cost_usd: d.offCost, g4: { violating: r <= d.offViol, completed: r <= d.offDone, hand_clean: r > d.offViol && r <= d.offDone, gate_exercised: d.exercised } });
    rows.push({ task_id: T.G4, arm: 'gate-on', rep: r, failure_class: null, cost_usd: d.onCost, g4: { violating: r <= d.onViol, completed: r <= d.onDone, hand_clean: r > d.onViol && r <= d.onDone, gate_exercised: d.exercised } });
  }
  for (let i = 0; i < d.infra; i++) rows[i].failure_class = 'infra_fail';
  return rows.slice(0, rows.length - d.drop);
}
// edit(task, arm, rep, fn): a full good grid with ONE row altered by fn (deep-copied)
function edit(task, arm, rep, fn) { return mk().map((r) => { if (r.task_id !== task || r.arm !== arm || r.rep !== rep) return r; const c = JSON.parse(JSON.stringify(r)); fn(c); return c; }); }
const CASES = [
  { name: 'PASS: V3 5/5 vs base 0, G2 5, V4 5, G4 4/5 vs 1/5, spend equal', rows: mk(), want: 'PASS' },
  { name: 'PASS: V3 second branch 4/5 vs base 1', rows: mk({ g1c: 4, g1b: 1 }), want: 'PASS' },
  { name: 'PASS: V3 first branch 5/5 vs base 2', rows: mk({ g1b: 2 }), want: 'PASS' },
  { name: 'NOT-SHIP: V3 5/5 but base 3', rows: mk({ g1b: 3 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V3 4/5 but base 2', rows: mk({ g1c: 4, g1b: 2 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V3 change only 3/5', rows: mk({ g1c: 3 }), want: 'NOT-SHIP' },
  { name: 'PASS: G2 exactly 4/5', rows: mk({ g2: 4 }), want: 'PASS' },
  { name: 'NOT-SHIP: G2 3/5', rows: mk({ g2: 3 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V4 4/5', rows: mk({ g3: 4 }), want: 'NOT-SHIP' },
  { name: 'PASS: G4 gap exactly 2/5 (OFF 3/5, ON 1/5)', rows: mk({ offViol: 3, onViol: 1 }), want: 'PASS' },
  { name: 'NOT-SHIP: G4 gap 1/5 (OFF 3/5, ON 2/5)', rows: mk({ offViol: 3, onViol: 2 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: dead gate, ON equals OFF (4/5 and 4/5)', rows: mk({ onViol: 4 }), want: 'NOT-SHIP' },
  { name: 'PASS: ON spend exactly 1.5 x OFF', rows: mk({ onCost: 0.225 }), want: 'PASS' },
  { name: 'NOT-SHIP: ON spend 1.6 x OFF', rows: mk({ onCost: 0.24 }), want: 'NOT-SHIP' },
  { name: 'NOT NEEDED: V2 base G1 armed 4/5', rows: mk({ g1b: 4 }), want: 'NOT NEEDED' },
  { name: 'NOT NEEDED wins over a failing V3: base 5/5', rows: mk({ g1b: 5, g1c: 5 }), want: 'NOT NEEDED' },
  { name: 'PASS-not-NOT-NEEDED: base 3/5 is below V2 (then V3 fails: NOT-SHIP)', rows: mk({ g1b: 3 }), want: 'NOT-SHIP' },
  { name: 'INVALID: a marker control failed (V1)', rows: mk(), controls: { ok: false, failed: ['armed.N2-two-rules'] }, want: 'INVALID' },
  { name: 'INVALID: skill_invoked 12 of 15 (0.8) in base', rows: mk({ skillB: 4 }), want: 'INVALID' },
  { name: 'INVALID: skill_invoked low in change', rows: mk({ skillC: 2 }), want: 'INVALID' },
  { name: 'PASS: skill_invoked exactly 14/15 = 0.933 in base', rows: mk({ skillB: 5 }).map((r, i) => (i === 0 ? { ...r, skill_invoked: false } : r)), want: 'PASS' },
  { name: 'INVALID: an infra cell with no scorable row', rows: mk({ infra: 1 }), want: 'INVALID' },
  { name: 'INVALID: G4 gate_exercised failed', rows: mk({ exercised: false }), want: 'INVALID' },
  { name: 'INVALID beats NOT NEEDED (V1 first)', rows: mk({ g1b: 5, skillB: 0 }), want: 'INVALID' },
  { name: 'INVALID: all five G2/base cells replaced by G2/change reps 6..10 (40 rows, same count)', rows: mk().filter((r) => !(r.task_id === T.G2 && r.arm === 'base')).concat([6, 7, 8, 9, 10].map((rep) => ({ task_id: T.G2, arm: 'change', rep, failure_class: null, skill_invoked: true, markers: { m_not_armed: true } }))), want: 'INVALID' },
  { name: 'INVALID: one cell duplicated (two scorable rows), one other cell dropped (count still 40)', rows: (() => { const r = mk(); const dup = { ...r[0] }; return r.slice(1, r.length - 1).concat([dup, { ...r[0] }]); })(), want: 'INVALID' },
  { name: 'INVALID: unknown task in the grid', rows: mk().map((r, i) => (i === 3 ? { ...r, task_id: 'g9-unknown' } : r)), want: 'INVALID' },
  { name: 'prereg reps=4: a 40-row matrix with rep 5 cells is outside the grid -> INVALID', rows: mk(), prereg: { ...CARRIERS, reps: 4 }, want: 'INVALID' },
  { name: 'prereg reps=4: a full reps<=4 matrix (32 cells) is a complete grid (decided by the thresholds: NOT-SHIP, not INCOMPLETE or INVALID)', rows: mk().filter((r) => r.rep <= 4), prereg: { ...CARRIERS, reps: 4 }, want: 'NOT-SHIP' },
  { name: 'prereg without fixture_matrix -> INVALID (no fallback to lib constants)', rows: mk(), prereg: { carrier_decision: CARRIERS.carrier_decision, reps: 5 }, want: 'INVALID' },
  { name: 'prereg without integer reps -> INVALID', rows: mk(), prereg: { ...CARRIERS, reps: undefined }, want: 'INVALID' },
  { name: 'prereg fixture_matrix with a duplicate id -> INVALID (not swallowed by a Set)', rows: mk(), prereg: { ...CARRIERS, fixture_matrix: [...REAL_PREREG.fixture_matrix, REAL_PREREG.fixture_matrix[0]], tasks: [...REAL_PREREG.tasks, REAL_PREREG.tasks[0]] }, want: 'INVALID' },
  // ---- missing / null / mistyped data is INVALID, never skipped (review: a gate-on/rep5 cell without g4 used to score SHIP)
  { name: 'INVALID: G4 gate-on rep 5 row has no g4 object at all', rows: edit(T.G4, 'gate-on', 5, (r) => { delete r.g4; }), want: 'INVALID' },
  { name: 'INVALID: G4 gate-on rep 5 row has g4 = null', rows: edit(T.G4, 'gate-on', 5, (r) => { r.g4 = null; }), want: 'INVALID' },
  { name: 'INVALID: G4 row lacks g4.gate_exercised', rows: edit(T.G4, 'gate-off', 2, (r) => { delete r.g4.gate_exercised; }), want: 'INVALID' },
  { name: 'INVALID: G4 row lacks g4.completed', rows: edit(T.G4, 'gate-on', 3, (r) => { delete r.g4.completed; }), want: 'INVALID' },
  { name: 'INVALID: G4 row lacks g4.violating', rows: edit(T.G4, 'gate-on', 3, (r) => { delete r.g4.violating; }), want: 'INVALID' },
  { name: 'INVALID: G4 row lacks g4.hand_clean', rows: edit(T.G4, 'gate-off', 1, (r) => { delete r.g4.hand_clean; }), want: 'INVALID' },
  { name: 'INVALID: G4 row has a string where a boolean belongs (g4.violating = "false")', rows: edit(T.G4, 'gate-on', 4, (r) => { r.g4.violating = 'false'; }), want: 'INVALID' },
  { name: 'INVALID: G4 row lacks cost_usd (spend rule would silently see 0)', rows: edit(T.G4, 'gate-on', 2, (r) => { delete r.cost_usd; }), want: 'INVALID' },
  { name: 'INVALID: G1 change row has no markers object', rows: edit(T.G1, 'change', 1, (r) => { delete r.markers; }), want: 'INVALID' },
  { name: 'INVALID: G1 change row has markers = null', rows: edit(T.G1, 'change', 2, (r) => { r.markers = null; }), want: 'INVALID' },
  { name: 'INVALID: G1 change row markers lack m_armed', rows: edit(T.G1, 'change', 3, (r) => { r.markers = {}; }), want: 'INVALID' },
  { name: 'INVALID: G2 change row m_not_armed is a string', rows: edit(T.G2, 'change', 1, (r) => { r.markers.m_not_armed = 'true'; }), want: 'INVALID' },
  { name: 'INVALID: G3 change row lacks m_not_wedged', rows: edit(T.G3, 'change', 5, (r) => { r.markers = { other: true }; }), want: 'INVALID' },
  { name: 'INVALID: one row lacks skill_invoked (ratio would still be 14/15)', rows: edit(T.G2, 'base', 1, (r) => { delete r.skill_invoked; }), want: 'INVALID' },
  { name: 'INVALID: one row lacks failure_class', rows: edit(T.G3, 'base', 2, (r) => { delete r.failure_class; }), want: 'INVALID' },
  { name: 'INVALID: prereg lacks carrier_decision (the P0 rule cannot be skipped)', rows: mk(), prereg: (() => { const p = { ...CARRIERS }; delete p.carrier_decision; return p; })(), want: 'INVALID' },
  { name: 'INCOMPLETE: 39 of 40 cells', rows: mk({ drop: 1 }), want: 'INCOMPLETE' },
  { name: 'NOT-SHIP: P0 kept no carrier', rows: mk(), prereg: { ...REAL_PREREG, carrier_decision: { p0_kept_carriers: [] } }, want: 'NOT-SHIP' },
  { name: 'incomplete G4 cells are not in the denominator (OFF 3 completed of 5, 2 violating; ON 5 completed, 1)', rows: mk({ offViol: 2, offDone: 3 }), want: 'PASS' },
];
function runWith(cfg) {
  const v = L.makeVerdict(cfg);
  return CASES.map((c) => v(c.rows, c.controls || OK_CONTROLS, REPS, c.prereg || CARRIERS).verdict);
}
let bad = 0;
const real = runWith(L.DEFAULT_CFG);
CASES.forEach((c, i) => { const ok = real[i] === c.want; if (!ok) bad++; console.log(`${ok ? 'GREEN' : 'WRONG'} ${c.name} -> ${real[i]}`); });
console.log('--- RED phase: single-rule mutants (each must flip at least one case)');
for (const [name, cfg] of Object.entries(L.CFG_MUTANTS)) {
  const got = runWith(cfg);
  const flipped = CASES.map((c, i) => (got[i] !== c.want ? c.name : null)).filter(Boolean);
  if (!flipped.length) { bad++; console.log(`NOT-CAUGHT mutant ${name}`); } else console.log(`RED mutant ${name} flipped ${flipped.length} case(s), e.g. "${flipped[0]}"`);
}
// Fisher is reported, not claimed: spot-check two values (5/5 vs 0/5 -> 1/252; 4/5 vs 1/5 -> 26/252)
const fa = L.fisherOneSided(5, 5, 0, 5); const fb = L.fisherOneSided(4, 5, 1, 5);
if (Math.abs(fa - 1 / 252) > 1e-5 || Math.abs(fb - 26 / 252) > 1e-5) { bad++; console.log(`WRONG fisher ${fa} ${fb}`); } else console.log(`GREEN fisher one-sided ${fa} ${fb}`);
console.log(`table cases: ${CASES.length}, mutants: ${Object.keys(L.CFG_MUTANTS).length}, problems: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
