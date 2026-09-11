/**
 * Tests for scripts/lib/effort-scale.js.
 *
 * The interesting property is not arithmetic — every scale is identity today — it is the
 * DISCIPLINE: no row may claim a differentiated ranking without provenance, and an unknown
 * family must fall back to identity rather than borrowing another vendor's table. A future
 * measured sweep will change the numbers; these assertions are what stop someone filling the
 * table in with plausible-looking coefficients instead.
 *
 * Run: node --test scripts/lib/effort-scale.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  EFFORT_ORDER, IDENTITY, UNKNOWN_RANK, FAMILY_SCALES,
  normalizeEffort, notesFor, isDifferentiated,
} = require('./effort-scale.js');

test('identity ranking is strictly increasing across the shipped effort order', () => {
  const ranks = EFFORT_ORDER.map((e) => IDENTITY[e]);
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] > ranks[i - 1], `${EFFORT_ORDER[i]} must outrank ${EFFORT_ORDER[i - 1]}`);
  }
});

test('every family row carries provenance', () => {
  for (const [family, row] of Object.entries(FAMILY_SCALES)) {
    assert.ok(row.evidence, `${family} has no evidence block`);
    assert.ok(row.evidence.status, `${family} evidence has no status`);
    assert.ok(row.evidence.url, `${family} evidence has no url`);
    assert.match(row.evidence.read_at, /^\d{4}-\d{2}-\d{2}$/, `${family} evidence has no read date`);
  }
});

test('a differentiated scale is only allowed with a measurement behind it', () => {
  for (const [family, row] of Object.entries(FAMILY_SCALES)) {
    const differs = EFFORT_ORDER.some((e) => row.scale[e] !== IDENTITY[e]);
    if (differs) {
      assert.equal(row.evidence.status, 'measured',
        `${family} ships a non-identity scale, which requires evidence.status "measured"`);
    }
  }
});

test('nothing claims to be measured yet', () => {
  // If this ever fails, a sweep landed — good. Update it deliberately, with the run behind it.
  for (const family of Object.keys(FAMILY_SCALES)) {
    assert.equal(isDifferentiated(family), false, `${family} claims measurement`);
  }
});

test('an unknown family falls back to identity, never to another vendor table', () => {
  for (const e of EFFORT_ORDER) {
    assert.equal(normalizeEffort('no-such-family', e), IDENTITY[e]);
    assert.equal(normalizeEffort(undefined, e), IDENTITY[e]);
    assert.equal(normalizeEffort('unknown', e), IDENTITY[e]);
  }
});

test('an unknown effort label ranks last instead of throwing', () => {
  assert.equal(normalizeEffort('openai', 'turbo'), UNKNOWN_RANK);
  assert.equal(normalizeEffort('anthropic', ''), UNKNOWN_RANK);
  assert.equal(normalizeEffort('anthropic', undefined), UNKNOWN_RANK);
});

test('known families rank identically to each other while undifferentiated', () => {
  // This is the honest state of the evidence, and the ladder's decorrelation rule is built to
  // work without a cross-vendor scale precisely because of it.
  for (const e of EFFORT_ORDER) {
    assert.equal(normalizeEffort('anthropic', e), normalizeEffort('openai', e));
  }
});

test('documented per-family facts exist but are separate from ranking', () => {
  assert.match(notesFor('anthropic'), /search/i);
  assert.match(notesFor('openai'), /search/i);
  assert.equal(notesFor('no-such-family'), null);
  // The note must not have leaked into the ranking.
  assert.equal(normalizeEffort('anthropic', 'low'), IDENTITY.low);
});
