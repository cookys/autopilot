#!/usr/bin/env node
'use strict';

// prune-merged-branch.js — safely delete a merged head branch on a remote, or refuse.
//
// Usage:
//   node scripts/prune-merged-branch.js --repo <dir> --branch <name> [--remote origin] [--target develop] [--dry-run]
//
// Behaviour:
//   - Protected / refused names (exit 0, action "skipped", reason):
//     main, master, develop, the remote's HEAD branch, any release/*, any tag, and --branch == --target.
//   - Branch already absent on <remote> (exit 0, action "absent").
//   - Fetches <remote> <target> and <branch> (prune-safe), then checks
//     `git merge-base --is-ancestor <remote>/<branch> <remote>/<target>`.
//     If not an ancestor: does not delete; action "kept", reason "unmerged_commits",
//     unmerged = `git rev-list --count <remote>/<target>..<remote>/<branch>`, exit 2.
//   - With --dry-run: deletes nothing; action "dry-run", exit 0.
//   - Otherwise runs `git push <remote> --delete <branch>` and confirms
//     `git ls-remote --heads <remote> <branch>` returns nothing; action "deleted", exit 0.
//   - Prints exactly one JSON line on stdout:
//     {schema:"autopilot.prune-merged-branch/1", repo, remote, branch, target, action, reason, unmerged, head_sha}
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA = 'autopilot.prune-merged-branch/1';
const PROTECTED_NAMES = new Set(['main', 'master', 'develop', 'HEAD']);

function usage(stream) {
  stream.write(
    'Usage: node scripts/prune-merged-branch.js --repo <dir> --branch <name> ' +
    '[--remote origin] [--target develop] [--dry-run]\n',
  );
}

function parseArgs(argv) {
  const opts = {
    repo: null,
    branch: null,
    remote: 'origin',
    target: 'develop',
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error(`${a} needs a value`);
      }
      i += 1;
      return argv[i];
    };
    if (a === '--repo') opts.repo = need();
    else if (a === '--branch') opts.branch = need();
    else if (a === '--remote') opts.remote = need();
    else if (a === '--target') opts.target = need();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.help) return opts;
  if (!opts.repo) throw new Error('--repo is required');
  if (!opts.branch) throw new Error('--branch is required');
  for (const [flag, val] of [['--branch', opts.branch], ['--remote', opts.remote], ['--target', opts.target]]) {
    if (!val || val.startsWith('-') || /\s/.test(val)) {
      throw new Error(`invalid ${flag}: ${val}`);
    }
  }
  return opts;
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return {
    ok: r.status === 0,
    status: r.status === null ? 1 : r.status,
    out: r.stdout || '',
    err: r.stderr || '',
  };
}

function emit(rec, code) {
  const payload = {
    schema: SCHEMA,
    repo: rec.repo,
    remote: rec.remote,
    branch: rec.branch,
    target: rec.target,
    action: rec.action,
    reason: rec.reason || null,
    unmerged: rec.unmerged === undefined ? null : rec.unmerged,
    head_sha: rec.head_sha || null,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return code;
}

function localRemoteHead(repo, remote) {
  const r = git(repo, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`]);
  if (!r.ok) return null;
  const prefix = `refs/remotes/${remote}/`;
  const trimmed = r.out.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
}

function parseSymrefHead(lsRemoteOut) {
  for (const line of String(lsRemoteOut).split('\n')) {
    const m = /^ref:\s+refs\/heads\/([^\t\r\n]+)\tHEAD$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

function pruneMergedBranch(opts) {
  const repo = path.resolve(opts.repo);
  const remote = opts.remote;
  const target = opts.target.startsWith('refs/heads/')
    ? opts.target.slice('refs/heads/'.length)
    : opts.target;

  if (opts.branch.startsWith('refs/tags/')) {
    const tagBranch = opts.branch.slice('refs/tags/'.length) || opts.branch;
    return emit({ repo, remote, branch: tagBranch, target, action: 'skipped', reason: 'tag' }, 0);
  }
  const branch = opts.branch.startsWith('refs/heads/')
    ? opts.branch.slice('refs/heads/'.length)
    : opts.branch;

  if (!fs.existsSync(repo) || !git(repo, ['rev-parse', '--git-dir']).ok) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'not_a_git_repo' }, 2);
  }

  if (PROTECTED_NAMES.has(branch)) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'protected_branch' }, 0);
  }
  if (branch.startsWith('release/')) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'protected_release' }, 0);
  }
  if (branch === target) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'equals_target' }, 0);
  }
  if (git(repo, ['show-ref', '--verify', '--quiet', `refs/tags/${branch}`]).ok) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'tag' }, 0);
  }
  const localHead = localRemoteHead(repo, remote);
  if (localHead && branch === localHead) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'remote_head' }, 0);
  }

  const remHeadRes = git(repo, ['ls-remote', '--symref', remote, 'HEAD']);
  if (!remHeadRes.ok) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'ls_remote_failed' }, 1);
  }
  const remHead = parseSymrefHead(remHeadRes.out);
  if (remHead && branch === remHead) {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'remote_head' }, 0);
  }

  const remTagRes = git(repo, ['ls-remote', '--tags', remote, `refs/tags/${branch}`]);
  if (!remTagRes.ok) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'ls_remote_failed' }, 1);
  }
  if (remTagRes.out.trim() !== '') {
    return emit({ repo, remote, branch, target, action: 'skipped', reason: 'tag' }, 0);
  }

  const remBranchRes = git(repo, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  if (!remBranchRes.ok) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'ls_remote_failed' }, 1);
  }
  if (remBranchRes.out.trim() === '') {
    return emit({ repo, remote, branch, target, action: 'absent', reason: 'already_absent', unmerged: 0, head_sha: null }, 0);
  }

  const targetRef = `refs/remotes/${remote}/${target}`;
  const branchRef = `refs/remotes/${remote}/${branch}`;
  const fetched = git(repo, [
    'fetch',
    '--no-tags',
    remote,
    `+refs/heads/${target}:${targetRef}`,
    `+refs/heads/${branch}:${branchRef}`,
  ]);
  if (!fetched.ok) {
    const recheck = git(repo, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
    if (recheck.ok && recheck.out.trim() === '') {
      return emit({ repo, remote, branch, target, action: 'absent', reason: 'already_absent', unmerged: 0, head_sha: null }, 0);
    }
    return emit({ repo, remote, branch, target, action: 'error', reason: 'fetch_failed' }, 1);
  }

  const bShaRes = git(repo, ['rev-parse', '--verify', '-q', `${branchRef}^{commit}`]);
  const tShaRes = git(repo, ['rev-parse', '--verify', '-q', `${targetRef}^{commit}`]);
  if (!bShaRes.ok || !tShaRes.ok) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'ref_unresolvable' }, 1);
  }
  const headSha = bShaRes.out.trim();

  const anc = git(repo, ['merge-base', '--is-ancestor', branchRef, targetRef]);
  if (anc.status === 1) {
    const cntRes = git(repo, ['rev-list', '--count', `${targetRef}..${branchRef}`]);
    const cnt = cntRes.ok ? Number.parseInt(cntRes.out.trim(), 10) : NaN;
    return emit({
      repo,
      remote,
      branch,
      target,
      action: 'kept',
      reason: 'unmerged_commits',
      unmerged: Number.isFinite(cnt) ? cnt : 1,
      head_sha: headSha,
    }, 2);
  }
  if (anc.status !== 0) {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'merge_base_failed', head_sha: headSha }, 1);
  }

  if (opts.dryRun) {
    return emit({ repo, remote, branch, target, action: 'dry-run', reason: 'dry_run', unmerged: 0, head_sha: headSha }, 0);
  }

  const del = git(repo, ['push', remote, '--delete', branch]);
  const confirm = git(repo, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  if (!del.ok) {
    if (confirm.ok && confirm.out.trim() === '') {
      return emit({ repo, remote, branch, target, action: 'absent', reason: 'already_absent', unmerged: 0, head_sha: headSha }, 0);
    }
    return emit({ repo, remote, branch, target, action: 'error', reason: 'push_delete_failed', unmerged: 0, head_sha: headSha }, 1);
  }
  if (!confirm.ok || confirm.out.trim() !== '') {
    return emit({ repo, remote, branch, target, action: 'error', reason: 'delete_not_confirmed', unmerged: 0, head_sha: headSha }, 1);
  }

  return emit({ repo, remote, branch, target, action: 'deleted', reason: 'merged', unmerged: 0, head_sha: headSha }, 0);
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`prune-merged-branch: ${err.message}\n`);
    usage(process.stderr);
    return 2;
  }
  if (opts.help) {
    usage(process.stdout);
    return 0;
  }
  return pruneMergedBranch(opts);
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { pruneMergedBranch, parseArgs };
