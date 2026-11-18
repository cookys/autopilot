#!/usr/bin/env node
'use strict';

// count-merged-remote-branches.js — read-only counter of remote branches fully merged into
// the remote's develop (else main), excluding protected branches and tags. Never deletes anything.
//
// Usage:
//   node scripts/count-merged-remote-branches.js --repo <dir> [--repo <dir>...] [--fetch] [--remote origin]
//   node scripts/count-merged-remote-branches.js --repos-root <dir> [--fetch] [--remote origin]
//
// Output:
//   One JSON line per repo: {repo, target, merged_unDeleted: N, names: [...first 20]}
//   Followed by one total JSON line: {total: true, repos: M, merged_unDeleted: SUM}
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROTECTED_STATIC = new Set(['main', 'master', 'develop', 'HEAD']);

function usage(stream) {
  stream.write(
    'Usage: node scripts/count-merged-remote-branches.js ' +
    '(--repo <dir>... | --repos-root <dir>...) [--fetch] [--remote origin]\n',
  );
}

function parseArgs(argv) {
  const opts = {
    repos: [],
    reposRoots: [],
    fetch: false,
    remote: 'origin',
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
    if (a === '--repo') opts.repos.push(need());
    else if (a === '--repos-root') opts.reposRoots.push(need());
    else if (a === '--fetch') opts.fetch = true;
    else if (a === '--remote') opts.remote = need();
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.help) return opts;
  if (!opts.repos.length && !opts.reposRoots.length) {
    throw new Error('at least one --repo <dir> or --repos-root <dir> is required');
  }
  if (!opts.remote || opts.remote.startsWith('-') || /\s/.test(opts.remote)) {
    throw new Error(`invalid --remote: ${opts.remote}`);
  }
  return opts;
}

function git(repo, args, extraEnv = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
  });
  return {
    ok: r.status === 0,
    status: r.status === null ? 1 : r.status,
    out: r.stdout || '',
    err: r.stderr || '',
  };
}

function discoverRepos(opts) {
  const seen = new Set();
  const list = [];
  const add = (dir) => {
    const abs = path.resolve(dir);
    if (!seen.has(abs)) {
      seen.add(abs);
      list.push(abs);
    }
  };
  for (const r of opts.repos) {
    const abs = path.resolve(r);
    if (!fs.existsSync(abs) || !git(abs, ['rev-parse', '--git-dir']).ok) {
      throw new Error(`not a git repository: ${r}`);
    }
    add(abs);
  }
  for (const root of opts.reposRoots) {
    const absRoot = path.resolve(root);
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
      throw new Error(`not a directory: ${root}`);
    }
    const entries = fs.readdirSync(absRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '.git')
      .map((e) => e.name)
      .sort();
    for (const name of entries) {
      const child = path.join(absRoot, name);
      if (git(child, ['rev-parse', '--git-dir'], { GIT_CEILING_DIRECTORIES: absRoot }).ok) {
        add(child);
      }
    }
  }
  return list;
}

function remoteHeadBranch(repo, remote) {
  const r = git(repo, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`]);
  if (!r.ok) return null;
  const prefix = `refs/remotes/${remote}/`;
  const trimmed = r.out.trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
}

function resolveTarget(repo, remote) {
  for (const candidate of ['develop', 'main']) {
    if (git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${candidate}^{commit}`]).ok) {
      return candidate;
    }
  }
  const head = remoteHeadBranch(repo, remote);
  if (head && git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${head}^{commit}`]).ok) {
    return head;
  }
  return null;
}

function countRepo(repo, opts) {
  const remote = opts.remote;
  if (opts.fetch) {
    const f = git(repo, ['fetch', '--prune', remote]);
    if (!f.ok) {
      throw new Error(`git fetch --prune ${remote} failed in ${repo}: ${f.err.trim()}`);
    }
  }

  const target = resolveTarget(repo, remote);
  if (!target) {
    return { repo, target: null, merged_unDeleted: 0, names: [] };
  }

  const protectedNames = new Set(PROTECTED_STATIC);
  protectedNames.add(target);
  const remHead = remoteHeadBranch(repo, remote);
  if (remHead) protectedNames.add(remHead);

  const tagSet = new Set();
  const tagsRes = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/tags']);
  if (tagsRes.ok) {
    for (const line of tagsRes.out.split('\n')) {
      const t = line.trim();
      if (t) tagSet.add(t);
    }
  }

  const targetRef = `refs/remotes/${remote}/${target}`;
  const mergedRes = git(repo, [
    'for-each-ref',
    `--merged=${targetRef}`,
    '--format=%(refname)%00%(symref)',
    `refs/remotes/${remote}`,
  ]);
  if (!mergedRes.ok) {
    throw new Error(`git for-each-ref failed in ${repo}: ${mergedRes.err.trim()}`);
  }

  const prefix = `refs/remotes/${remote}/`;
  const matched = [];
  for (const line of mergedRes.out.split('\n')) {
    if (!line) continue;
    const [refname, symref] = line.split('\0');
    if (symref) continue;
    if (!refname.startsWith(prefix)) continue;
    const name = refname.slice(prefix.length);
    if (!name) continue;
    if (protectedNames.has(name)) continue;
    if (name.startsWith('release/')) continue;
    if (tagSet.has(name)) continue;
    matched.push(name);
  }
  matched.sort();

  return {
    repo,
    target,
    merged_unDeleted: matched.length,
    names: matched.slice(0, 20),
  };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`count-merged-remote-branches: ${err.message}\n`);
    usage(process.stderr);
    return 2;
  }
  if (opts.help) {
    usage(process.stdout);
    return 0;
  }

  let repos;
  try {
    repos = discoverRepos(opts);
  } catch (err) {
    process.stderr.write(`count-merged-remote-branches: ${err.message}\n`);
    return 2;
  }

  const rows = [];
  let total = 0;
  try {
    for (const repo of repos) {
      const row = countRepo(repo, opts);
      rows.push(row);
      total += row.merged_unDeleted;
    }
  } catch (err) {
    process.stderr.write(`count-merged-remote-branches: ${err.message}\n`);
    return 1;
  }

  for (const row of rows) {
    process.stdout.write(`${JSON.stringify(row)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ total: true, repos: rows.length, merged_unDeleted: total })}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { countRepo, parseArgs, discoverRepos };
