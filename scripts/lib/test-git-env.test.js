'use strict';
// Negative control for scripts/lib/test-git-env.js: an ambient GIT_DIR must not let a fixture's git commands
// write into the repo that GIT_DIR names. Everything happens under mkdtemp; the real repo is never referenced.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const HELPER = path.join(__dirname, 'test-git-env.js');
const ID = ['-c', 'user.email=o@example.invalid', '-c', 'user.name=o'];

function outerRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-outer-'));
  const g = (...a) => execFileSync('git', [...ID, ...a], { cwd: dir, env: { ...process.env, GIT_DIR: undefined }, stdio: 'pipe' }).toString().trim();
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), '2\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'outer');
  return { dir, head: () => g('rev-parse', 'HEAD'), files: () => g('ls-tree', '-r', '--name-only', 'HEAD'), status: () => g('status', '--porcelain') };
}

// The exact fixture shape of dispatch-hetero-account.test.js: init, write a.txt, add -A, commit -m base, in a scratch dir.
function runFixtureChild(outer, scratch, loadHelper) {
  const code = `
    ${loadHelper ? `require(${JSON.stringify(HELPER)});` : ''}
    const { execFileSync } = require('child_process');
    const fs = require('fs'); const path = require('path');
    const git = (cwd, args) => execFileSync('git', ['-c', 'user.email=fixture', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
    git(${JSON.stringify(scratch)}, ['init', '-q', '-b', 'develop']);
    fs.writeFileSync(path.join(${JSON.stringify(scratch)}, 'a.txt'), 'x\\n');
    git(${JSON.stringify(scratch)}, ['add', '-A']);
    git(${JSON.stringify(scratch)}, ['commit', '-q', '-m', 'base']);`;
  const env = { ...process.env, GIT_DIR: path.join(outer.dir, '.git') };
  delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  return spawnSync(process.execPath, ['-e', code], { cwd: scratch, env, encoding: 'utf8' });
}

test('with the helper loaded, an ambient GIT_DIR cannot redirect fixture git into the outer repo', () => {
  const outer = outerRepo();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-scratch-'));
  const head = outer.head(); const files = outer.files();
  const r = runFixtureChild(outer, scratch, true);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(outer.head(), head, 'outer HEAD moved');
  assert.equal(outer.files(), files, 'outer tree changed');
  assert.equal(outer.status(), '', 'outer worktree dirty');
  assert.ok(fs.existsSync(path.join(scratch, '.git')), 'the fixture repo was created in the scratch dir');
});

test('control: without the helper the same ambient GIT_DIR does move the outer repo (the incident)', () => {
  const outer = outerRepo();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-scratch-'));
  const head = outer.head();
  runFixtureChild(outer, scratch, false);
  assert.notEqual(outer.head(), head, 'the incident no longer reproduces; the control is vacuous');
});
