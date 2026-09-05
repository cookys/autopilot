/**
 * Tests for scripts/lib/review-chain-derive.js — the shared re-derivation routine behind
 * hetero-review-loop finalize and check-phase-review-receipt.
 * Run: node --test scripts/lib/review-chain-derive.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const deriveReceiptState = require(path.join(__dirname, 'review-chain-derive.js'));

const F1 = { id: 'F1', severity: 'Major', seat: 's0', text: 'unchecked null' };
const C1 = { id: 'C1', severity: 'Critical', seat: 's0', text: 'auth bypass' };
const verified = (id) => ({ id, disposition: 'verified' });

test('baseline: a verified Major finding stays open when the chain ends on its generation', () => {
  const chain = [{ generation: 1, status: 'finalized' }];
  const r = deriveReceiptState(chain, new Map([[1, [F1]]]), new Map([[1, [verified('F1')]]]));
  // Only a verified Critical flips the verdict; an open Major rides in open_findings.
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.deepStrictEqual(r.open_findings.map((f) => f.id), ['F1']);
});

test('baseline: a later finalized generation that no longer reports the finding closes it (closure by absence)', () => {
  const chain = [{ generation: 1, status: 'finalized' }, { generation: 2, status: 'finalized' }];
  const r = deriveReceiptState(chain, new Map([[1, [F1]], [2, []]]), new Map([[1, [verified('F1')]], [2, []]]));
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.deepStrictEqual(r.closed_findings.map((f) => [f.id, f.closed_by_generation]), [['F1', 2]]);
});

test('v2.36.3: an ABORTED generation closes nothing — the open finding survives it (was: closed by absence)', () => {
  // 7840hs report 2026-09-05: hetero-review-loop finalize and check-phase-review-receipt both
  // fed the aborted generation's (non-existent ⇒ empty) findings into this routine, so an abort
  // — branch moved during collection, or a seat's findings failed to parse — silently closed
  // every open verified finding. An abort reviewed nothing and must contribute nothing.
  const chain = [{ generation: 1, status: 'finalized' }, { generation: 2, status: 'aborted' }];
  const r = deriveReceiptState(chain, new Map([[1, [F1]]]), new Map([[1, [verified('F1')]]]));
  assert.deepStrictEqual(r.open_findings.map((f) => f.id), ['F1']);
  assert.deepStrictEqual(r.closed_findings, []);
  assert.strictEqual(chain[0].closed_findings, undefined, 'no closed_findings may be stamped onto g1 by an aborted g2');
});

test('v2.36.3: an ABORTED generation cannot flip a verified Critical into SHIP-AS-IS', () => {
  const chain = [{ generation: 1, status: 'finalized' }, { generation: 2, status: 'aborted' }];
  const r = deriveReceiptState(chain, new Map([[1, [C1]]]), new Map([[1, [verified('C1')]]]));
  assert.strictEqual(r.verdict, 'FIX-THEN-SHIP', 'an abort must not flip the verdict');
  assert.deepStrictEqual(r.closed_findings, []);
});

test('v2.36.3: finalized / aborted / finalized — the closure is attributed to the finalized successor, not the abort', () => {
  const chain = [
    { generation: 1, status: 'finalized' },
    { generation: 2, status: 'aborted', reason: 'parse_failed' },
    { generation: 3, status: 'finalized' },
  ];
  const r = deriveReceiptState(chain, new Map([[1, [F1]], [3, []]]), new Map([[1, [verified('F1')]], [3, []]]));
  assert.strictEqual(r.verdict, 'SHIP-AS-IS');
  assert.deepStrictEqual(r.closed_findings.map((f) => [f.id, f.closed_by_generation]), [['F1', 3]]);
  assert.deepStrictEqual(chain[0].closed_findings, [{ id: 'F1', closed_by_generation: 3 }]);
  assert.strictEqual(chain[1].closed_findings, undefined, 'the aborted record is never stamped with closed_findings');
});
