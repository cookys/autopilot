'use strict';

// Repository facts a dispatch contract needs to hold BEFORE anything is spent:
// a commit at HEAD, a git work tree, a clean tree, a pinned base that resolves,
// and every required path present at that base. `scripts/dispatch-contract.js
// checkPolicy` states these once; campaign intake re-derives the same facts
// before the Mission claim so a failure here refuses with the grant untouched
// (2026-09-15: a dirty tree and a required path absent at base each consumed
// an attempt at the dispatch-hetero layer). Reason strings are the contract
// checker's, verbatim — its suites grep them.

const { spawnSync } = require('child_process');

function runGit(repo, args, input = null) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`git failed to spawn: ${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(result.stderr ? result.stderr.toString().trim() : 'git command failed');
  }
  return result.stdout ? result.stdout.toString() : '';
}

function isHex40(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

// HEAD / work tree / dirty / base, in the contract checker's order. Returns the
// reasons found so far; the first fatal group short-circuits exactly as before.
function repoBaseReasons(repo, baseSha) {
  const reasons = [];
  let headSha = '';
  try {
    headSha = runGit(repo, ['rev-parse', 'HEAD']).trim();
    if (!isHex40(headSha)) {
      reasons.push('base: HEAD must be a commit');
    }
  } catch (err) {
    reasons.push('base: repository has no HEAD');
  }
  try {
    runGit(repo, ['rev-parse', '--is-inside-work-tree']);
  } catch (err) {
    reasons.push('base: repository is not a git work tree');
  }
  if (reasons.length > 0) return reasons;

  const status = runGit(repo, ['status', '--porcelain']);
  if (status.trim().length > 0) {
    reasons.push('dirty: repository has uncommitted changes');
    return reasons;
  }
  try {
    runGit(repo, ['cat-file', '-e', `${baseSha}^{commit}`]);
  } catch (err) {
    reasons.push('base: pinned base commit does not resolve');
  }
  return reasons;
}

function hasPathAtCommit(repo, commitSha, targetPath) {
  let out;
  try {
    out = runGit(repo, ['ls-tree', '-r', '--name-only', commitSha, '--', targetPath]);
  } catch (err) {
    return false;
  }
  if (out.trim().length === 0) {
    return false;
  }
  const exact = targetPath.replace(/\/+$/, '');
  const lines = out.split('\n').filter((v) => v.length > 0);
  return lines.some((line) => line === exact || line.startsWith(`${exact}/`) || line.endsWith(`/${exact}`));
}

// First required path absent at the base commit, as one reason (the checker
// reports one, not all).
function requiredPathReasons(repo, commitSha, paths) {
  const reasons = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (!hasPathAtCommit(repo, commitSha, p)) {
      reasons.push(`path: required path ${p} not present at base`);
      return reasons;
    }
  }
  return reasons;
}

module.exports = {
  runGit,
  isHex40,
  repoBaseReasons,
  hasPathAtCommit,
  requiredPathReasons,
};
