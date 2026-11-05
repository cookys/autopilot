#!/usr/bin/env node
'use strict';
// `claude-account.js set-default <alias>` / `set-default --restore <backup>`: make an alias the host default that
// `run --pin-default` resolves (priority = lowest other enabled priority - 1), back up first, restore byte for byte.
// Tempdir only, FAKE- tokens, Node shim only (the shim PATH is the sentinel: no real claude is reachable).
//   1 unknown alias: exit 2, registry bytes unchanged, no backup
//   2 disabled alias: exit 2, registry bytes unchanged, no backup
//   3 set-default B: run --pin-default spawns B; other rows differ from the original only in nothing (B's priority only)
//   4 --restore: registry byte-identical to the original (cmp); backup and registry are 0600
//   5 already strictly lowest: nothing written, no backup
//   6 a disabled row with a lower number does not count; a tie is broken by the new strictly lower number
//   7 negative control: before the fix of an unrelated priority, the original default still wins (B is not default pre-change)
//   8 restore refuses a path outside the accounts dir / wrong name
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeFixture, readLog } = require('./lib/account-fixtures/shim-install');

const ACCT = path.join(__dirname, 'claude-account.js');

function acct(fx, args) {
  const r = spawnSync('node', [ACCT, ...args], { env: fx.env, encoding: 'utf8', input: '', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
function pinRun(fx) {
  return spawnSync('node', [ACCT, 'run', '--purpose', 'setdef', '--pin-default', '--', 'claude', '-p'],
    { env: fx.env, encoding: 'utf8', input: '', timeout: 60000 });
}
const backups = (fx) => fs.readdirSync(fx.accountsDir).filter((n) => n.startsWith('registry.json.bak.'));
const mode = (p) => fs.statSync(p).mode & 0o777;

test('set-default: unknown alias is refused, registry untouched, no backup', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
  try {
    const before = fs.readFileSync(fx.regFile);
    const r = acct(fx, ['set-default', 'nope']);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /alias_not_registered/);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
    assert.deepEqual(backups(fx), []);
  } finally { fx.cleanup(); }
});

test('set-default: disabled alias is refused, registry untouched, no backup', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b', enabled: false }] });
  try {
    const before = fs.readFileSync(fx.regFile);
    const r = acct(fx, ['set-default', 'b']);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /alias_disabled/);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
    assert.deepEqual(backups(fx), []);
  } finally { fx.cleanup(); }
});

test('set-default B: pin-default resolves B, only B priority changed, modes 0600, restore is byte-identical', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }, { alias: 'c', priority: 30 }] });
  try {
    const original = fs.readFileSync(fx.regFile);
    assert.equal(pinRun(fx).status, 0);
    assert.equal(readLog(fx.shim.log)[0].account, 'a'); // negative control: before the change a is the default

    const r = acct(fx, ['set-default', 'b']);
    assert.equal(r.rc, 0, r.out);
    const bk = backups(fx);
    assert.equal(bk.length, 1);
    const bkPath = path.join(fx.accountsDir, bk[0]);
    assert.ok(original.equals(fs.readFileSync(bkPath)), 'backup is the original bytes');
    assert.equal(mode(bkPath), 0o600);
    assert.equal(mode(fx.regFile), 0o600);
    assert.ok(r.stdout.includes(`set-default --restore ${bkPath}`), 'rollback command printed');

    const after = JSON.parse(fs.readFileSync(fx.regFile, 'utf8'));
    const orig = JSON.parse(original.toString('utf8'));
    assert.equal(after.accounts.find((x) => x.alias === 'b').priority, 9);
    for (let i = 0; i < orig.accounts.length; i++) {
      const o = Object.assign({}, orig.accounts[i]);
      const n = Object.assign({}, after.accounts[i]);
      delete o.priority; delete n.priority;
      assert.deepEqual(n, o);
      if (orig.accounts[i].alias !== 'b') assert.equal(after.accounts[i].priority, orig.accounts[i].priority);
    }
    assert.deepEqual(after.accounts.map((x) => x.alias), orig.accounts.map((x) => x.alias));

    fs.rmSync(fx.shim.log, { force: true });
    assert.equal(pinRun(fx).status, 0);
    assert.equal(readLog(fx.shim.log)[0].account, 'b');

    const rr = acct(fx, ['set-default', '--restore', bkPath]);
    assert.equal(rr.rc, 0, rr.out);
    assert.ok(original.equals(fs.readFileSync(fx.regFile)), 'restored registry is byte-identical');
    assert.equal(mode(fx.regFile), 0o600);
  } finally { fx.cleanup(); }
});

test('set-default: already strictly lowest writes nothing', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  try {
    const before = fs.readFileSync(fx.regFile);
    const r = acct(fx, ['set-default', 'a']);
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /default_unchanged/);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
    assert.deepEqual(backups(fx), []);
  } finally { fx.cleanup(); }
});

test('set-default: a tie is broken (strictly lower), a disabled lower row does not count', () => {
  const fx = makeFixture({ aliases: [{ alias: 'x', priority: 1, enabled: false }, { alias: 'a', priority: 10 }, { alias: 'b', priority: 10 }] });
  try {
    assert.equal(acct(fx, ['set-default', 'b']).rc, 0);
    const rows = JSON.parse(fs.readFileSync(fx.regFile, 'utf8')).accounts;
    assert.equal(rows.find((x) => x.alias === 'b').priority, 9);
    assert.equal(rows.find((x) => x.alias === 'x').priority, 1);
    assert.equal(pinRun(fx).status, 0);
    assert.equal(readLog(fx.shim.log)[0].account, 'b');
  } finally { fx.cleanup(); }
});

test('set-default --restore refuses a path outside the accounts dir or with a wrong name', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
  try {
    const before = fs.readFileSync(fx.regFile);
    const stray = path.join(fx.root, 'registry.json.bak.1');
    fs.writeFileSync(stray, before, { mode: 0o600 });
    assert.equal(acct(fx, ['set-default', '--restore', stray]).rc, 2);
    const wrong = path.join(fx.accountsDir, 'other.json');
    fs.writeFileSync(wrong, before, { mode: 0o600 });
    assert.equal(acct(fx, ['set-default', '--restore', wrong]).rc, 2);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
  } finally { fx.cleanup(); }
});
