'use strict';
// prereg drafts, cost table, verdict script (positive and negative controls) and the stamper.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { compute, markdown } = require('../cost-table.js');
const { scoreFormal, scorePilot, binomTail, validateRows } = require('../score-rolekit.js');
const { ROOT, ROLES, tmp, rm } = require('./helpers.js');

const rj = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const formal = rj('prereg/formal.json'); const pilot = rj('prereg/pilot.json');

test('both preregs are drafts, unstamped, and name every required section', () => {
  for (const p of [pilot, formal]) {
    assert.strictEqual(p.status, 'draft'); assert.strictEqual(p.stamped, false); assert.strictEqual(p.stamp, null);
    for (const k of ['hypotheses', 'design', 'metrics', 'estimators', 'verdict', 'exclusions', 'infra_failure', 'cost', 'freeze_files']) assert.ok(p[k], k);
    assert.deepStrictEqual(Object.keys(p.metrics.per_role).sort(), [...ROLES].sort());
    assert.strictEqual(p.cost.billing, 'subscription only; no API-key path');
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'prereg/FROZEN.json')), 'FROZEN.json must not exist before the PM stamps');
  assert.strictEqual(formal.cost.cap_usd, 75);
  assert.match(formal.verdict.rule, /gap_closed\(r\) = \(s_B\(r\) - s_A\(r\)\) \/ \(s_D\(r\) - s_A\(r\)\)/);
});

test('cost numbers in the prereg and in COST-TABLE-*.md are exactly what cost-table.js computes', () => {
  for (const [row, p] of [['pilot', pilot], ['formal', formal]]) {
    const c = compute(p.design);
    assert.strictEqual(p.cost.cells, c.total.cells);
    assert.strictEqual(p.cost.estimate_usd_low, c.total.usd_low);
    assert.strictEqual(p.cost.estimate_usd_high, c.total.usd_high);
    assert.strictEqual(fs.readFileSync(path.join(ROOT, `COST-TABLE-${row}.md`), 'utf8'), markdown(row, c, p.cost.cap_usd));
  }
  assert.strictEqual(compute(pilot.design).total.cells, 126);
  assert.ok(formal.cost.estimate_usd_high_with_margin <= 75, 'formal estimate with the 50% margin must fit the cap');
  assert.ok(pilot.cost.estimate_usd_high_with_margin <= pilot.cost.cap_usd);
});

test('binomial tail', () => { assert.strictEqual(binomTail(5, 5), 1 / 32); assert.strictEqual(binomTail(0, 4), 1); });

// synthetic formal rows: per role, tasks x reps; pass probabilities are set by explicit lists
function rows(spec, { tasks = 10, reps = 2, infra = {} } = {}) {
  const out = [];
  for (const role of ROLES) {
    const s = spec[role];
    for (let t = 0; t < tasks; t += 1) for (let rep = 0; rep < reps; rep += 1) {
      for (const [arm, seat, rate] of [['A', 'weak1', s.A], ['B', 'weak1', s.B], ['C', 'weak1', s.C], ['D', 'strong', s.D]]) {
        if (arm === 'D' && rep > 0) continue;
        const k = t * reps + rep;
        const pass = ((k * 7 + (arm.charCodeAt(0) * 3)) % 20) / 20 < rate ? 1 : 0;
        out.push({ role, task: `t${t}`, rep, arm, seat, pass, infra: !!(infra[arm] && k % 20 < infra[arm] * 20), parse_ok: true, kit_applied: true, cost_usd: 0.02 });
      }
    }
  }
  return out;
}
const win = { A: 0.2, B: 0.9, C: 0.2, D: 0.95 };
const flat = { A: 0.2, B: 0.2, C: 0.2, D: 0.95 };

test('verdict: three roles where B closes the gap and beats the placebo -> SHIP_CANDIDATE', () => {
  const r = scoreFormal(rows({ planner: win, implementer: win, reviewer: win, verifier: flat, debugger: flat, explorer: flat }), formal);
  assert.strictEqual(r.verdict, 'SHIP_CANDIDATE'); assert.strictEqual(r.roles_pass, 3);
});
test('negative control: a kit that is no better than the placebo -> NOT_SHIP even when B beats A', () => {
  const sameAsPlacebo = { A: 0.2, B: 0.9, C: 0.9, D: 0.95 };
  const r = scoreFormal(rows({ planner: sameAsPlacebo, implementer: sameAsPlacebo, reviewer: sameAsPlacebo, verifier: sameAsPlacebo, debugger: sameAsPlacebo, explorer: sameAsPlacebo }), formal);
  assert.strictEqual(r.verdict, 'NOT_SHIP'); assert.strictEqual(r.roles_pass, 0);
});
test('negative control: two winning roles are not enough; one harmed role blocks even with three winners', () => {
  assert.strictEqual(scoreFormal(rows({ planner: win, implementer: win, reviewer: flat, verifier: flat, debugger: flat, explorer: flat }), formal).verdict, 'NOT_SHIP');
  const harm = { A: 0.6, B: 0.3, C: 0.3, D: 0.95 };
  const r = scoreFormal(rows({ planner: win, implementer: win, reviewer: win, verifier: harm, debugger: flat, explorer: flat }), formal);
  assert.strictEqual(r.roles_harm, 1); assert.strictEqual(r.verdict, 'NOT_SHIP');
});
test('negative control: no headroom (D no better than A) is reported, never counted as a pass', () => {
  const nh = { A: 0.9, B: 0.95, C: 0.2, D: 0.92 };
  const r = scoreFormal(rows({ planner: nh, implementer: nh, reviewer: nh, verifier: nh, debugger: nh, explorer: nh }), formal);
  assert.strictEqual(r.roles.planner.status, 'no_headroom'); assert.strictEqual(r.verdict, 'NOT_SHIP');
});
test('negative control: more than 5% infra in an arm -> INCONCLUSIVE_INFRA', () => {
  const r = scoreFormal(rows({ planner: win, implementer: win, reviewer: win, verifier: win, debugger: win, explorer: win }, { infra: { B: 0.25 } }), formal);
  assert.strictEqual(r.verdict, 'INCONCLUSIVE_INFRA');
});
test('malformed rows are refused', () => { assert.throws(() => validateRows([{ arm: 'Z' }])); assert.throws(() => validateRows([{ arm: 'A', role: 'x', task: 't', rep: 0, seat: 'weak1', infra: false, pass: 2 }])); });

test('pilot verdict: healthy instrument -> PILOT_OK; each broken gate names itself', () => {
  const good = rows({ planner: win, implementer: win, reviewer: win, verifier: win, debugger: win, explorer: win }, { tasks: 3, reps: 2 });
  assert.strictEqual(scorePilot(good, pilot).verdict, 'PILOT_OK');
  const noKit = good.map((r) => (r.arm === 'B' ? { ...r, kit_applied: false } : r));
  assert.deepStrictEqual(scorePilot(noKit, pilot).failing_gates.includes('G2'), true);
  const noParse = good.map((r) => (r.arm === 'A' ? { ...r, parse_ok: false } : r));
  assert.ok(scorePilot(noParse, pilot).failing_gates.includes('G3'));
  const ceiling = rows({ planner: { A: 1, B: 1, C: 1, D: 1 }, implementer: { A: 1, B: 1, C: 1, D: 1 }, reviewer: { A: 1, B: 1, C: 1, D: 1 }, verifier: win, debugger: win, explorer: win }, { tasks: 3, reps: 2 });
  assert.ok(scorePilot(ceiling, pilot).failing_gates.includes('G4'));
  const pricey = good.map((r) => ({ ...r, cost_usd: 1 }));
  assert.ok(scorePilot(pricey, pilot).failing_gates.includes('G5'));
  const infra = good.map((r, i) => (i % 3 === 0 ? { ...r, infra: true } : r));
  assert.ok(scorePilot(infra, pilot).failing_gates.includes('G1'));
});
