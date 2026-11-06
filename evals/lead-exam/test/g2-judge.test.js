'use strict';
// g2 items 5 and 6: control Z voids on any credit criterion hit; quote rules for hit and non-hit criteria.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');
const jd = require('../judge');
const { gradeExam } = require('../grade');

const items = lib.loadItems();
const SEED = 'seed-g2j';
const grade = (judge) => gradeExam({ items, seed: SEED, runs: [{ name: 'gold', model: 'stub', outputs: fx.goldOutputs(SEED, items) }], judge, rand: () => 0.5 });

test('control Z: a credit criterion hit on the padding examinee voids the round even with answered=false and no hard fail', async () => {
  const rep = await grade(jd.stubJudge(items, { zCredit: true }));
  assert.strictEqual(rep.controls.rounds[1].status, 'void');
  assert.match(rep.controls.rounds[1].reason, /control Z/);
  assert.strictEqual(rep.status, 'partial');
});

test('control Z positive: an honest judge leaves every round ok', async () => {
  const rep = await grade(jd.stubJudge(items));
  assert.strictEqual(rep.status, 'ok');
});

test('quote rule: a non-hit criterion with a non-empty quote voids the reply (verbatim or not)', async () => {
  const rep = await grade(jd.stubJudge(items, { staleQuote: true }));
  assert.strictEqual(rep.controls.rounds[1].status, 'void');
  assert.ok(rep.calls.some((c) => c.errors && c.errors.some((m) => /non-hit .*quote/.test(m))));
});

test('quote rule unit: non-hit with empty quote ok; non-hit with fabricated quote and hit with fabricated quote both rejected', () => {
  const map = lib.deriveNames(items, SEED);
  const req = jd.buildJudgeRequest(items, map, 2, { 'ex-1': 'hello world text' }, null);
  const mk = (hit, quote) => {
    const ex = { items: {}, hard_fails: [] };
    req.items.forEach((it) => {
      ex.items[it.id] = { answered: true, criteria: {} };
      it.criteria.forEach((c) => { ex.items[it.id].criteria[c.id] = { hit: false, quote: '' }; if (c.max_count > 1) ex.items[it.id].criteria[c.id].count = 1; });
    });
    const it = req.items.find((i) => i.criteria.length);
    const c = it.criteria[0];
    ex.items[it.id].criteria[c.id] = { hit, quote };
    if (hit && c.max_count > 1) ex.items[it.id].criteria[c.id].count = 1;
    return JSON.stringify({ reference_conflicts: [], examinees: { 'ex-1': ex } });
  };
  assert.strictEqual(jd.validateJudgeReply(mk(false, ''), req).ok, true);
  assert.strictEqual(jd.validateJudgeReply(mk(true, 'hello world'), req).ok, true);
  assert.strictEqual(jd.validateJudgeReply(mk(false, 'hello world'), req).ok, false, 'non-hit must be empty');
  assert.strictEqual(jd.validateJudgeReply(mk(false, 'not in output'), req).ok, false);
  assert.strictEqual(jd.validateJudgeReply(mk(true, 'not in output'), req).ok, false);
});
