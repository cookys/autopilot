#!/usr/bin/env node
'use strict';
// G37 P3 unit tests for account-env.js (N12 allowlist, locators, home safety, prepareHome). Tempdir only.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./account-env.js');

const loc = { accountsDir: '/acc', liveDir: '/live', stateDir: '/state', configFile: '/cfg.json', runtimeDir: '/run' };
const base = (extra) => Object.assign({
  alias: 'a', token: 'FAKE-t', configDir: '/acc/a/claude', homeDir: '/acc/a/home', realHome: '/h', locators: loc,
  callerEnv: {}, exists: () => false,
}, extra || {});

test('allowlist: only listed names and prefixes survive', () => {
  const env = E.buildEnv(base({ callerEnv: { PATH: '/bin', LC_ALL: 'C', FLEET_X: '1', SSH_AUTH_SOCK: '/s', GH_TOKEN: 'FAKE-g', FOO: 'x', ANTHROPIC_API_KEY: 'FAKE-k' } }));
  assert.strictEqual(env.PATH, '/bin');
  assert.strictEqual(env.LC_ALL, 'C');
  assert.strictEqual(env.FLEET_X, '1');
  assert.strictEqual(env.SSH_AUTH_SOCK, '/s');
  assert.strictEqual(env.GH_TOKEN, 'FAKE-g');
  assert.ok(!('FOO' in env) && !('ANTHROPIC_API_KEY' in env));
});

test('delete list wins even when a name is allowlisted by prefix', () => {
  const env = E.buildEnv(base({ callerEnv: { CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_BASE_URL: 'x' } }));
  assert.ok(!('CLAUDE_CODE_USE_VERTEX' in env) && !('ANTHROPIC_BASE_URL' in env));
});

test('account variables, five locators, token only via CLAUDE_CODE_OAUTH_TOKEN', () => {
  const env = E.buildEnv(base());
  assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, 'FAKE-t');
  assert.strictEqual(env.CLAUDE_CONFIG_DIR, '/acc/a/claude');
  assert.strictEqual(env.HOME, '/acc/a/home');
  assert.strictEqual(env.AUTOPILOT_ACCOUNT, 'a');
  for (const n of E.LOCATOR_NAMES) assert.ok(path.isAbsolute(env[n]), n);
  assert.strictEqual(Object.values(env).filter((v) => v === 'FAKE-t').length, 1);
});

test('git/gh references point at the real files only when they exist', () => {
  const ex = (p) => p === '/h/.gitconfig' || p === '/h/.config/gh';
  const env = E.buildEnv(base({ exists: ex }));
  assert.strictEqual(env.GIT_CONFIG_GLOBAL, '/h/.gitconfig');
  assert.strictEqual(env.GH_CONFIG_DIR, '/h/.config/gh');
  const none = E.buildEnv(base());
  assert.ok(!('GIT_CONFIG_GLOBAL' in none) && !('GH_CONFIG_DIR' in none));
});

test('token seat: parent token replaces the alias token; a missing parent token refuses', () => {
  const seat = E.buildEnv(base({ callerEnv: { AUTOPILOT_TOKEN_SEAT: '1', CLAUDE_CODE_OAUTH_TOKEN: 'test-token-A' } }));
  assert.strictEqual(seat.CLAUDE_CODE_OAUTH_TOKEN, 'test-token-A');
  assert.strictEqual(seat.AUTOPILOT_TOKEN_SEAT, '1');
  assert.strictEqual(seat.CLAUDE_CONFIG_DIR, '/acc/a/claude');
  assert.throws(
    () => E.buildEnv(base({ callerEnv: { AUTOPILOT_TOKEN_SEAT: '1', CLAUDE_CODE_OAUTH_TOKEN: '' } })),
    { reason: 'token_seat_missing' },
  );
  const ordinary = E.buildEnv(base({ callerEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'test-token-A' } }));
  assert.strictEqual(ordinary.CLAUDE_CODE_OAUTH_TOKEN, 'FAKE-t');
  assert.ok(!('AUTOPILOT_TOKEN_SEAT' in ordinary));
});

test('fail closed: missing token, relative locator, HOME equal to real home', () => {
  assert.throws(() => E.buildEnv(base({ token: '' })), { reason: 'token_missing' });
  assert.throws(() => E.buildEnv(base({ locators: Object.assign({}, loc, { liveDir: 'rel' }) })), { reason: 'locator_unresolved' });
  assert.throws(() => E.buildEnv(base({ homeDir: '/h' })), { reason: 'home_unsafe' });
});

test('prepareHome writes ssh Include and links only under home/.ssh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-env-'));
  const real = path.join(root, 'real');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(real, '.ssh'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(real, '.ssh', 'id_x'), 'FAKE');
  fs.writeFileSync(path.join(real, '.ssh', 'other'), 'FAKE');
  assert.deepStrictEqual(E.prepareHome({ homeDir: home, realHome: real }), { ssh: true, linked: 1 });
  assert.strictEqual(fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8'), `Include ${path.join(real, '.ssh', 'config')}\n`);
  assert.strictEqual(fs.readlinkSync(path.join(home, '.ssh', 'id_x')), path.join(real, '.ssh', 'id_x'));
  assert.ok(!fs.existsSync(path.join(home, '.ssh', 'other')));
  assert.ok(!fs.existsSync(path.join(home, '.claude')));
  assert.deepStrictEqual(E.prepareHome({ homeDir: home, realHome: path.join(root, 'nope') }), { ssh: false });
  fs.rmSync(root, { recursive: true, force: true });
});

test('XDG-only git identity is referenced; ~/.gitconfig wins when both exist', () => {
  const only = (p) => p === '/h/.config/git/config';
  assert.strictEqual(E.buildEnv(base({ exists: only })).GIT_CONFIG_GLOBAL, '/h/.config/git/config');
  assert.strictEqual(E.buildEnv(base({ exists: only, callerEnv: { XDG_CONFIG_HOME: '/x' } })).GIT_CONFIG_GLOBAL, undefined);
  const both = (p) => p === '/h/.gitconfig' || p === '/h/.config/git/config';
  assert.strictEqual(E.buildEnv(base({ exists: both })).GIT_CONFIG_GLOBAL, '/h/.gitconfig');
});

test('prepareHome refuses links and a home equal to the real home; never writes through a link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-env-'));
  const real = path.join(root, 'real');
  fs.mkdirSync(path.join(real, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(real, '.ssh', 'config'), 'REAL\n');
  assert.throws(() => E.prepareHome({ homeDir: real, realHome: real }), { reason: 'home_unsafe' });
  const h1 = path.join(root, 'h1');
  fs.mkdirSync(h1);
  fs.symlinkSync(path.join(real, '.ssh'), path.join(h1, '.ssh'));
  assert.throws(() => E.prepareHome({ homeDir: h1, realHome: real }), { reason: 'ssh_path_is_link' });
  const h2 = path.join(root, 'h2');
  fs.mkdirSync(path.join(h2, '.ssh'), { recursive: true });
  fs.symlinkSync(path.join(real, '.ssh', 'config'), path.join(h2, '.ssh', 'config'));
  assert.throws(() => E.prepareHome({ homeDir: h2, realHome: real }), { reason: 'ssh_path_is_link' });
  assert.strictEqual(fs.readFileSync(path.join(real, '.ssh', 'config'), 'utf8'), 'REAL\n');
  fs.rmSync(root, { recursive: true, force: true });
});

test('prepareHome: stale tmp collisions do not leak raw errors; no real .ssh still checks links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-env-'));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  const h = path.join(root, 'h');
  fs.mkdirSync(h);
  fs.symlinkSync(root, path.join(h, '.ssh'));
  assert.throws(() => E.prepareHome({ homeDir: h, realHome: real }), { reason: 'ssh_path_is_link' });
  const h2 = path.join(root, 'h2');
  fs.mkdirSync(path.join(h2, '.ssh'), { recursive: true });
  fs.mkdirSync(path.join(real, '.ssh'));
  fs.mkdirSync(path.join(h2, '.ssh', 'config')); // a directory where the file belongs: rename fails
  assert.throws(() => E.prepareHome({ homeDir: h2, realHome: real }), (e) => e instanceof E.EnvError);
  assert.deepStrictEqual(fs.readdirSync(path.join(h2, '.ssh')), ['config']);
  fs.rmSync(root, { recursive: true, force: true });
});
