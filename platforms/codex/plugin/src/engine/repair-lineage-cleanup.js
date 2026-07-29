'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function git(cwd, args) {
  const child = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ...child,
    stdout: String(child.stdout || '').trim(),
    stderr: String(child.stderr || '').trim(),
  };
}

function readMarker(markerPath) {
  const stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('retained worktree marker must be a regular file');
  }
  const marker = {};
  for (const line of fs.readFileSync(markerPath, 'utf8').trim().split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('retained worktree marker is malformed');
    const key = line.slice(0, separator);
    if (Object.prototype.hasOwnProperty.call(marker, key)) {
      throw new Error(`retained worktree marker repeats ${key}`);
    }
    marker[key] = line.slice(separator + 1);
  }
  return marker;
}

function worktreeInstanceId(worktree) {
  const stat = fs.statSync(worktree, { bigint: true });
  return crypto.createHash('sha256').update(JSON.stringify({
    birthtime_ns: stat.birthtimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    schema: 1,
    worktree: path.resolve(worktree),
  })).digest('hex');
}

function removeRetainedWorktree({
  cwd,
  worktree,
  expectedBranch,
  expectedTip,
  expectedRootRunId,
  expectedRetentionOwner,
  expectedRetentionReason,
  expectedRetentionExpiresAt,
  expectedWorktreeInstanceId,
}) {
  const absoluteWorktree = path.resolve(worktree);
  if (worktreeInstanceId(absoluteWorktree) !== expectedWorktreeInstanceId) {
    throw new Error('retained worktree filesystem instance changed');
  }
  const listed = git(cwd, ['worktree', 'list', '--porcelain']);
  if (listed.error || listed.signal || listed.status !== 0) return listed;
  const registered = listed.stdout.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)))
    .includes(absoluteWorktree);
  if (!registered) throw new Error('retained worktree is not registered at the expected path');

  const marker = readMarker(path.join(absoluteWorktree, '.autopilot-worktree'));
  const branch = git(absoluteWorktree, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const head = git(absoluteWorktree, ['rev-parse', 'HEAD']);
  const status = git(absoluteWorktree, ['status', '--porcelain']);
  const expectedMarker = {
    schema: '2',
    branch: expectedBranch,
    root_run_id: expectedRootRunId,
    retention: 'lease',
    retention_owner: expectedRetentionOwner,
    retention_reason_sha256: crypto.createHash('sha256')
      .update(expectedRetentionReason)
      .digest('hex'),
    retention_expires_at: String(expectedRetentionExpiresAt),
  };
  const exactMarkerKeys = [
    'base_sha',
    'branch',
    'created_at',
    'loop_id',
    'retention',
    'retention_expires_at',
    'retention_owner',
    'retention_reason_sha256',
    'root_run_id',
    'run_id',
    'schema',
  ].sort();
  if (Object.keys(marker).sort().join('\0') !== exactMarkerKeys.join('\0')
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(marker.base_sha || '')
      || !/^[1-9][0-9]*$/.test(marker.created_at || '')
      || typeof marker.run_id !== 'string'
      || marker.run_id.length === 0
      || typeof marker.loop_id !== 'string'
      || marker.loop_id.length === 0
      || branch.status !== 0
      || branch.stdout !== expectedBranch
      || head.status !== 0
      || head.stdout !== expectedTip
      || Object.entries(expectedMarker).some(([key, value]) => marker[key] !== value)) {
    throw new Error('retained worktree identity no longer matches cleanup authority');
  }
  if (status.error || status.signal || status.status !== 0 || status.stdout.length > 0) {
    throw new Error('retained worktree is dirty');
  }
  return git(cwd, ['worktree', 'remove', absoluteWorktree]);
}

if (require.main === module) {
  try {
    const input = JSON.parse(process.argv[2] || 'null');
    const result = removeRetainedWorktree(input);
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`git worktree remove terminated by ${result.signal}`);
    if (result.status !== 0) {
      throw new Error(result.stderr || `git worktree remove exited ${result.status}`);
    }
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  removeRetainedWorktree,
  worktreeInstanceId,
};
