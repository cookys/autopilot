'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryStream } = require('./helpers');
const { runCli } = require('../src/cli');
const { makeDescriptor } = require('../src/descriptor');

function fakeRegistry() {
  const entries = new Map();
  return {
    list: () => [...entries.values()],
    require: (name) => {
      if (!entries.has(name)) throw Object.assign(new Error(`offline ${name}`), { code: 'target_offline', exitCode: 1 });
      return entries.get(name);
    },
    register: (value) => { entries.set(value.name, value); },
    unregister: (name) => entries.delete(name),
    entries,
  };
}

test('CLI attaches, lists and sends through the selected adapter', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const registry = fakeRegistry();
  const deliveries = [];
  const tmux = { inspectPane: () => ({ pane_id: '%1', pid: process.pid, cwd: process.cwd(), command: 'codex' }) };
  const adapters = {
    tmux: {
      async deliver(descriptor, envelope) { deliveries.push({ descriptor, envelope }); return { status: 'injected_unverified' }; },
      read() { return { content: 'x' }; },
      doctor() { return { ok: true }; },
    },
  };
  assert.equal(await runCli(['attach', '--name', 'rw3d-codex', '--harness', 'codex', '--tmux-pane', '%1'], { stdout, stderr, registry, adapters, tmux }), 0);
  assert.equal(await runCli(['send', 'rw3d-codex', 'hello', '--json'], {
    stdout, stderr, registry, adapters, tmux,
    env: { ...process.env, AGENT_CALL_NAME: 'rw3d-claude' },
  }), 0);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].envelope.authority, 'peer');
  assert.equal(deliveries[0].envelope.from, 'rw3d-claude');
});

test('CLI receive is the stable future Hangar edge boundary', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const registry = fakeRegistry();
  registry.register(makeDescriptor({
    name: 'rw3d-codex', harness: 'codex', pid: process.pid, cwd: process.cwd(),
    ingress: { kind: 'tmux', pane: '%1' },
    capabilities: { context_injection: true, wake_idle: true, console_read: true },
  }));
  let received;
  const adapters = { tmux: { async deliver(_descriptor, envelope) { received = envelope; return { status: 'injected_unverified' }; } } };
  const payload = JSON.stringify({
    schema: 'agent-call.message.v1',
    id: 'ac_00000000-0000-4000-8000-000000000000',
    from: 'cuda-rw3d-claude', to: 'rw3d-codex', authority: 'peer', origin: 'hangar-edge',
    content: 'remote hello', sent_at: '2026-08-25T00:00:00.000Z',
  });
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(os.tmpdir(), `agent-call-stdin-${process.pid}-${Date.now()}`);
  fs.writeFileSync(file, payload);
  const fd = fs.openSync(file, 'r');
  try {
    assert.equal(await runCli(['receive', '--stdin', '--json'], { stdout, stderr, registry, adapters, stdinFd: fd }), 0);
  } finally {
    fs.closeSync(fd); fs.unlinkSync(file);
  }
  assert.equal(received.origin, 'hangar-edge');
  assert.equal(received.authority, 'peer');
});


test('CLI receive rejects a non-Hangar origin', async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const registry = fakeRegistry();
  const payload = JSON.stringify({
    schema: 'agent-call.message.v1',
    id: 'ac_00000000-0000-4000-8000-000000000000',
    from: 'rw3d-claude', to: 'rw3d-codex', authority: 'peer', origin: 'local-cli',
    content: 'not remote', sent_at: '2026-08-25T00:00:00.000Z',
  });
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(os.tmpdir(), `agent-call-stdin-invalid-${process.pid}-${Date.now()}`);
  fs.writeFileSync(file, payload);
  const fd = fs.openSync(file, 'r');
  try {
    assert.equal(await runCli(['receive', '--stdin', '--json'], {
      stdout, stderr, registry, adapters: {}, stdinFd: fd,
    }), 2);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(file);
  }
  assert.match(stdout.text(), /origin_invalid/);
});
