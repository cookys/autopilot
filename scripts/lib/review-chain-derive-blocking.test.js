/**
 * Verdict rule of scripts/lib/review-chain-derive.js: an open verified finding at Major or above
 * means FIX-THEN-SHIP (confirmed, awaiting its fix). Shapes mirror four real generations:
 *   permwatch / staleconf / rtchat: verified Majors plus refuted/deferred rest -> must be FIX-THEN-SHIP
 *   e2fix: a verified Critical among others -> FIX-THEN-SHIP
 *   resolved generation (negative control): everything refuted, or a later resolution closes the Major -> SHIP-AS-IS
 * Data is fake (ids and text invented), only the shape is the same.
 * Run: node --test scripts/lib/review-chain-derive-blocking.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const derive = require(path.join(__dirname, 'review-chain-derive.js'));

const fnd = (id, severity) => ({ id, severity, seat: 's0', text: `fake finding ${id}` });
const disp = (id, disposition) => ({ id, disposition, rationale: 'fake rationale' });
const one = (findings, disps) => derive([{ generation: 1, status: 'finalized' }], new Map([[1, findings]]), new Map([[1, disps]]));

test('permwatch shape: verified Majors + refuted + deferred Suggestion -> FIX-THEN-SHIP, open 3', () => {
  const f = [fnd('a1', 'Major'), fnd('a2', 'Major'), fnd('a3', 'Major'), fnd('a4', 'Major'), fnd('a5', 'Suggestion'), fnd('a6', 'Major')];
  const d = [disp('a1', 'refuted'), disp('a2', 'verified'), disp('a3', 'verified'), disp('a4', 'refuted'), disp('a5', 'deferred'), disp('a6', 'verified')];
  const r = one(f, d);
  assert.strictEqual(r.verdict, 'FIX-THEN-SHIP');
  assert.strictEqual(r.open_findings.length, 3);
});

test('staleconf shape: three verified Majors and nothing else -> FIX-THEN-SHIP', () => {
  const r = one([fnd('b1', 'Major'), fnd('b2', 'Major'), fnd('b3', 'Major')], [disp('b1', 'verified'), disp('b2', 'verified'), disp('b3', 'verified')]);
  assert.strictEqual(r.verdict, 'FIX-THEN-SHIP');
  assert.strictEqual(r.open_findings.length, 3);
});

test('e2fix shape: a verified Critical among verified Majors stays FIX-THEN-SHIP', () => {
  const r = one([fnd('c1', 'Critical'), fnd('c2', 'Major')], [disp('c1', 'verified'), disp('c2', 'verified')]);
  assert.strictEqual(r.verdict, 'FIX-THEN-SHIP');
});

test('negative control: a generation with every finding refuted or deferred is SHIP-AS-IS', () => {
  const r = one([fnd('d1', 'Major'), fnd('d2', 'Suggestion')], [disp('d1', 'refuted'), disp('d2', 'deferred')]);
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.deepStrictEqual(r.open_findings, []);
});

test('negative control: a Major closed by a later generation resolution is SHIP-AS-IS', () => {
  const chain = [{ generation: 1, status: 'finalized' }, { generation: 2, status: 'finalized' }];
  const r = derive(
    chain,
    new Map([[1, [fnd('e1', 'Major')]], [2, []]]),
    new Map([[1, [disp('e1', 'verified')]], [2, { findings: [], resolutions: [{ id: 'e1', rationale: 're-read the fix' }] }]]),
  );
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.deepStrictEqual(r.open_findings, []);
});

test('a verified Minor alone stays open without blocking (finalize --allow-unresolved covers it)', () => {
  const r = one([fnd('f1', 'Minor')], [disp('f1', 'verified')]);
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.strictEqual(r.open_findings.length, 1);
});
