'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempEnv } = require('./helpers');
const { ensurePrivateDirectory, ensureRuntimeLayout, writePrivateFileAtomic, readPrivateFile } = require('../src/runtime');
const { Registry } = require('../src/registry');
const { makeDescriptor } = require('../src/descriptor');

function descriptor(name = 'peer', pid = process.pid) {
  return makeDescriptor({
    name,
    harness: 'codex',
    pid,
    cwd: process.cwd(),
    ingress: { kind: 'tmux', pane: '%1' },
    capabilities: { context_injection: true, wake_idle: true, console_read: true },
  });
}

test('runtime creates private directories and atomic private files', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const layout = ensureRuntimeLayout(fixture.env);
  assert.equal(fs.statSync(layout.root).mode & 0o777, 0o700);
  const file = path.join(layout.root, 'secret');
  writePrivateFileAtomic(file, 'value');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readPrivateFile(file), 'value');
});

test('runtime refuses a symlink before chmod follows it', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const victim = path.join(fixture.base, 'victim');
  fs.mkdirSync(victim, { mode: 0o755 });
  const link = path.join(fixture.base, 'link');
  fs.symlinkSync(victim, link);
  assert.throws(() => ensurePrivateDirectory(link), /not a real directory/);
  assert.equal(fs.statSync(victim).mode & 0o777, 0o755);
});

test('registry rejects live duplicate and prunes a stale pid', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const live = new Registry({ env: fixture.env, pidAlive: (pid) => pid === 10 });
  live.register(descriptor('peer', 10));
  assert.throws(() => live.register(descriptor('peer', 10)), /already registered/);
  const stale = new Registry({ env: fixture.env, layout: live.layout, pidAlive: () => false });
  assert.equal(stale.read('peer'), null);
  assert.deepEqual(stale.list(), []);
});

test('registry quarantines a corrupt descriptor rather than trusting it', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const registry = new Registry({ env: fixture.env, pidAlive: () => true });
  const file = registry.descriptorPath('bad');
  writePrivateFileAtomic(file, '{broken');
  assert.throws(() => registry.read('bad'), /quarantined/);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.readdirSync(registry.layout.agents).some((name) => name.startsWith('bad.json.invalid-')));
});
