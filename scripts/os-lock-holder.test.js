#!/usr/bin/env node
'use strict';
// Unit tests for scripts/lib/account-fixtures/os-lock-holder.js — real flock in mkdtemp only.
// Run: node --test scripts/os-lock-holder.test.js < /dev/null

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  holdOsLock,
  isHeld,
  installLeakCheck,
  findTool,
} = require('./lib/account-fixtures/os-lock-holder');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'os-lock-holder-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
installLeakCheck(after);

test('findTool: resolves flock or perl from PATH', () => {
  const flock = findTool('flock');
  const perl = findTool('perl');
  assert.ok(flock || perl, 'need flock or perl for os-lock tests on this host');
  if (flock) assert.ok(fs.existsSync(flock));
  if (perl) assert.ok(fs.existsSync(perl));
});

test('findTool: returns null when name absent from an empty PATH', () => {
  const prev = process.env.PATH;
  process.env.PATH = path.join(TMP, 'empty-path-dir');
  try {
    assert.equal(findTool('definitely-not-on-path-flock-xyz'), null);
  } finally {
    if (prev === undefined) delete process.env.PATH;
    else process.env.PATH = prev;
  }
});

test('isHeld: false on a fresh lock file, true while holder runs', () => {
  const lock = path.join(TMP, `lock-${Math.random().toString(36).slice(2)}.oslock`);
  assert.equal(isHeld(lock), false);
  const h = holdOsLock(lock);
  assert.equal(isHeld(lock), true);
  h.release();
  assert.equal(isHeld(lock), false);
});

test('holdOsLock: second holder on same path throws', () => {
  const lock = path.join(TMP, `busy-${Math.random().toString(36).slice(2)}.oslock`);
  const h1 = holdOsLock(lock);
  assert.throws(() => holdOsLock(lock), /could not take/);
  h1.release();
});

test('holdOsLock: release frees lock for a new holder', () => {
  const lock = path.join(TMP, `reacquire-${Math.random().toString(36).slice(2)}.oslock`);
  const h1 = holdOsLock(lock);
  h1.release();
  const h2 = holdOsLock(lock);
  assert.equal(isHeld(lock), true);
  h2.release();
});