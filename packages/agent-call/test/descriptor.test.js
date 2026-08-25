'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDescriptor, validateDescriptor } = require('../src/descriptor');

function tmuxDescriptor(overrides = {}) {
  return makeDescriptor({
    name: 'rw3d-codex',
    harness: 'codex',
    pid: process.pid,
    cwd: process.cwd(),
    ingress: { kind: 'tmux', pane: '%17' },
    capabilities: { context_injection: true, wake_idle: true, console_read: true },
    now: new Date('2026-08-25T00:00:00Z'),
    ...overrides,
  });
}

test('makeDescriptor emits a closed, normalized v1 descriptor', () => {
  const value = tmuxDescriptor();
  assert.equal(value.schema, 'agent-call.session.v1');
  assert.equal(value.name, 'rw3d-codex');
  assert.equal(value.ingress.pane, '%17');
  assert.equal(value.registered_at, '2026-08-25T00:00:00.000Z');
});

test('descriptor rejects unknown fields and unsafe paths', () => {
  const value = tmuxDescriptor();
  assert.throws(() => validateDescriptor({ ...value, operator: true }), /unknown field/);
  assert.throws(() => makeDescriptor({ ...value, cwd: 'relative' }), /absolute path/);
});

test('descriptor rejects malformed tmux target and channel endpoint', () => {
  assert.throws(() => tmuxDescriptor({ ingress: { kind: 'tmux', pane: 'bad pane' } }), /pane is invalid/);
  assert.throws(() => tmuxDescriptor({ ingress: { kind: 'claude-channel', socket: 'relative', token_path: '/tmp/token' } }), /absolute path/);
});
