'use strict';

require('./lib/test-git-env');

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SWEEP = path.join(__dirname, 'repo-residue-sweep.js');

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return (result.stdout || '').trim();
}

function writeConfig(dir, residue) {
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, `${JSON.stringify({ residue })}\n`);
  return file;
}

function makeRepo(root) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'side']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

function addWorktree(repo, root, branch) {
  const wt = path.join(root, `wt-${branch.replace(/[^A-Za-z0-9._-]/g, '-')}`);
  git(repo, ['worktree', 'add', '-q', '-b', branch, wt, 'HEAD']);
  return wt;
}

function runReap(repo, args, configFile) {
  const env = { ...process.env, AUTOPILOT_RESIDUE_RECENT_HOURS: '0', AUTOPILOT_CONFIG_FILE: configFile };
  delete env.AUTOPILOT_RESIDUE_DELETE_BRANCHES;
  const result = spawnSync(process.execPath, [SWEEP, 'reap', '--repo', repo, '--yes', ...args], {
    encoding: 'utf8',
    env,
  });
  return result;
}

function reapBranch(repo, root, branch, args, configFile) {
  addWorktree(repo, root, branch);
  const first = runReap(repo, args, configFile);
  assert.equal(first.status, 0, first.stderr);
  const second = runReap(repo, args, configFile);
  assert.equal(second.status, 0, second.stderr);
  return second;
}

function branchExists(repo, branch) {
  const result = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { encoding: 'utf8' });
  return result.status === 0;
}

test('reap --delete-branches keeps protected branches and deletes feat/develop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-protect-'));
  const configFile = writeConfig(root, {});
  try {
    const repo = makeRepo(root);
    const kept = [];
    for (const branch of ['develop', 'main', 'master']) {
      const run = reapBranch(repo, root, branch, ['--delete-branches'], configFile);
      assert.equal(branchExists(repo, branch), true, `${branch} still exists`);
      assert.match(run.stderr, new RegExp(`reap: keep protected branch ${branch}`));
      const report = JSON.parse(run.stdout);
      const entry = report.actions.branches_kept.find((row) => row.branch === branch && row.skipped === 'protected');
      assert.ok(entry, JSON.stringify(report.actions.branches_kept));
      kept.push(branch);
    }
    assert.deepEqual(kept, ['develop', 'main', 'master']);

    const feature = reapBranch(repo, root, 'feat/develop', ['--delete-branches'], configFile);
    assert.equal(branchExists(repo, 'feat/develop'), false);
    assert.equal(feature.stderr.includes('reap: keep protected branch feat/develop'), false);
    const featureReport = JSON.parse(feature.stdout);
    assert.ok(featureReport.actions.branches_deleted.some((row) => row.branch === 'feat/develop'));

    const prefix = reapBranch(repo, root, 'develop-x', ['--delete-branches'], configFile);
    assert.equal(branchExists(repo, 'develop-x'), false);
    assert.equal(prefix.stderr.includes('reap: keep protected branch develop-x'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('residue.delete_branches still keeps develop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-protect-cfg-'));
  const configFile = writeConfig(root, { delete_branches: true });
  try {
    const repo = makeRepo(root);
    const run = reapBranch(repo, root, 'develop', [], configFile);
    assert.equal(branchExists(repo, 'develop'), true);
    assert.match(run.stderr, /reap: keep protected branch develop/);
    const report = JSON.parse(run.stdout);
    assert.ok(report.actions.branches_kept.some((row) => row.branch === 'develop' && row.skipped === 'protected'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function assertProtectedKept(repo, run, branch) {
  assert.equal(run.status, 0, run.stderr);
  assert.equal(branchExists(repo, branch), true, `${branch} still exists`);
  assert.match(run.stderr, new RegExp(`reap: keep protected branch ${branch}`));
  const report = JSON.parse(run.stdout);
  assert.ok(report.actions.branches_kept.some((row) => row.branch === branch && row.skipped === 'protected'), JSON.stringify(report.actions.branches_kept));
  assert.equal(report.actions.branches_deleted.some((row) => row.branch === branch), false);
}

test('reap --delete-branches reports develop checked out in the main checkout as protected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-protect-main-develop-'));
  const configFile = writeConfig(root, {});
  try {
    const repo = makeRepo(root);
    git(repo, ['checkout', '-q', '-b', 'develop']);
    const run = runReap(repo, ['--delete-branches'], configFile);
    assertProtectedKept(repo, run, 'develop');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reap --delete-branches reports main checked out in a surviving worktree as protected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-protect-wt-main-'));
  const configFile = writeConfig(root, {});
  try {
    const repo = makeRepo(root);
    git(repo, ['branch', 'main', 'HEAD']);
    const wt = path.join(root, 'wt-main');
    git(repo, ['worktree', 'add', '-q', wt, 'main']);
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'dirty\n');
    const run = runReap(repo, ['--delete-branches'], configFile);
    assert.equal(fs.existsSync(wt), true);
    assertProtectedKept(repo, run, 'main');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('integration ref trunk is protected when passed as refs/heads/trunk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-protect-trunk-'));
  const configFile = writeConfig(root, {});
  try {
    const repo = makeRepo(root);
    git(repo, ['branch', 'trunk', 'HEAD']);
    const run = runReap(repo, ['--delete-branches', '--integration-ref', 'refs/heads/trunk'], configFile);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(branchExists(repo, 'trunk'), true);
    assert.equal(branchExists(repo, 'side'), true);
    assert.match(run.stderr, /reap: keep protected branch trunk/);
    const report = JSON.parse(run.stdout);
    assert.ok(report.actions.branches_kept.some((row) => row.branch === 'trunk' && row.skipped === 'protected'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
