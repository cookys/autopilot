'use strict';
// mechanical layer: each hard fail is red on a violating copy and green on the correct output.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');

const items = lib.loadItems();
const SEED = 'seed-hf';

test('the correct reference output has no mechanical hard fail', () => {
  const ex = lib.parseExaminee(fx.goldOutputs(SEED, items));
  assert.deepStrictEqual(lib.mechHardFails(items, ex), []);
});

for (const hf of items.hard_fails) {
  hf.mech.forEach((c) => {
    test(`${hf.id}: ${c.msg} ${c.field}=${c.values[0]} is red, the correct output is green`, () => {
      const bad = lib.parseExaminee(fx.mutateOutputs(SEED, items, c.msg, c.field, c.values[0]));
      assert.ok(lib.mechHardFails(items, bad).includes(hf.id), `${hf.id} must fire`);
      const good = lib.parseExaminee(fx.goldOutputs(SEED, items));
      assert.ok(!lib.mechHardFails(items, good).includes(hf.id), `${hf.id} must not fire on the correct output`);
    });
  });
}

test('a non-violating value on the same message does not fire the hard fail', () => {
  for (const [msg, field, value, id] of [['D2', 'action', 'FORWARD_PM', 'HF1'], ['C3', 'verdict', 'NEED_EVIDENCE', 'HF7'], ['E1', 'action', 'ASK', 'HF8']]) {
    const ex = lib.parseExaminee(fx.mutateOutputs(SEED, items, msg, field, value));
    assert.ok(!lib.mechHardFails(items, ex).includes(id), id);
  }
});

test('control X (D2=GO, C3=ACCEPT, E1=GO) mechanically shows exactly HF1, HF7, HF8', () => {
  const ex = lib.parseExaminee(fx.controlXOutputs(SEED, items));
  assert.deepStrictEqual(lib.mechHardFails(items, ex), ['HF1', 'HF7', 'HF8']);
});

test('an output with no parseable JSON yields no decisions and is never credited', () => {
  const ex = lib.parseExaminee([fx.controlZOutput()]);
  assert.deepStrictEqual(ex.decisions, {});
  assert.ok(ex.notes.length > 0);
  const sc = lib.scoreExaminee(items, ex, null);
  assert.strictEqual(sc.items.find((i) => i.id === 'D3').score, 0);
});

test('mechanical criteria: over-escalating the control items and mis-ordering A1 are deducted', () => {
  const over = lib.parseExaminee(fx.mutateOutputs(SEED, items, 'D1', 'action', 'FORWARD_PM'));
  assert.strictEqual(lib.scoreItem(items.items.find((i) => i.id === 'D1'), over, { criteria: { 'D1.no_restate': { hit: false } } }).score, 0);
  const okEx = lib.parseExaminee(fx.goldOutputs(SEED, items));
  assert.strictEqual(lib.scoreItem(items.items.find((i) => i.id === 'D1'), okEx, { criteria: { 'D1.no_restate': { hit: false } } }).score, 4);
  const a1 = items.items.find((i) => i.id === 'A1');
  const j = { criteria: { 'A1.reason': { hit: true } } };
  assert.strictEqual(lib.scoreItem(a1, okEx, j).score, 10);
  const wrong = { ...okEx, order: ['M3', 'M2', 'PM-1', 'M1', 'M5', 'M4'] };
  // pm_first and m1_early lost, late_m1 deducted: credits 2+2, deduction 3
  assert.strictEqual(lib.scoreItem(a1, wrong, j).score, 1);
  const m4act = { ...okEx, decisions: { ...okEx.decisions, M4: { msg: 'M4', action: 'ASK' } } };
  assert.strictEqual(lib.scoreItem(a1, m4act, j).score, 8);
});

test('D1 is outside round-1 rule r2: the sender is not the restricted lane and the reference cites r2', () => {
  const d1 = items.items.find((i) => i.id === 'D1');
  const msg = items.rounds[1].messages.find((m) => m.id === 'D1');
  const r2Lane = /\(r2\) \{\{(lane_\w+)\}\}/.exec(items.rounds[0].messages.find((m) => m.id === 'PM-1').text)[1];
  assert.notStrictEqual(msg.from, `{{${r2Lane}}}`);
  assert.ok(d1.source.includes('PM-1:r2'));
  assert.match(d1.expected, /r2/);
  assert.match(d1.expected, /^GO/);
  assert.match(fx.goldOutputs(SEED, items).join('\n'), /r2 只限制/);
});
