'use strict';
// Tests for account-cooldown.js (N7 cooldown half). Run: node --test scripts/lib/account-cooldown.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cd = require('./account-cooldown');
const { pick } = require('./account-pick');

const NOW = 1_800_000_000_000;
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'acctcd-')); }

test('computeUntil: earliest future tight reset, else default minutes', () => {
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, tightResets: [NOW / 1000 + 600, NOW / 1000 + 60] }), NOW + 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, tightResets: [NOW / 1000 - 5] }), NOW + 30 * 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW }), NOW + 30 * 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, defaultMinutes: 5 }), NOW + 5 * 60_000);
});

test('write then read round trip, 0600 file in 0700 dir', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    cd.writeCooldown('main', NOW + 1000, { dir, nowMs: NOW });
    assert.strictEqual(cd.readCooldown('main', { dir }), NOW + 1000);
    assert.strictEqual(fs.statSync(path.join(dir, 'main.json')).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    const body = fs.readFileSync(path.join(dir, 'main.json'), 'utf8');
    assert.deepStrictEqual(Object.keys(JSON.parse(body)).sort(), ['alias', 'cooldown_until_ms', 'schema', 'written_at_ms']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bad alias, corrupt and foreign-schema files', () => {
  const root = tmp();
  try {
    assert.throws(() => cd.writeCooldown('../x', NOW, { dir: root }));
    fs.writeFileSync(path.join(root, 'a.json'), '{bad');
    assert.strictEqual(cd.readCooldown('a', { dir: root }), null);
    fs.writeFileSync(path.join(root, 'b.json'), JSON.stringify({ schema: 'x', alias: 'b', cooldown_until_ms: 1 }));
    assert.strictEqual(cd.readCooldown('b', { dir: root }), null);
    assert.strictEqual(cd.readCooldown('absent', { dir: root }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('N7: after both aliases are cooled, pick skips both until cooldown_until', () => {
  const root = tmp();
  try {
    cd.writeCooldown('a', NOW + 60_000, { dir: root, nowMs: NOW });
    cd.writeCooldown('b', NOW + 120_000, { dir: root, nowMs: NOW });
    const accounts = [{ alias: 'a', priority: 1 }, { alias: 'b', priority: 2 }];
    const cooldowns = cd.readAllCooldowns(['a', 'b'], { dir: root });
    const r = pick({ accounts, cooldowns, nowMs: NOW + 1000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'no_account_available');
    assert.deepStrictEqual(r.dropped.map((d) => d.reason), ['cooldown', 'cooldown']);
    const later = pick({ accounts, cooldowns, nowMs: NOW + 60_000 });
    assert.strictEqual(later.choice.alias, 'a');
    assert.strictEqual(cd.isCooling(NOW + 60_000, NOW + 60_000), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('clearCooldown removes the file', () => {
  const root = tmp();
  try {
    cd.writeCooldown('a', NOW, { dir: root });
    assert.strictEqual(cd.clearCooldown('a', { dir: root }), true);
    assert.strictEqual(cd.readCooldown('a', { dir: root }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
