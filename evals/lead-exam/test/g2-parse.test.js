'use strict';
// g2 item 1: a later round's entry for the same message id must not erase an earlier hard fail.
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../lib');
const fx = require('../fixtures');

const items = lib.loadItems();
const SEED = 'seed-g2';

test('D2=GO in round 2 then D2=NO_GO in a later round: HF1 still stands, entries stay bound to their round', () => {
  const outs = fx.goldOutputs(SEED, items);
  outs[1] = fx.mutateOutputs(SEED, items, 'D2', 'action', 'GO')[1];
  const gold = fx.goldOutputs(SEED, items);
  // round 5 re-submits D2 correctly
  const r5 = JSON.parse(/```json\n([\s\S]*?)```/.exec(gold[4])[1]);
  r5.decisions.push({ msg: 'D2', action: 'NO_GO', to: '', text: 'later correction' });
  outs[4] = `\`\`\`json\n${JSON.stringify(r5)}\n\`\`\`\nx`;
  const ex = lib.parseExaminee(outs);
  assert.ok(lib.mechHardFails(items, ex).includes('HF1'), 'HF1 must stand');
  const rounds = ex.entries.filter((e) => e.msg === 'D2').map((e) => [e.round, e.action]);
  assert.deepStrictEqual(rounds, [[2, 'GO'], [5, 'NO_GO']]);
});

test('same for claims: C3=ACCEPT then C3=REJECT later still shows HF7', () => {
  const outs = fx.mutateOutputs(SEED, items, 'C3', 'verdict', 'ACCEPT');
  const r5 = { order: [], decisions: [], claims: [{ id: 'C3', verdict: 'REJECT' }] };
  outs[4] = `\`\`\`json\n${JSON.stringify(r5)}\n\`\`\`\nx`;
  assert.ok(lib.mechHardFails(items, lib.parseExaminee(outs)).includes('HF7'));
});
