#!/usr/bin/env node
'use strict';
// `claude-account.js set-default <alias>` / `set-default --restore <backup>`: make an alias the host default that
// `run --pin-default` resolves (priority = lowest other enabled priority - 1), back up first, restore byte for byte.
// Tempdir only, FAKE- tokens, Node shim only (the shim PATH is the sentinel: no real claude is reachable).
//   1 unknown alias: exit 2, registry bytes unchanged, no backup
//   2 disabled alias: exit 2, registry bytes unchanged, no backup
//   3 set-default B: run --pin-default spawns B; only B's priority differs; modes 0600; --restore is byte-identical
//   4 already strictly lowest: nothing written, no backup
//   5 a tie is broken by a strictly lower number; a disabled lower row does not count
//   6 restore refuses a path outside the accounts dir or with a wrong name
//   7 a registry that is not exactly JSON.stringify(doc) + newline (no newline, pretty-printed) is refused, nothing written
//   8 the registry is read ONCE (a swap between two reads cannot mix snapshots)
//   9 restore refuses a symlinked accounts dir and a too-open accounts dir
//  10 the new priority must be strictly below every other enabled row (float floor) or nothing is written
//  11 restore refuses a symlinked backup and a backup that fails validation
//  12 restore is verbatim: a non-canonical (pretty, reordered keys) backup comes back byte for byte
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeFixture, readLog } = require('./lib/account-fixtures/shim-install');
const registry = require('./lib/account-registry');

const ACCT = path.join(__dirname, 'claude-account.js');

function acct(fx, args) {
  const r = spawnSync('node', [ACCT, ...args], { env: fx.env, encoding: 'utf8', input: '', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
// The fixture writes the registry without a trailing newline; the real writers add one, and set-default requires it.
function canon(fx) { fs.writeFileSync(fx.regFile, fs.readFileSync(fx.regFile, 'utf8') + '\n', { mode: 0o600 }); }
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
    canon(fx);
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
    canon(fx);
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
    canon(fx);
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

test('set-default refuses a registry that is not exactly JSON.stringify(doc) + newline', () => {
  for (const variant of ['nonl', 'pretty']) {
    const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
    try {
      if (variant === 'pretty') fs.writeFileSync(fx.regFile, JSON.stringify(JSON.parse(fs.readFileSync(fx.regFile, 'utf8')), null, 2) + '\n', { mode: 0o600 });
      const before = fs.readFileSync(fx.regFile);
      const r = acct(fx, ['set-default', 'b']);
      assert.equal(r.rc, 2, `${variant}: ${r.out}`);
      assert.match(r.out, /registry_format_noncanonical/);
      assert.ok(before.equals(fs.readFileSync(fx.regFile)));
      assert.deepEqual(backups(fx), []);
    } finally { fx.cleanup(); }
  }
});

test('set-default reads the registry once: a swap after the first open cannot mix snapshots', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }, { alias: 'c', priority: 30 }] });
  try {
    canon(fx);
    const original = JSON.parse(fs.readFileSync(fx.regFile, 'utf8'));
    let opens = 0;
    const swapped = JSON.stringify({ schema: 'autopilot.accounts/1', accounts: [{ alias: 'a', enabled: true, priority: 10 }, { alias: 'c', enabled: true, priority: 9 }] }) + '\n';
    const hooks = {
      env: fx.env, realHome: fx.realHome,
      afterFstat: (file, what) => {
        if (what !== 'registry') return;
        opens++;
        if (opens === 1) { const t = file + '.swap'; fs.writeFileSync(t, swapped, { mode: 0o600 }); fs.renameSync(t, file); }
      },
    };
    const r = registry.setDefault('b', hooks);
    assert.equal(opens, 1, 'registry opened exactly once');
    assert.equal(r.changed, true);
    const rows = JSON.parse(fs.readFileSync(fx.regFile, 'utf8')).accounts;
    const want = original.accounts.map((x) => (x.alias === 'b' ? Object.assign({}, x, { priority: 9 }) : x));
    assert.deepEqual(rows, want);
  } finally { fx.cleanup(); }
});

test('restore refuses a symlinked accounts dir and a too-open accounts dir', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  try {
    canon(fx);
    const bk = path.join(fx.accountsDir, 'registry.json.bak.5');
    fs.writeFileSync(bk, fs.readFileSync(fx.regFile), { mode: 0o600 });
    fs.writeFileSync(fx.regFile, fs.readFileSync(fx.regFile, 'utf8').replace('"priority":10', '"priority":11'), { mode: 0o600 });
    const before = fs.readFileSync(fx.regFile);
    const link = path.join(fx.root, 'acclink');
    fs.symlinkSync(fx.accountsDir, link);
    const env = Object.assign({}, fx.env, { AUTOPILOT_ACCOUNTS_DIR: link });
    const r = spawnSync('node', [ACCT, 'set-default', '--restore', path.join(link, 'registry.json.bak.5')], { env, encoding: 'utf8', input: '' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
    fs.chmodSync(fx.accountsDir, 0o755);
    const r2 = acct(fx, ['set-default', '--restore', bk]);
    assert.equal(r2.rc, 2, r2.out);
    assert.match(r2.out, /accounts_dir_mode_too_open/);
    fs.chmodSync(fx.accountsDir, 0o700);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
  } finally { fx.cleanup(); }
});

test('set-default refuses when the new priority would not be strictly below every other enabled row', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 5 }, { alias: 'b', priority: -1e308 }] });
  try {
    canon(fx);
    const before = fs.readFileSync(fx.regFile);
    const r = acct(fx, ['set-default', 'a']);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /priority_floor/);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
    assert.deepEqual(backups(fx), []);
  } finally { fx.cleanup(); }
});

test('restore refuses a symlinked backup and a backup that fails validation', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  try {
    canon(fx);
    const before = fs.readFileSync(fx.regFile);
    const real = path.join(fx.root, 'real-backup');
    fs.writeFileSync(real, before, { mode: 0o600 });
    const lnk = path.join(fx.accountsDir, 'registry.json.bak.7');
    fs.symlinkSync(real, lnk);
    const r = acct(fx, ['set-default', '--restore', lnk]);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /backup_is_symlink/);
    const bad = path.join(fx.accountsDir, 'registry.json.bak.8');
    fs.writeFileSync(bad, '{"schema":"autopilot.accounts/1","accounts":[{"alias":"a","enabled":"yes"}]}\n', { mode: 0o600 });
    const r2 = acct(fx, ['set-default', '--restore', bad]);
    assert.equal(r2.rc, 2, r2.out);
    assert.match(r2.out, /enabled_not_boolean/);
    assert.ok(before.equals(fs.readFileSync(fx.regFile)));
  } finally { fx.cleanup(); }
});

test('restore is verbatim: a pretty-printed, key-reordered backup comes back byte for byte', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }] });
  try {
    const odd = '{\n  "accounts": [\n    {"priority": 10, "enabled": true, "alias": "a"},\n    {"priority": 20, "enabled": true, "alias": "b"}\n  ],\n  "schema": "autopilot.accounts/1"\n}\n\n';
    const bk = path.join(fx.accountsDir, 'registry.json.bak.9');
    fs.writeFileSync(bk, odd, { mode: 0o600 });
    assert.notEqual(JSON.stringify(JSON.parse(odd)) + '\n', odd, 'fixture is not canonical by accident');
    const r = acct(fx, ['set-default', '--restore', bk]);
    assert.equal(r.rc, 0, r.out);
    assert.ok(Buffer.from(odd).equals(fs.readFileSync(fx.regFile)));
    assert.equal(mode(fx.regFile), 0o600);
  } finally { fx.cleanup(); }
});
