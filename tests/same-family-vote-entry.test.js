'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findSameFamilyVote, planSeatFamily } = require('../scripts/lib/review-family-gate');
const { checkSameFamilySeats } = require('../scripts/review-jury');

test('planSeatFamily + findSameFamilyVote refuses two openai/codex seats and accepts mixed', () => {
  const dupSeats = [
    { id: 'gpt1', runner: 'codex', model: 'gpt-6-astra' },
    { id: 'gpt2', runner: 'codex', model: 'gpt-5.6-sol' },
  ];
  const collision = findSameFamilyVote(dupSeats, planSeatFamily);
  assert.ok(collision);
  assert.equal(collision.family, 'openai');
  assert.equal(collision.first.id, 'gpt1');
  assert.equal(collision.second.id, 'gpt2');

  const mixedSeats = [
    { id: 'gpt1', runner: 'codex', model: 'gpt-6-astra' },
    { id: 'grok1', runner: 'grok', model: 'grok-4.7' },
  ];
  assert.equal(findSameFamilyVote(mixedSeats, planSeatFamily), null);
});

test('review-jury checkSameFamilySeats refuses duplicate family and warns with allowSameFamily', () => {
  const table = {
    gpt1: { family: 'openai' },
    gpt2: { family: 'openai' },
    grok1: { family: 'xai' },
  };
  assert.doesNotThrow(() => checkSameFamilySeats(['gpt1', 'grok1'], table, false));

  let stderr = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    assert.doesNotThrow(() => checkSameFamilySeats(['gpt1', 'gpt2'], table, true));
    assert.match(stderr, /review-jury: warning: same_family_vote: gpt1 and gpt2 \(openai\)/);
  } finally {
    process.stderr.write = origWrite;
  }
});
