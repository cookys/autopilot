#!/usr/bin/env node
'use strict';
// G37 P1 tests: N2 (token checks), N3 (alias grammar), N3b (--alias), N4 (credentials in config dir),
// N13 (registry file checks), N13b (probe error is not absence), N17 (realpath isolation).
// Tempdir only, FAKE- tokens, no real home, no network.

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./account-registry.js');

const LIB = path.join(__dirname, 'account-registry.js');

function mk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-reg-'));
  const home = path.join(root, 'fakehome');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const dir = path.join(home, '.config', 'autopilot', 'accounts');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return { root, home, dir };
}
function writeReg(f, accounts, extra) {
  const p = path.join(f.dir, 'registry.json');
  fs.writeFileSync(p, JSON.stringify(Object.assign({ schema: R.SCHEMA, accounts }, extra || {})), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  return p;
}
function mkAlias(f, alias, token) {
  const d = path.join(f.dir, alias);
  fs.mkdirSync(path.join(d, 'claude'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(d, 'home'), { recursive: true, mode: 0o700 });
  const t = path.join(d, 'token');
  fs.writeFileSync(t, token === undefined ? 'FAKE-token-' + alias : token, { mode: 0o600 });
  fs.chmodSync(t, 0o600);
  return d;
}
function good(f) {
  writeReg(f, [{ alias: 'main', enabled: true, priority: 10 }]);
  return mkAlias(f, 'main');
}
const opts = (f, extra) => Object.assign({ realHome: f.home, accountsDir: f.dir, env: {} }, extra || {});
function reason(fn) {
  try { fn(); } catch (e) { return e.reason || 'other:' + e.message; }
  return null;
}
const chk = (f, extra) => reason(() => R.checkRegistry(opts(f, extra)));

test('fixture ok; ENOENT registry means unconfigured', () => {
  const f = mk();
  assert.strictEqual(R.checkRegistry(opts(f)).configured, false);
  good(f);
  const r = R.checkRegistry(opts(f));
  assert.strictEqual(r.configured, true);
  assert.strictEqual(r.enabled[0].alias, 'main');
});

test('N2 token file checks', () => {
  const cases = [
    ['mode 0644', (f, d) => fs.chmodSync(path.join(d, 'token'), 0o644), 'token_mode_too_open'],
    ['symlink', (f, d) => { const t = path.join(d, 'token'); fs.unlinkSync(t); fs.writeFileSync(path.join(f.root, 'real'), 'FAKE-x', { mode: 0o600 }); fs.symlinkSync(path.join(f.root, 'real'), t); }, 'token_is_symlink'],
    ['whitespace', (f, d) => fs.writeFileSync(path.join(d, 'token'), 'FAKE a b'), 'token_whitespace'],
    ['empty', (f, d) => fs.writeFileSync(path.join(d, 'token'), ''), 'token_size_out_of_range'],
    ['newline only', (f, d) => fs.writeFileSync(path.join(d, 'token'), '\n'), 'token_empty'],
    ['too big', (f, d) => fs.writeFileSync(path.join(d, 'token'), 'F'.repeat(5000)), 'token_size_out_of_range'],
    ['missing', (f, d) => fs.unlinkSync(path.join(d, 'token')), 'token_missing'],
  ];
  for (const [name, mut, want] of cases) {
    const f = mk(); const d = good(f);
    mut(f, d);
    assert.strictEqual(chk(f), want, name);
  }
  // wrong owner via injected uid
  const f = mk(); good(f);
  assert.strictEqual(chk(f, { uid: process.getuid() + 1 }), 'registry_foreign_owner');
  // trailing newline accepted
  const g = mk(); const d = good(g);
  fs.writeFileSync(path.join(d, 'token'), 'FAKE-ok\n');
  assert.strictEqual(chk(g), null);
  // token content never appears in the error text
  const h = mk(); const hd = good(h);
  fs.writeFileSync(path.join(hd, 'token'), 'FAKE-SECRET a');
  try { R.checkRegistry(opts(h)); assert.fail(); } catch (e) { assert.ok(!/SECRET/.test(e.message)); }
});

test('N2 token owner check on token file alone', () => {
  // the registry owner check fires first with a uid mismatch, so probe the token check by a uid that matches registry only
  const f = mk(); good(f);
  const real = fs.lstatSync;
  const tokenFile = path.join(f.dir, 'main', 'token');
  fs.lstatSync = (p, ...a) => { const s = real(p, ...a); return p === tokenFile ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: s.uid + 1, isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }) : s; };
  try { assert.strictEqual(chk(f), 'token_foreign_owner'); } finally { fs.lstatSync = real; }
});

test('N2b one broken enabled alias fails the whole check (never skipped)', () => {
  const f = mk();
  writeReg(f, [{ alias: 'a', enabled: true, priority: 1 }, { alias: 'b', enabled: true, priority: 2 }]);
  const da = mkAlias(f, 'a'); mkAlias(f, 'b');
  fs.chmodSync(path.join(da, 'token'), 0o644);
  assert.strictEqual(chk(f), 'token_mode_too_open');
  // a disabled broken alias is parked, not checked
  const g = mk();
  writeReg(g, [{ alias: 'a', enabled: false }, { alias: 'b', enabled: true }]);
  mkAlias(g, 'b');
  assert.strictEqual(chk(g), null);
});

test('N3 reserved/invalid alias', () => {
  const bad = ['Acct-1', 'acct-1a2b3c4d', 'codex-1a2b3c4d', 'a'.repeat(25), '../x', ''];
  for (const a of bad) {
    const f = mk(); writeReg(f, [{ alias: a, enabled: false }]);
    assert.ok(/^alias_(invalid|reserved)$/.test(chk(f)), 'rejects ' + JSON.stringify(a));
  }
  for (const a of ['acct-1a2b3c4', 'acct-1a2b3c4d5', 'a'.repeat(24)]) {
    const f = mk(); writeReg(f, [{ alias: a, enabled: false }]);
    assert.strictEqual(chk(f), null, 'accepts ' + a);
  }
  const f = mk(); writeReg(f, [{ alias: 'x', enabled: false }, { alias: 'x', enabled: false }]);
  assert.strictEqual(chk(f), 'alias_duplicate');
  // reserved applies to disabled rows too
  const g = mk(); writeReg(g, [{ alias: 'codex-1a2b3c4d', enabled: false }]);
  assert.strictEqual(chk(g), 'alias_reserved');
});

test('N3b --alias must be an enabled registered row, never a path', () => {
  const f = mk();
  writeReg(f, [{ alias: 'on', enabled: true }, { alias: 'off', enabled: false }]);
  mkAlias(f, 'on'); mkAlias(f, 'off'); mkAlias(f, 'ghost'); // ghost exists on disk, unregistered
  const reg = R.loadRegistry(opts(f));
  assert.strictEqual(R.requireAlias(reg, 'on').alias, 'on');
  assert.strictEqual(reason(() => R.requireAlias(reg, '../x')), 'alias_invalid');
  assert.strictEqual(reason(() => R.requireAlias(reg, 'off')), 'alias_disabled');
  assert.strictEqual(reason(() => R.requireAlias(reg, 'ghost')), 'alias_not_registered');
  assert.strictEqual(reason(() => R.requireAlias(reg, undefined)), 'alias_invalid');
});

test('N4 config dir with credentials', () => {
  const f = mk(); const d = good(f);
  fs.writeFileSync(path.join(d, 'claude', '.credentials.json'), '{"FAKE":1}');
  assert.strictEqual(chk(f), 'config_dir_has_credentials');
});

test('N13 registry file checks', () => {
  let f = mk(); good(f);
  fs.chmodSync(path.join(f.dir, 'registry.json'), 0o644);
  assert.strictEqual(chk(f), 'registry_mode_too_open');
  f = mk(); good(f);
  const p = path.join(f.dir, 'registry.json');
  fs.renameSync(p, path.join(f.root, 'r.json'));
  fs.symlinkSync(path.join(f.root, 'r.json'), p);
  assert.strictEqual(chk(f), 'registry_is_symlink');
  f = mk(); good(f);
  assert.strictEqual(chk(f, { uid: process.getuid() + 1 }), 'registry_foreign_owner');
  f = mk(); writeReg(f, [{ alias: 'a', enabled: false }], { extra: 1 });
  assert.strictEqual(chk(f), 'registry_unknown_key');
  f = mk(); writeReg(f, [{ alias: 'a', enabled: false, path: '/x' }]);
  assert.strictEqual(chk(f), 'registry_unknown_key');
  f = mk(); writeReg(f, [{ alias: 'a', enabled: 'yes' }]);
  assert.strictEqual(chk(f), 'enabled_not_boolean');
  f = mk(); writeReg(f, [], { schema: 'x' });
  fs.writeFileSync(path.join(f.dir, 'registry.json'), JSON.stringify({ schema: 'other', accounts: [] }), { mode: 0o600 });
  assert.strictEqual(chk(f), 'registry_schema_unsupported');
  f = mk(); fs.writeFileSync(path.join(f.dir, 'registry.json'), '{nope', { mode: 0o600 });
  assert.strictEqual(chk(f), 'registry_not_json');
  f = mk(); good(f); fs.chmodSync(f.dir, 0o755);
  assert.strictEqual(chk(f), 'accounts_dir_mode_too_open');
});

test('N13b probe error is not absence', { skip: process.getuid() === 0 }, () => {
  const f = mk(); good(f);
  fs.mkdirSync(path.join(f.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.claude', '.credentials.json'), '{"FAKE":1}');
  fs.chmodSync(f.dir, 0o000);
  try {
    assert.strictEqual(chk(f), 'registry_probe_error');
  } finally { fs.chmodSync(f.dir, 0o700); }
  // dangling symlink registry
  const g = mk();
  fs.symlinkSync(path.join(g.root, 'nowhere'), path.join(g.dir, 'registry.json'));
  assert.strictEqual(chk(g), 'registry_is_symlink');
  // ELOOP-style: registry is a directory path component that is a file
  const h = mk();
  fs.writeFileSync(path.join(h.root, 'file'), 'x');
  assert.strictEqual(reason(() => R.loadRegistry(opts(h, { accountsDir: path.join(h.root, 'file') }))), 'registry_probe_error');
});

test('N17 realpath isolation', () => {
  // home symlinked to the fake real home
  let f = mk(); let d = good(f);
  fs.rmSync(path.join(d, 'home'), { recursive: true });
  fs.symlinkSync(f.home, path.join(d, 'home'));
  assert.strictEqual(chk(f), 'path_escapes_isolation');
  // home and claude symlinked to an unrelated outside dir
  for (const sub of ['home', 'claude']) {
    f = mk(); d = good(f);
    fs.mkdirSync(path.join(f.root, 'elsewhere'));
    fs.rmSync(path.join(d, sub), { recursive: true });
    fs.symlinkSync(path.join(f.root, 'elsewhere'), path.join(d, sub));
    assert.strictEqual(chk(f), 'path_escapes_isolation', sub);
  }
  // claude/ symlinked to fake ~/.claude
  f = mk(); d = good(f);
  fs.rmSync(path.join(d, 'claude'), { recursive: true });
  fs.symlinkSync(path.join(f.home, '.claude'), path.join(d, 'claude'));
  assert.strictEqual(chk(f), 'path_escapes_isolation');
  // alias dir itself symlinked
  f = mk(); good(f);
  fs.renameSync(path.join(f.dir, 'main'), path.join(f.root, 'moved'));
  fs.symlinkSync(path.join(f.root, 'moved'), path.join(f.dir, 'main'));
  assert.strictEqual(chk(f), 'path_escapes_isolation');
  // home/.claude/.credentials.json populated
  f = mk(); d = good(f);
  fs.mkdirSync(path.join(d, 'home', '.claude'));
  fs.writeFileSync(path.join(d, 'home', '.claude', '.credentials.json'), '{"FAKE":1}');
  assert.strictEqual(chk(f), 'path_escapes_isolation');
  // home/.claude is a link
  f = mk(); d = good(f);
  fs.symlinkSync(path.join(f.home, '.claude'), path.join(d, 'home', '.claude'));
  assert.strictEqual(chk(f), 'path_escapes_isolation');
  // accounts dir inside real ~/.claude is refused
  f = mk();
  const inner = path.join(f.home, '.claude', 'accts');
  fs.mkdirSync(inner, { recursive: true, mode: 0o700 });
  const f2 = { root: f.root, home: f.home, dir: inner };
  good(f2);
  assert.strictEqual(chk(f2), 'path_escapes_isolation');
  // passwd home injected as the alias home dir itself (home equals real home)
  f = mk(); d = good(f);
  assert.strictEqual(chk(f, { realHome: path.join(d, 'home') }), 'path_escapes_isolation');
  // plain accounts dir under the fake home passes
  f = mk(); good(f);
  assert.strictEqual(chk(f), null);
  // missing claude/ home/ are created 0700 (not tokens)
  f = mk(); d = good(f);
  fs.rmSync(path.join(d, 'home'), { recursive: true });
  assert.strictEqual(chk(f), null);
  assert.ok(fs.statSync(path.join(d, 'home')).isDirectory());
});

test('check never creates a token file', () => {
  const f = mk();
  writeReg(f, [{ alias: 'a', enabled: true }]);
  fs.mkdirSync(path.join(f.dir, 'a'), { mode: 0o700 });
  assert.strictEqual(chk(f), 'token_missing');
  assert.ok(!fs.existsSync(path.join(f.dir, 'a', 'token')));
});

test('CLI: check prints ok, list shows no secret, invalid exits 2', () => {
  const f = mk(); const d = good(f);
  fs.writeFileSync(path.join(d, 'token'), 'FAKE-CLI-SECRET');
  const env = { PATH: process.env.PATH, AUTOPILOT_ACCOUNTS_DIR: f.dir, HOME: f.home };
  let r = spawnSync(process.execPath, [LIB, 'check'], { env, encoding: 'utf8', input: '' });
  assert.strictEqual(r.stdout.trim(), 'ok');
  assert.strictEqual(r.status, 0);
  r = spawnSync(process.execPath, [LIB, 'list'], { env, encoding: 'utf8', input: '' });
  assert.ok(/^main\tenabled\t10/.test(r.stdout));
  assert.ok(!/SECRET/.test(r.stdout + r.stderr));
  fs.chmodSync(path.join(d, 'token'), 0o644);
  r = spawnSync(process.execPath, [LIB, 'check'], { env, encoding: 'utf8', input: '' });
  assert.strictEqual(r.status, 2);
  assert.ok(/token_mode_too_open/.test(r.stderr));
  assert.ok(!/SECRET/.test(r.stdout + r.stderr));
  const empty = mk();
  r = spawnSync(process.execPath, [LIB, 'check'], { env: Object.assign({}, env, { AUTOPILOT_ACCOUNTS_DIR: empty.dir }), encoding: 'utf8', input: '' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), 'unconfigured');
});
