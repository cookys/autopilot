#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
// Pin hotfix (operator decision d-2ab1e732 (c)): no account switch inside a task. `claude-account.js run --pin-default`
// resolves the host's default alias (lowest priority number among enabled rows, ties in registry order) and behaves exactly
// like `--alias <that>`; the three dispatch rails pass it on every run call. Tempdir only, FAKE- tokens, Node shim only.
//   1 run: lowest enabled priority wins (a disabled lower one is skipped); ties go to registry order
//   2 run: --pin-default with --alias is usage (exit 2), nothing spawned
//   3 run: a 429 on the default exits 4 with ONE spawn; the next run (default cooling) exits 3 with no spawn - never the other alias
//   4 each rail (review, author, hetero): default answers 429 -> rail fails, shim spawned once, second alias never reaches a child
//   5 negative control: a rail copy without --pin-default spawns twice and the second alias is used
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const { makeFixture, readLog, R429 } = require('./lib/account-fixtures/shim-install');

const SCRIPTS = __dirname;
const ACCT = path.join(SCRIPTS, 'claude-account.js');
const fp = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 8);

function runAccount(fx, args) {
  const r = spawnSync('node', [ACCT, 'run', '--purpose', 'pintest', ...args, '--', 'claude', '-p'],
    { env: fx.env, encoding: 'utf8', input: '', timeout: 60000 });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('pin-default: picks the lowest priority enabled alias, a disabled lower one is skipped', () => {
  const fx = makeFixture({ aliases: [{ alias: 'x', priority: 1, enabled: false }, { alias: 'b', priority: 20 }, { alias: 'a', priority: 30 }] });
  try {
    const r = runAccount(fx, ['--pin-default']);
    assert.equal(r.rc, 0, r.out);
    const calls = readLog(fx.shim.log);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].account, 'b');
    assert.equal(calls[0].fp, fp(fx.tokens.b));
  } finally { fx.cleanup(); }
});

test('pin-default: equal priority goes to the earlier registry row', () => {
  const fx = makeFixture({ aliases: [{ alias: 'z', priority: 10 }, { alias: 'a', priority: 10 }] });
  try {
    assert.equal(runAccount(fx, ['--pin-default']).rc, 0);
    assert.equal(readLog(fx.shim.log)[0].account, 'z');
  } finally { fx.cleanup(); }
});

test('pin-default with --alias is usage: exit 2, nothing spawned', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
  try {
    const r = runAccount(fx, ['--pin-default', '--alias', 'b']);
    assert.equal(r.rc, 2, r.out);
    assert.equal(readLog(fx.shim.log).length, 0);
  } finally { fx.cleanup(); }
});

test('pin-default: 429 on the default exits 4 at once; the next run still targets the default (cooling, exit 3), never the other alias', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }], responses: { a: R429 } });
  try {
    const r1 = runAccount(fx, ['--pin-default']);
    assert.equal(r1.rc, 4, r1.out);
    assert.equal(readLog(fx.shim.log).length, 1, 'one spawn, no second attempt');
    const r2 = runAccount(fx, ['--pin-default']);
    assert.equal(r2.rc, 3, r2.out);
    assert.match(r2.out, /alias_cooling alias=a/);
    const calls = readLog(fx.shim.log);
    assert.equal(calls.length, 1, 'the second run spawned nothing');
    assert.ok(calls.every((c) => c.fp === fp(fx.tokens.a)), 'second alias token never reached a child');
  } finally { fx.cleanup(); }
});

// ---------------------------------------------------------------- the three rails

function noSwitch(fx, label) {
  const calls = readLog(fx.shim.log);
  assert.equal(calls.length, 1, `${label}: shim spawned exactly once (got ${calls.length})`);
  assert.equal(calls[0].account, 'a', `${label}: the default alias`);
  assert.ok(calls.every((c) => c.fp === fp(fx.tokens.a) && c.account !== 'b'), `${label}: second alias never reached a child`);
}

/** A farm of scripts/ (symlinks, repo layout kept) with dispatch rail `name` replaced by edit(src). */
function farm(fx, name, edit) {
  const root = fs.mkdtempSync(path.join(fx.root, 'farm-'));
  const repoRoot = path.resolve(SCRIPTS, '..');
  for (const n of fs.readdirSync(repoRoot)) {
    if (n === 'scripts' || n === '.git') continue;
    fs.symlinkSync(path.join(repoRoot, n), path.join(root, n));
  }
  const d = path.join(root, 'scripts');
  fs.mkdirSync(d);
  for (const n of fs.readdirSync(SCRIPTS)) if (n !== name) fs.symlinkSync(path.join(SCRIPTS, n), path.join(d, n));
  const src = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
  const out = edit(src);
  assert.notEqual(out, src, 'mutation matched nothing in ' + name);
  fs.writeFileSync(path.join(d, name), out, { mode: 0o755 });
  return path.join(d, name);
}
const dropPin = (src) => src.split(' --pin-default').join('');

function railEnv(fx) {
  const env = Object.assign({}, fx.env, { DISPATCH_QUIET: '1', AUTOPILOT_SETTLE_MS: '0' });
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CONFIG_DIR']) delete env[k];
  return env;
}
const twoAliases = () => makeFixture({ aliases: [{ alias: 'a', priority: 10 }, { alias: 'b', priority: 20 }], responses: { a: R429 } });

const RAILS = {
  review(fx, rail) {
    const diff = path.join(fx.root, 'd.diff');
    fs.writeFileSync(diff, 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n');
    const r = spawnSync(rail, ['--runner', 'claude-native', '--model', 'haiku', '--diff-file', diff, '--bin', path.join(fx.shim.binDir, 'claude'), '--timeout', '30s'],
      { env: railEnv(fx), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
  },
  author(fx, rail) {
    const prompt = path.join(fx.root, 'prompt.txt');
    fs.writeFileSync(prompt, 'Return a small JSON object.\n');
    const r = spawnSync(rail, ['--runner', 'claude-native', '--model', 'claude-fable-5', '--prompt-file', prompt, '--bin', 'claude', '--timeout', '20s'],
      { env: railEnv(fx), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
  },
  hetero(fx, rail) {
    const git = (cwd, a) => execFileSync('git', ['-c', 'user.email=fixture', '-c', 'user.name=t', ...a], { cwd, stdio: 'ignore' });
    const repo = path.join(fx.root, 'repo');
    fs.mkdirSync(repo);
    git(repo, ['init', '-q', '-b', 'develop']);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'base']);
    const prompt = path.join(fx.root, 'prompt.txt');
    fs.writeFileSync(prompt, 'do work\n');
    const env = Object.assign(railEnv(fx), {
      AUTOPILOT_CONFIG_FILE: fx.configFile, AUTOPILOT_DISPATCH_RUNS_DIR: path.join(fx.root, 'runs'), GIT_CONFIG_NOSYSTEM: '1',
    });
    fs.mkdirSync(env.AUTOPILOT_DISPATCH_RUNS_DIR, { recursive: true });
    spawnSync('node', [path.join(SCRIPTS, 'run-approval.js'), 'confirm-claude-native'], { env, stdio: 'ignore' });
    const r = spawnSync(rail, ['--runner', 'claude-native', '--model', 'claude-sonnet-4-6', '--prompt-file', prompt, '--context-window', 'off',
      '--branch', 'feat/pin-' + Math.random().toString(36).slice(2, 8)],
    { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
  },
};
const RAIL_FILE = { review: 'dispatch-review.sh', author: 'dispatch-author.sh', hetero: 'dispatch-hetero.sh' };

for (const name of Object.keys(RAILS)) {
  test(`rail ${name}: default alias answers 429 -> rail fails, one spawn, second alias never reaches a child`, () => {
    const fx = twoAliases();
    try {
      const r = RAILS[name](fx, path.join(SCRIPTS, RAIL_FILE[name]));
      noSwitch(fx, name);
      if (name !== 'hetero') assert.notEqual(r.rc, 0, r.out); // hetero reports the failed worker in its own verdict
    } finally { fx.cleanup(); }
  });

  test(`rail ${name}: negative control: a copy without --pin-default spawns twice and uses the second alias`, () => {
    const fx = twoAliases();
    try {
      RAILS[name](fx, farm(fx, RAIL_FILE[name], dropPin));
      const calls = readLog(fx.shim.log);
      assert.equal(calls.length, 2, `spawns ${calls.length}`);
      assert.equal(calls[1].account, 'b');
      assert.throws(() => noSwitch(fx, name));
    } finally { fx.cleanup(); }
  });
}
