'use strict';
// score-rolekit.js: schedule validation, exact arithmetic at the thresholds, pilot gates G5/G6. Test names start with
// "score-rolekit:" (collect-evidence.js derives the grader's negative-control evidence from them).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scoreFormal, scorePilot, schedule, evidenceProblems, REQUIRED_GRADERS, tailAtMost, dec } = require('../score-rolekit.js');
const { ROOT, ROLES } = require('./helpers.js');

const rj = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const pilot = rj('prereg/pilot.json'); const formal = rj('prereg/formal.json'); const man = rj('tasks/manifest.json');
const manMap = {}; for (const t of man.tasks) (manMap[t.role] = manMap[t.role] || []).push(t.id);

// ---- a one-role formal fixture with 20 tasks, one rep, one weak seat: pass arrays are explicit
const T20 = Array.from({ length: 20 }, (_, i) => `t${i}`);
const mini = (params = {}) => ({ row: 'rolekit-formal', cost: { estimate_usd_high: 1 }, design: { roles: ['planner'], tasks_by_role: { planner: 20 }, arms: [{ id: 'A', seats: ['weak1'] }, { id: 'B', seats: ['weak1'] }, { id: 'C', seats: ['weak1'] }, { id: 'D', seats: ['strong'] }], reps: { A: { weak1: 1 }, B: { weak1: 1 }, C: { weak1: 1 }, D: { strong: 1 } } },
  verdict: { params: { infra_arm_seat_max: 0.05, headroom_min: 0.15, gap_closed_min: 0.5, discordant_alpha: 0.10, harm_delta: -0.10, roles_pass_min: 1, ...params } } });
const ones = (n) => Array.from({ length: 20 }, (_, i) => (i < n ? 1 : 0));
function miniRows(a, b, c, d) {
  const out = [];
  for (const [arm, seat, arr] of [['A', 'weak1', a], ['B', 'weak1', b], ['C', 'weak1', c], ['D', 'strong', d]]) T20.forEach((task, i) => out.push({ role: 'planner', task, rep: 0, arm, seat, pass: arr[i], infra: false, parse_ok: true, kit_applied: true, cost_usd: 0.01 }));
  return out;
}
const MAP = { planner: T20 };
const verdict = (rows, params) => scoreFormal(rows, mini(params), MAP);

test('score-rolekit: a row outside the frozen schedule, a duplicate row and a malformed row are refused', () => {
  const rows = miniRows(ones(4), ones(8), ones(4), ones(12));
  assert.throws(() => verdict([...rows, { ...rows[0], task: 'zz' }]), /not in the frozen schedule/);
  assert.throws(() => verdict([...rows, { ...rows[0] }]), /duplicate row/);
  assert.throws(() => verdict([...rows, { ...rows[0], rep: 1 }]), /not in the frozen schedule/);
  assert.throws(() => verdict([...rows, { ...rows[0], seat: 'weak2' }]), /not in the frozen schedule/);
  assert.throws(() => verdict([{ ...rows[0], pass: 2 }]), /malformed row/);
});

test('score-rolekit: scheduled cells that were never submitted count as infra (dropping failing cells cannot rescue a result)', () => {
  const b = ones(20).map((x, i) => (i < 10 ? 1 : 0)); // B fails half
  const rows = miniRows(ones(4), b, ones(4), ones(20));
  const honest = verdict(rows);
  assert.strictEqual(honest.verdict, 'NOT_SHIP');
  const cherry = rows.filter((r) => !(r.arm === 'B' && r.pass === 0)); // quietly drop B's 10 failures
  const r = verdict(cherry);
  assert.strictEqual(r.verdict, 'INCONCLUSIVE_INFRA'); assert.strictEqual(r.infra_over[0].arm_seat, 'B/weak1');
  const one = rows.filter((x, i) => !(x.arm === 'B' && x.task === 't19')); // 1 of 20 missing = exactly 5%: allowed
  assert.notStrictEqual(verdict(one).verdict, 'INCONCLUSIVE_INFRA');
  const two = rows.filter((x) => !(x.arm === 'B' && (x.task === 't19' || x.task === 't18'))); // 10%: not allowed
  assert.strictEqual(verdict(two).verdict, 'INCONCLUSIVE_INFRA');
});

test('score-rolekit: formal scoring is refused while the task set does not match the design (task set not frozen)', () => {
  assert.throws(() => scoreFormal([], formal, manMap), /task set not frozen/);
});

test('score-rolekit: headroom exactly 0.15 (A=0.55, D=0.70) is headroom, not no_headroom (float 0.7-0.55 < 0.15)', () => {
  assert.ok(0.7 - 0.55 < 0.15, 'the float trap this guards against');
  const r = verdict(miniRows(ones(11), ones(14), ones(11), ones(14)), { discordant_alpha: 0.125 });
  assert.notStrictEqual(r.roles.planner.status, 'no_headroom');
  assert.strictEqual(r.roles.planner.headroom, 0.15);
  assert.strictEqual(verdict(miniRows(ones(11), ones(14), ones(11), ones(13)), { discordant_alpha: 0.125 }).roles.planner.status, 'no_headroom');
});

test('score-rolekit: harm exactly -0.10 (A=0.70, B=0.60) is harm, -0.05 is not (float 0.6-0.7 > -0.1)', () => {
  assert.ok(0.6 - 0.7 > -0.1, 'the float trap this guards against');
  const at = verdict(miniRows(ones(14), ones(12), ones(12), ones(20)));
  assert.strictEqual(at.roles_harm, 1); assert.strictEqual(at.verdict, 'NOT_SHIP');
  assert.strictEqual(verdict(miniRows(ones(14), ones(13), ones(13), ones(20))).roles_harm, 0);
});

test('score-rolekit: gap_closed exactly 0.5 passes, just below fails (decided on exact counts, not on a rounded gap)', () => {
  assert.strictEqual(verdict(miniRows(ones(4), ones(8), ones(4), ones(12))).verdict, 'SHIP_CANDIDATE'); // (8-4)/(12-4) = 1/2, b=4 c=0 p=1/16
  assert.strictEqual(verdict(miniRows(ones(4), ones(7), ones(4), ones(12))).verdict, 'NOT_SHIP'); // 3/8
});

test('score-rolekit: the discordant p value is compared exactly: p=1/8 passes alpha 0.125 and fails 0.12; p=1/16 passes 0.10', () => {
  assert.strictEqual(tailAtMost(3, 3, dec('0.125')).ok, true);
  assert.strictEqual(tailAtMost(3, 3, dec('0.12')).ok, false);
  assert.strictEqual(tailAtMost(4, 4, dec('0.10')).ok, true);
  const rows = miniRows(ones(11), ones(14), ones(11), ones(14)); // b=3, c=0
  assert.strictEqual(verdict(rows, { discordant_alpha: 0.125 }).verdict, 'SHIP_CANDIDATE');
  assert.strictEqual(verdict(rows, { discordant_alpha: 0.12 }).verdict, 'NOT_SHIP');
});

test('score-rolekit: a kit no better than the placebo is NOT_SHIP; thresholds must be plain decimals', () => {
  assert.strictEqual(verdict(miniRows(ones(4), ones(16), ones(16), ones(18))).verdict, 'NOT_SHIP');
  assert.throws(() => verdict(miniRows(ones(4), ones(8), ones(4), ones(12)), { gap_closed_min: '5e-1' }), /plain decimal/);
});

// ---- pilot
function pilotRows(over = (r) => r) {
  return schedule(pilot, manMap).map((k) => {
    const [arm, seat, role, task, rep] = k.split('|');
    const first = task === manMap[role][0];
    const pass = arm === 'A' || arm === 'C' ? (first ? 1 : 0) : 1;
    return over({ arm, seat, role, task, rep: +rep, pass, infra: false, parse_ok: true, kit_applied: true, cost_usd: 0.02 });
  });
}
const goodEv = { schema_version: 1, row: 'rolekit-pilot', head_sha: 'a'.repeat(40), unit_tests: { tests: 60, pass: 60, fail: 0 }, negative_controls: { graders_red: REQUIRED_GRADERS }, sentinel_calls: 0 };

test('score-rolekit: pilot with healthy rows and verified evidence is PILOT_OK; the schedule has 126 cells', () => {
  assert.strictEqual(schedule(pilot, manMap).length, 126);
  const r = scorePilot(pilotRows(), pilot, manMap, goodEv);
  assert.strictEqual(r.verdict, 'PILOT_OK', JSON.stringify(r.failing_gates));
});

test('score-rolekit: pilot G5 - a missing, NaN, negative or non-number cost is never read as 0', () => {
  for (const bad of [undefined, NaN, -1, '0.02', null, Infinity]) {
    let n = 0;
    const r = scorePilot(pilotRows((x) => { n += 1; return n === 5 ? { ...x, cost_usd: bad } : x; }), pilot, manMap, goodEv);
    assert.strictEqual(r.verdict, 'PILOT_FIX', String(bad)); assert.ok(r.failing_gates.includes('G5'), String(bad)); assert.match(r.why.G5, /without a finite non-negative cost_usd/);
  }
  assert.ok(scorePilot(pilotRows((x) => ({ ...x, cost_usd: 1 })), pilot, manMap, goodEv).failing_gates.includes('G5'));
});

test('score-rolekit: pilot G6 - no evidence, failing tests, a missing grader, sentinel calls, wrong row or a malformed head all block PILOT_OK', () => {
  const rows = pilotRows();
  const cases = [
    ['no evidence', undefined],
    ['failing test', { ...goodEv, unit_tests: { tests: 60, pass: 59, fail: 1 } }],
    ['zero tests', { ...goodEv, unit_tests: { tests: 0, pass: 0, fail: 0 } }],
    ['grader without a negative control', { ...goodEv, negative_controls: { graders_red: REQUIRED_GRADERS.slice(1) } }],
    ['sentinel call', { ...goodEv, sentinel_calls: 1 }],
    ['sentinel not an integer', { ...goodEv, sentinel_calls: '0' }],
    ['wrong row', { ...goodEv, row: 'rolekit-formal' }],
    ['bad head', { ...goodEv, head_sha: 'abc' }],
    ['not an object', 'ok'],
  ];
  for (const [name, ev] of cases) {
    const r = scorePilot(rows, pilot, manMap, ev);
    assert.strictEqual(r.verdict, 'PILOT_FIX', name); assert.ok(r.failing_gates.includes('G6'), name);
  }
  assert.deepStrictEqual(evidenceProblems(goodEv, pilot), []);
});

test('score-rolekit: pilot gates G1-G4 still fire, and missing cells count as infra (G1)', () => {
  const noKit = scorePilot(pilotRows((x) => (x.arm === 'B' ? { ...x, kit_applied: false } : x)), pilot, manMap, goodEv);
  assert.ok(noKit.failing_gates.includes('G2'));
  assert.ok(scorePilot(pilotRows((x) => (x.arm === 'A' ? { ...x, parse_ok: false } : x)), pilot, manMap, goodEv).failing_gates.includes('G3'));
  assert.ok(scorePilot(pilotRows((x) => ({ ...x, pass: 1 })), pilot, manMap, goodEv).failing_gates.includes('G4'));
  const dropped = pilotRows().filter((r, i) => i % 3 !== 0);
  assert.ok(scorePilot(dropped, pilot, manMap, goodEv).failing_gates.includes('G1'));
  assert.throws(() => scorePilot([...pilotRows(), pilotRows()[0]], pilot, manMap, goodEv), /duplicate row/);
});

test('score-rolekit: collect-evidence derives graders_red from tests that really passed; a partial run cannot satisfy G6', () => {
  const cp = require('child_process');
  const r = cp.spawnSync('node', [path.join(ROOT, 'collect-evidence.js'), '--row', 'rolekit-pilot', '--head', 'b'.repeat(40), '--sentinel-calls', '0', '--only', 'negative-controls.test.js'], { encoding: 'utf8' });
  const ev = JSON.parse(r.stdout);
  assert.strictEqual(ev.unit_tests.tests, 10); assert.strictEqual(ev.unit_tests.fail, 0); assert.strictEqual(ev.unit_tests.pass, 10);
  assert.deepStrictEqual(ev.negative_controls.graders_red.sort(), ['debugger', 'explorer', 'planner', 'reviewer']);
  assert.ok(evidenceProblems(ev, { row: 'rolekit-pilot' }).some((p) => /graders_red/.test(p)), 'four of nine graders is not enough');
  assert.strictEqual(cp.spawnSync('node', [path.join(ROOT, 'collect-evidence.js'), '--row', 'x'], { encoding: 'utf8' }).status, 2);
});
