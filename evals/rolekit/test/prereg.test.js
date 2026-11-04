'use strict';
// prereg drafts, cost table, verdict script (positive and negative controls) and the stamper.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { compute, markdown } = require('../cost-table.js');
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

