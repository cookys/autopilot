#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/agent-liveness-check.js (CLI via child_process; temp git repos only).
 * Run: node --test scripts/agent-liveness-check.test.js < /dev/null
 */

require('./lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECK = path.join(__dirname, 'agent-liveness-check.js');
const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: path.join(__dirname, 'lib', 'test-gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-liveness-'));
test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function initRepo(name) {
  const root = path.join(TMP_ROOT, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'hello\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function runLiveness(repoRoot, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [CHECK, '--repo-root', repoRoot, '--json', ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('emits schema v1 facts for a minimal git repo (exit 0)', () => {
  const root = initRepo('ok');
  const res = runLiveness(root);
  assert.equal(res.status, 0, res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.schema_version, 1);
  assert.equal(typeof body.repo_root, 'string');
  assert.ok(body.repo_root.length > 0);
  assert.equal(body.fresh_seconds, 900);
  assert.ok(Array.isArray(body.worktrees));
  assert.ok(body.worktrees.length >= 1);
  const main = body.worktrees.find((w) => w.path === body.repo_root);
  assert.ok(main);
  assert.equal(main.exists, true);
  assert.equal(main.dirty_files, 0);
  assert.ok(body.disk && typeof body.disk.free_bytes === 'number');
  assert.ok(body.base_head && body.base_head.resolved === true);
});

test('dirty worktree reports dirty_files > 0', () => {
  const root = initRepo('dirty');
  fs.appendFileSync(path.join(root, 'tracked.txt'), 'more\n');
  const res = runLiveness(root);
  assert.equal(res.status, 0, res.stderr);
  const body = JSON.parse(res.stdout);
  const main = body.worktrees.find((w) => w.path === body.repo_root);
  assert.ok(main);
  assert.equal(main.dirty_files, 1);
});

test('--fresh-seconds 0 marks worktree fresh when files exist', () => {
  const root = initRepo('fresh');
  const res = runLiveness(root, ['--fresh-seconds', '0']);
  assert.equal(res.status, 0, res.stderr);
  const main = JSON.parse(res.stdout).worktrees.find((w) => w.path === root);
  assert.ok(main);
  assert.equal(main.fresh, true);
});

test('non-git directory exits 2', () => {
  const plain = fs.mkdtempSync(path.join(TMP_ROOT, 'plain-'));
  const res = runLiveness(plain);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a git repository/);
});

test('invalid --fresh-seconds exits 2', () => {
  const root = initRepo('bad-fresh');
  const res = runLiveness(root, ['--fresh-seconds', 'nope']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /agent-liveness-check\.js:/);
});

test('unknown argument exits 2', () => {
  const root = initRepo('bad-arg');
  const res = runLiveness(root, ['--not-a-flag']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown argument/);
});

test('unresolved --base adds a warning and base_head.resolved false', () => {
  const root = initRepo('bad-base');
  const res = runLiveness(root, ['--base', 'no-such-branch-ever']);
  assert.equal(res.status, 0, res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.base_head.resolved, false);
  assert.ok(body.warnings.some((w) => w.includes('does not resolve')));
});