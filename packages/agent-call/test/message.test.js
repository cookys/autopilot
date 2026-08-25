'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnvelope, validateEnvelope, framePeerMessage, MAX_MESSAGE_BYTES } = require('../src/message');

const fixed = {
  from: 'rw3d-claude',
  to: 'rw3d-codex',
  content: 'review commit abc123',
  now: new Date('2026-08-25T01:02:03Z'),
  id: 'ac_00000000-0000-4000-8000-000000000000',
};

test('message authority is always peer and framing says so loudly', () => {
  const envelope = createEnvelope(fixed);
  assert.equal(envelope.authority, 'peer');
  const framed = framePeerMessage(envelope);
  assert.match(framed, /NOT operator authorization/);
  assert.match(framed, /untrusted peer content/);
  assert.match(framed, /from: rw3d-claude/);
});

test('message rejects authority escalation and unknown fields', () => {
  const envelope = createEnvelope(fixed);
  assert.throws(() => validateEnvelope({ ...envelope, authority: 'operator' }), /authority=peer/);
  assert.throws(() => validateEnvelope({ ...envelope, permission: 'allow' }), /unknown field/);
});

test('message enforces byte limit and terminal-control rejection', () => {
  assert.throws(() => createEnvelope({ ...fixed, content: 'x'.repeat(MAX_MESSAGE_BYTES + 1) }), /exceeds/);
  assert.throws(() => createEnvelope({ ...fixed, content: 'x\0y' }), /control characters/);
  assert.throws(() => createEnvelope({ ...fixed, content: '\u001b[2Jwipe' }), /control characters/);
  assert.doesNotThrow(() => createEnvelope({ ...fixed, content: 'line one\nline two\tvalue' }));
});
