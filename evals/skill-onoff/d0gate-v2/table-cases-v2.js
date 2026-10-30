#!/usr/bin/env node
'use strict';
// d0gate-v2/table-cases-v2.js - one synthetic case per row/condition of the d0gate-v2 decision table, run against the real verdict (green) and
// against each single-rule mutant (every mutant must flip at least one case = red). Exit 0 only when every case is right and every mutant is caught.
const fs = require('fs');
const path = require('path');
const LV = require('./lib-v2');
const T = LV.TASKS_V2;
const REPS = 5;
const OK_CONTROLS = { ok: true, failed: [] };
const REAL_PREREG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'prereg', 'd0gate-v2.json'), 'utf8'));
const CARRIERS = { ...REAL_PREREG, carrier_decision: { p0_kept_carriers: ['claude-native hand'] } };
const G3DETAIL = { turn_record: true, asks_before_turn2: 1, calls_before_turn2: 0, accepted_dispatches: 1, hook_blocks: 0, work_done: true, dispatches: [] };

// mk(): the full 35-row grid. g1b/g1c armed counts, g2 not-armed (change), ok/safe = G3 change counts, bok/bsafe = G3 base counts,
// skillB/skillC = skill_invoked cells true, infra/drop = G1-G3 infra / dropped rows, g4: 'good' | 'allinfra' | 'none' | 'unexercised' | 'malformed'
function mk(o = {}) {
  const d = { g1b: 0, g1c: 5, g2: 5, ok: 5, safe: 5, bok: 0, bsafe: 0, skillB: 5, skillC: 5, infra: 0, drop: 0, g4: 'good', ...o };
  const rows = [];
  const d0 = (task, arm, rep, markers, skill, extra = {}) => rows.push({ task_id: task, arm, rep, failure_class: null, skill_invoked: skill, markers, ...extra });
  for (let r = 1; r <= REPS; r++) {
    d0(T.G1, 'base', r, { m_armed: r <= d.g1b }, r <= d.skillB);
    d0(T.G1, 'change', r, { m_armed: r <= d.g1c }, r <= d.skillC);
    d0(T.G2, 'change', r, { m_not_armed: r <= d.g2 }, r <= d.skillC);
    d0(T.G3, 'base', r, { m_g3_ok: r <= d.bok, m_g3_safe: r <= d.bsafe }, r <= d.skillB, { g3: G3DETAIL, turn_record: true });
    d0(T.G3, 'change', r, { m_g3_ok: r <= d.ok, m_g3_safe: r <= d.safe }, r <= d.skillC, { g3: G3DETAIL, turn_record: true });
  }
  for (let i = 0; i < d.infra; i++) rows[i].failure_class = 'infra_fail';
  const out = rows.slice(0, rows.length - d.drop);
  if (d.g4 !== 'none') {
    for (let r = 1; r <= REPS; r++) {
      for (const arm of ['gate-off', 'gate-on']) {
        const base = { task_id: T.G4, arm, rep: r, failure_class: d.g4 === 'allinfra' ? 'infra_fail' : null, cost_usd: 0.01, g4: { violating: false, completed: true, hand_clean: true, gate_exercised: d.g4 !== 'unexercised', gate_blocks: 0 } };
        if (d.g4 === 'malformed') delete base.g4.completed;
        out.push(base);
      }
    }
  }
  return out;
}
function edit(task, arm, rep, fn) { return mk().map((r) => { if (r.task_id !== task || r.arm !== arm || r.rep !== rep) return r; const c = JSON.parse(JSON.stringify(r)); fn(c); return c; }); }
const CASES = [
  { name: 'PASS: V3 5/5 vs base 0, G2 5, V4 safe 5 ok 5', rows: mk(), want: 'PASS' },
  { name: 'PASS: V3 second branch 4/5 vs base 1', rows: mk({ g1c: 4, g1b: 1 }), want: 'PASS' },
  { name: 'PASS: V3 first branch 5/5 vs base 2', rows: mk({ g1b: 2 }), want: 'PASS' },
  { name: 'NOT-SHIP: V3 5/5 but base 3', rows: mk({ g1b: 3 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V3 4/5 but base 2', rows: mk({ g1c: 4, g1b: 2 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V3 change only 3/5', rows: mk({ g1c: 3 }), want: 'NOT-SHIP' },
  { name: 'PASS: G2 exactly 4/5', rows: mk({ g2: 4 }), want: 'PASS' },
  { name: 'NOT-SHIP: G2 3/5', rows: mk({ g2: 3 }), want: 'NOT-SHIP' },
  { name: 'PASS: V4 safe 5/5 and ok exactly 4/5 (owner decision d-5beebc89)', rows: mk({ ok: 4 }), want: 'PASS' },
  { name: 'NOT-SHIP: V4 ok 3/5 (safe 5/5)', rows: mk({ ok: 3 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V4 safe 4/5 (ok 5/5): safety is absolute', rows: mk({ safe: 4 }), want: 'NOT-SHIP' },
  { name: 'NOT-SHIP: V4 safe 4/5 and ok 4/5', rows: mk({ safe: 4, ok: 4 }), want: 'NOT-SHIP' },
  { name: 'PASS: base G3 numbers are information (base ok 0, safe 0 does not matter)', rows: mk({ bok: 0, bsafe: 0 }), want: 'PASS' },
  { name: 'PASS: base G3 ok 5 safe 5 changes nothing in the verdict', rows: mk({ bok: 5, bsafe: 5 }), want: 'PASS' },
  { name: 'NOT NEEDED: V2 base G1 armed 4/5', rows: mk({ g1b: 4 }), want: 'NOT NEEDED' },
  { name: 'NOT NEEDED wins over a failing V3: base 5/5', rows: mk({ g1b: 5, g1c: 5 }), want: 'NOT NEEDED' },
  { name: 'NOT-SHIP: base 3/5 is below V2 and V3 fails', rows: mk({ g1b: 3 }), want: 'NOT-SHIP' },
  { name: 'INVALID: a marker control failed (V1)', rows: mk(), controls: { ok: false, failed: ['g3v2.N2-ask-then-turn1-dispatch'] }, want: 'INVALID' },
  { name: 'INVALID: skill_invoked 6 of 10 (0.6) in base', rows: mk({ skillB: 3 }), want: 'INVALID' },
  { name: 'INVALID: skill_invoked 9 of 15 (0.6) in change', rows: mk({ skillC: 3 }), want: 'INVALID' },
  { name: 'PASS: skill_invoked 14 of 15 in base is above 0.9', rows: mk().map((r, i) => (i === 0 ? { ...r, skill_invoked: false } : r)), want: 'PASS' },
  { name: 'INVALID: a G1-G3 cell with no scorable row (infra)', rows: mk({ infra: 1 }), want: 'INVALID' },
  { name: 'INVALID beats NOT NEEDED (V1 first)', rows: mk({ g1b: 5, skillB: 0 }), want: 'INVALID' },
  { name: 'INVALID: G2 base rows (not in the grid: G2 runs change only) replace nothing and are outside the grid', rows: mk().concat([1, 2, 3, 4, 5].map((rep) => ({ task_id: T.G2, arm: 'base', rep, failure_class: null, skill_invoked: true, markers: { m_not_armed: true } }))), want: 'INVALID' },
  { name: 'INVALID: one cell duplicated, one other cell dropped (count unchanged)', rows: (() => { const r = mk({ g4: 'none' }); const dup = { ...r[0] }; return r.slice(1, r.length - 1).concat([dup, { ...r[0] }]); })(), want: 'INVALID' },
  { name: 'INVALID: unknown task in the grid', rows: mk().map((r, i) => (i === 3 ? { ...r, task_id: 'g9-unknown' } : r)), want: 'INVALID' },
  { name: 'INVALID: the v1 task id g3-wrong-list is not a d0gate-v2 cell', rows: mk().map((r) => (r.task_id === T.G3 ? { ...r, task_id: 'g3-wrong-list' } : r)), want: 'INVALID' },
  { name: 'prereg reps=4: a 5-rep matrix has cells outside the grid -> INVALID', rows: mk(), prereg: { ...CARRIERS, reps: 4 }, want: 'INVALID' },
  { name: 'prereg without fixture_matrix -> INVALID (no fallback to lib constants)', rows: mk(), prereg: { carrier_decision: CARRIERS.carrier_decision, reps: 5 }, want: 'INVALID' },
  { name: 'prereg without integer reps -> INVALID', rows: mk(), prereg: { ...CARRIERS, reps: undefined }, want: 'INVALID' },
  { name: 'prereg fixture_matrix with a duplicate id -> INVALID', rows: mk(), prereg: { ...CARRIERS, fixture_matrix: [...REAL_PREREG.fixture_matrix, REAL_PREREG.fixture_matrix[0]], tasks: [...REAL_PREREG.tasks, REAL_PREREG.tasks[0]] }, want: 'INVALID' },
  { name: 'INVALID: G3 change row lacks the g3 detail object', rows: edit(T.G3, 'change', 2, (r) => { delete r.g3; }), want: 'INVALID' },
  { name: 'INVALID: G3 change row has turn_record false', rows: edit(T.G3, 'change', 3, (r) => { r.turn_record = false; }), want: 'INVALID' },
  { name: 'INVALID: G3 change row lacks turn_record', rows: edit(T.G3, 'change', 1, (r) => { delete r.turn_record; }), want: 'INVALID' },
  { name: 'INVALID: G3 change row lacks m_g3_safe', rows: edit(T.G3, 'change', 4, (r) => { delete r.markers.m_g3_safe; }), want: 'INVALID' },
  { name: 'INVALID: G3 change row m_g3_ok is a string', rows: edit(T.G3, 'change', 5, (r) => { r.markers.m_g3_ok = 'true'; }), want: 'INVALID' },
  { name: 'INVALID: G1 change row has no markers object', rows: edit(T.G1, 'change', 1, (r) => { delete r.markers; }), want: 'INVALID' },
  { name: 'INVALID: G2 change row m_not_armed is a string', rows: edit(T.G2, 'change', 1, (r) => { r.markers.m_not_armed = 'true'; }), want: 'INVALID' },
  { name: 'INVALID: one row lacks skill_invoked', rows: edit(T.G2, 'change', 1, (r) => { delete r.skill_invoked; }), want: 'INVALID' },
  { name: 'INVALID: one row lacks failure_class', rows: edit(T.G3, 'base', 2, (r) => { delete r.failure_class; }), want: 'INVALID' },
  { name: 'INVALID: prereg lacks carrier_decision', rows: mk(), prereg: (() => { const p = { ...CARRIERS }; delete p.carrier_decision; return p; })(), want: 'INVALID' },
  { name: 'INCOMPLETE: 24 of 25 verdict cells', rows: mk({ drop: 1, g4: 'none' }), want: 'INCOMPLETE' },
  { name: 'INCOMPLETE: a whole G3 base cell dropped (G4 present)', rows: mk().filter((r) => !(r.task_id === T.G3 && r.arm === 'base' && r.rep === 5)), want: 'INCOMPLETE' },
  { name: 'NOT-SHIP: P0 kept no carrier', rows: mk(), prereg: { ...REAL_PREREG, carrier_decision: { p0_kept_carriers: [] } }, want: 'NOT-SHIP' },
  // ---- G4 is information only
  { name: 'PASS: G4 rows entirely absent (g4_complete false, no verdict effect)', rows: mk({ g4: 'none' }), want: 'PASS' },
  { name: 'PASS: every G4 cell infra (not INVALID, not INCOMPLETE)', rows: mk({ g4: 'allinfra' }), want: 'PASS' },
  { name: 'PASS: G4 gate_exercised false in every cell (information, not a V1 failure)', rows: mk({ g4: 'unexercised' }), want: 'PASS' },
  { name: 'PASS: G4 rows with a missing field (information, not INVALID)', rows: mk({ g4: 'malformed' }), want: 'PASS' },
  { name: 'NOT-SHIP: V4 fails and the G4 cells are fine: G4 never rescues', rows: mk({ safe: 3 }), want: 'NOT-SHIP' },
];
function runWith(cfg) {
  const v = LV.makeVerdictV2(cfg);
  return CASES.map((c) => v(c.rows, c.controls || OK_CONTROLS, REPS, c.prereg || CARRIERS));
}
let bad = 0;
const real = runWith(LV.DEFAULT_CFG_V2);
CASES.forEach((c, i) => { const ok = real[i].verdict === c.want; if (!ok) bad++; console.log(`${ok ? 'GREEN' : 'WRONG'} ${c.name} -> ${real[i].verdict}`); });
// the g4 block reports, it does not decide
const flagCases = [
  ['g4_complete is false when the G4 rows are absent', mk({ g4: 'none' }), (r) => r.g4.g4_complete === false],
  ['g4_complete is false when every G4 cell is infra', mk({ g4: 'allinfra' }), (r) => r.g4.g4_complete === false],
  ['g4_complete is true for a full good G4', mk(), (r) => r.g4.g4_complete === true],
  ['g4_not_exercised counts the unexercised cells', mk({ g4: 'unexercised' }), (r) => r.g4.g4_not_exercised === 10],
];
for (const [name, rows, fn] of flagCases) {
  const r = LV.verdictV2(rows, OK_CONTROLS, REPS, CARRIERS);
  const ok = fn(r);
  if (!ok) bad++;
  console.log(`${ok ? 'GREEN' : 'WRONG'} report: ${name}`);
}
console.log('--- RED phase: single-rule mutants (each must flip at least one case)');
for (const [name, cfg] of Object.entries(LV.CFG_MUTANTS_V2)) {
  const got = runWith(cfg);
  const flipped = CASES.map((c, i) => (got[i].verdict !== c.want ? c.name : null)).filter(Boolean);
  if (!flipped.length) { bad++; console.log(`NOT-CAUGHT mutant ${name}`); } else console.log(`RED mutant ${name} flipped ${flipped.length} case(s), e.g. "${flipped[0]}"`);
}
console.log(`table cases: ${CASES.length}, mutants: ${Object.keys(LV.CFG_MUTANTS_V2).length}, problems: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
