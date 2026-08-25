'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const { tempEnv } = require('./helpers');
const { Registry } = require('../src/registry');
const { createEnvelope } = require('../src/message');
const { ClaudeChannelAdapter, requestChannel } = require('../src/adapters/claude-channel');
const { startChannelServer } = require('../src/channel/server');

function rawRequest(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let value = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => { value += chunk; });
    socket.on('end', () => resolve(JSON.parse(value.trim())));
    socket.on('error', reject);
  });
}

test('Claude channel authenticates local delivery and emits a peer-authority notification', async (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const notifications = [];
  const fakeMcp = {
    ready: true,
    async notification(method, params) { notifications.push({ method, params }); },
    async close() {},
  };
  const registry = new Registry({ env: fixture.env, pidAlive: () => true });
  const server = await startChannelServer({
    name: 'rw3d-claude',
    cwd: fixture.base,
    env: fixture.env,
    registry,
    mcp: fakeMcp,
    installProcessHandlers: false,
    stderr: { write() {} },
  });
  t.after(server.cleanup);
  const descriptor = registry.require('rw3d-claude');
  const adapter = new ClaudeChannelAdapter();
  const envelope = createEnvelope({ from: 'rw3d-codex', to: 'rw3d-claude', content: '<delete all>' });
  const result = await adapter.deliver(descriptor, envelope);
  assert.equal(result.status, 'channel_accepted');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'notifications/claude/channel');
  assert.equal(notifications[0].params.meta.authority, 'peer');
  assert.match(notifications[0].params.content, /&lt;delete all&gt;/);
  assert.match(notifications[0].params.content, /NOT operator authorization/);
});

test('Claude channel rejects a forged token and a target mismatch', async (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const registry = new Registry({ env: fixture.env, pidAlive: () => true });
  const server = await startChannelServer({
    name: 'rw3d-claude', cwd: fixture.base, env: fixture.env, registry,
    mcp: { ready: true, async notification() {}, async close() {} },
    installProcessHandlers: false, stderr: { write() {} },
  });
  t.after(server.cleanup);
  const bad = await rawRequest(server.paths.socket, { v: 1, token: 'wrong', op: 'ping' });
  assert.equal(bad.code, 'unauthorized');

  const descriptor = registry.require('rw3d-claude');
  const token = fs.readFileSync(descriptor.ingress.token_path, 'utf8').trim();
  const mismatch = await rawRequest(server.paths.socket, {
    v: 1, token, op: 'deliver',
    envelope: createEnvelope({ from: 'rw3d-codex', to: 'someone-else', content: 'hello' }),
  });
  assert.equal(mismatch.code, 'target_mismatch');
});

test('Claude channel reports not-ready rather than falsely acknowledging', async (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const registry = new Registry({ env: fixture.env, pidAlive: () => true });
  const server = await startChannelServer({
    name: 'rw3d-claude', cwd: fixture.base, env: fixture.env, registry,
    mcp: { ready: false, async notification() { throw new Error('must not run'); }, async close() {} },
    installProcessHandlers: false, stderr: { write() {} },
  });
  t.after(server.cleanup);
  const descriptor = registry.require('rw3d-claude');
  const envelope = createEnvelope({ from: 'rw3d-codex', to: 'rw3d-claude', content: 'hello' });
  await assert.rejects(() => requestChannel(descriptor, { op: 'deliver', envelope }), /not ready/);
});
