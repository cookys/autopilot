'use strict';
// generator determinism: same seed byte-identical; different seed same structure, different names.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('../lib');
const fx = require('../fixtures');

const items = lib.loadItems();
const GEN = path.join(__dirname, '..', 'generate.js');

// replace every derived name by its token so two seeds can be compared structurally
function tokenize(text, map) {
  return Object.keys(map).sort((a, b) => map[b].length - map[a].length)
    .reduce((s, k) => s.split(map[k]).join(`{{${k}}}`), text);
}

test('same seed gives byte-identical prompts for every round', () => {
  const outs = fx.goldOutputs('seed-a', items);
  for (let r = 1; r <= 6; r += 1) {
    assert.strictEqual(lib.buildPrompt(items, 'seed-a', r, outs), lib.buildPrompt(items, 'seed-a', r, outs));
  }
});

test('CLI output is byte-identical across two processes', () => {
  const run = () => spawnSync(process.execPath, [GEN, '--seed', 'seed-a', '--round', '1'], { encoding: 'utf8' });
  const a = run(); const b = run();
  assert.strictEqual(a.status, 0);
  assert.strictEqual(a.stdout, b.stdout);
  assert.ok(a.stdout.includes('PM-1'));
});

test('different seed: same structure, different names', () => {
  const mapA = lib.deriveNames(items, 'seed-a');
  const mapB = lib.deriveNames(items, 'seed-b');
  assert.notDeepStrictEqual(mapA, mapB);
  for (const k of items.names.cards.concat(items.names.shas)) assert.notStrictEqual(mapA[k], mapB[k], k);
  const outsA = fx.goldOutputs('seed-a', items);
  const outsB = fx.goldOutputs('seed-b', items);
  for (let r = 1; r <= 6; r += 1) {
    const a = tokenize(lib.buildPrompt(items, 'seed-a', r, outsA), mapA);
    const b = tokenize(lib.buildPrompt(items, 'seed-b', r, outsB), mapB);
    assert.strictEqual(a, b, `round ${r} structure differs`);
    assert.notStrictEqual(lib.buildPrompt(items, 'seed-a', r, outsA), lib.buildPrompt(items, 'seed-b', r, outsB));
  }
});

test('round N carries rounds 1..N-1 with the examinee own outputs, and nothing from later rounds', () => {
  const outs = ['OUT-ONE', 'OUT-TWO'];
  const p = lib.buildPrompt(items, 'seed-a', 3, outs);
  assert.ok(p.indexOf('OUT-ONE') !== -1 && p.indexOf('OUT-TWO') !== -1);
  assert.ok(p.indexOf('## 第 1 輪') < p.indexOf('OUT-ONE') && p.indexOf('OUT-ONE') < p.indexOf('## 第 2 輪'));
  assert.ok(p.includes('## 第 3 輪') && !p.includes('## 第 4 輪'));
  assert.throws(() => lib.buildPrompt(items, 'seed-a', 3, ['only-one']), /missing output for round 2/);
});

test('the examinee prompt never carries expected answers or deduction text', () => {
  const p = lib.buildPrompt(items, 'seed-a', 6, fx.goldOutputs('seed-a', items));
  for (const it of items.items) assert.ok(!p.includes(lib.subst(it.expected, lib.deriveNames(items, 'seed-a'))), it.id);
  assert.ok(!/GL:\d|PM:\d|HF\d/.test(p));
});
