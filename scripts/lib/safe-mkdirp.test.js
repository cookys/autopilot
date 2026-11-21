'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mkdirp } = require('./safe-mkdirp');

test('mkdirp throws within 100ms on /proc/x/y', () => {
  const start = Date.now();
  assert.throws(() => mkdirp('/proc/x/y'));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 100, `expected < 100ms, got ${elapsed}ms`);
});

test('mkdirp creates nested temp path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-mkdirp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nested = path.join(root, 'a', 'b', 'c');
  mkdirp(nested);
  assert.ok(fs.statSync(nested).isDirectory());
  // Calling again on existing directory succeeds
  mkdirp(nested);
});

test('mkdirp throws ENOTDIR when an existing file is in the path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-mkdirp-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'blocker');
  fs.writeFileSync(file, 'hi');
  assert.throws(
    () => mkdirp(path.join(file, 'child')),
    (err) => err && err.code === 'ENOTDIR'
  );
});
