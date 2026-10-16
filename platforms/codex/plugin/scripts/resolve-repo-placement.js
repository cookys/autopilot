#!/usr/bin/env node
'use strict';

// resolve-repo-placement.js — where a repo's worktrees and handoffs live (plan
// docs/plans/2026-10-12-worktree-placement.md, D1/D8/D12; the rule: references/worktree-placement.md).
// Node built-ins only: the rails call it on their dispatch path.
//
//   main     [--from <dir>]                         → JSON {main_checkout, repo_identity, fallback, behind}
//   worktree --prefix <p> --slug <s> --from <dir>   → one line: a `mktemp -u -d` template
//   handoff  --route manual|clear [--from <dir>]    → one line: the handoff file path
//
// main_checkout is the dirname of the absolute git common dir, accepted only when that basename is
// `.git` and its parent is a non-bare work tree; otherwise fallback is true and main_checkout is
// null (bare repo, separate --git-dir). `worktree` then answers a temp-dir template and says so on
// stderr; on the normal path it runs `mkdir -p <main>/.claude/worktrees` first, so a rail that
// calls it before its before-fingerprint never sees that directory appear as a mutation. When that
// mkdir fails (read-only checkout, `.claude` is a file) it answers the temp-dir template too.
// `worktree` requires --from: a rail passes its own repo root, never the process cwd.
//
// Handoff keys differ on purpose. manual: one file per repo, shared by its worktrees —
// ~/.autopilot/handoff-manual/<basename>-<sha1(repo_identity)[0:8]>.md. clear: one per worktree —
// ~/.autopilot/handoff/<sha1(realpath toplevel)>.md, consumed by the next session in that same
// worktree (a per-repo key would let a parallel session in a sibling worktree consume it).
//
// Exit: 0 answer printed; 1 --from is not inside a git repo (worktree, handoff clear); 2 usage.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function git(cwd, args) {
  try {
    return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return null;
  }
}

// Repo identity comes from project-key, loaded on first use: the hooks that only need clearHandoffKey
// stay off its require graph.
function repoIdentity(from) {
  return require('../src/status/project-key').scopeFromCwd(from).repo_identity;
}

function realpathOr(dir) {
  try { return fs.realpathSync(dir); } catch (_error) { return dir; }
}

function toplevel(from) {
  const top = git(from, ['rev-parse', '--show-toplevel']);
  return top ? realpathOr(top) : null;
}

function mainCheckout(from) {
  const common = git(from, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  const commonReal = realpathOr(common);
  if (path.basename(commonReal) !== '.git') return null;
  const parent = path.dirname(commonReal);
  if (git(parent, ['rev-parse', '--is-bare-repository']) !== 'false') return null;
  if (git(parent, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null;
  return toplevel(parent) === parent ? parent : null;
}

function behindUpstream(dir) {
  const count = git(dir, ['rev-list', '--count', 'HEAD..@{upstream}']);
  return count !== null && /^\d+$/.test(count) ? Number(count) : null;
}

function resolveMain(from) {
  const main = mainCheckout(from);
  return {
    main_checkout: main,
    repo_identity: repoIdentity(from),
    fallback: main === null,
    behind: main === null ? null : behindUpstream(main),
  };
}

// One line for the owner when the main checkout lags its upstream; null when it does not (or cannot be
// measured). The command is the one references/worktree-placement.md gives. BL-0006: printed by
// repo-residue-sweep.js close-session --yes, which finish-flow's close-out row already runs.
function behindHint(from) {
  const r = resolveMain(from);
  if (r.main_checkout === null || !(r.behind > 0)) return null;
  return `main checkout is ${r.behind} commit${r.behind === 1 ? '' : 's'} behind origin; run in the main checkout: git -C ${r.main_checkout} pull --ff-only`;
}

function worktreeTemplate(from, prefix, slug) {
  const name = `${prefix}-${slug.replace(/\//g, '-')}-XXXXXX`;
  const main = mainCheckout(from);
  const temp = path.join(os.tmpdir(), name);
  if (main === null) return { template: temp, fallback: true, reason: 'no non-bare main checkout' };
  try {
    fs.mkdirSync(path.join(main, '.claude', 'worktrees'), { recursive: true });
  } catch (err) {
    return { template: temp, fallback: true, reason: `cannot create ${main}/.claude/worktrees (${err.code || err.message})` };
  }
  return { template: path.join(main, '.claude', 'worktrees', name), fallback: false };
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// The /clear key: sha1 of the realpath toplevel. hooks/session-handoff.js and session-start.js call
// this instead of hashing on their own.
function clearHandoffKey(repoRoot) {
  return sha1(repoRoot);
}

function handoffPath(from, route, homeDir = os.homedir()) {
  if (route === 'clear') {
    const top = toplevel(from);
    return top ? path.join(homeDir, '.autopilot', 'handoff', `${clearHandoffKey(top)}.md`) : null;
  }
  const identity = repoIdentity(from);
  if (!identity) {
    const cwd = realpathOr(from);
    return path.join(homeDir, '.autopilot', 'handoff-manual', `${path.basename(cwd)}-${sha1(cwd).slice(0, 8)}.md`);
  }
  return path.join(homeDir, '.autopilot', 'handoff-manual', `${repoName(from)}-${sha1(identity).slice(0, 8)}.md`);
}

// The repo's name, the same from every worktree: the main checkout's basename, or for a bare repo
// (no main checkout) the common dir's basename without `.git`.
function repoName(from) {
  const common = realpathOr(git(from, ['rev-parse', '--path-format=absolute', '--git-common-dir']) || from);
  const base = path.basename(common);
  if (base === '.git') return path.basename(path.dirname(common));
  return base.replace(/\.git$/, '') || base;
}

const USAGE = 'usage: resolve-repo-placement.js main [--from <dir>]\n'
  + '       resolve-repo-placement.js worktree --prefix <p> --slug <s> --from <dir>\n'
  + '       resolve-repo-placement.js handoff --route manual|clear [--from <dir>]\n';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!/^--(from|prefix|slug|route)$/.test(key || '') || value === undefined || value === '') return null;
    opts[key.slice(2)] = value;
  }
  return opts;
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  const opts = parseArgs(rest);
  if (!opts || !['main', 'worktree', 'handoff'].includes(command)) {
    process.stderr.write(USAGE);
    return 2;
  }
  const from = path.resolve(opts.from || process.cwd());
  if (command === 'main') {
    process.stdout.write(`${JSON.stringify(resolveMain(from))}\n`);
    return 0;
  }
  if (command === 'worktree') {
    if (!opts.from || !opts.prefix || !opts.slug || !/^[A-Za-z0-9._-]+$/.test(opts.prefix)) {
      process.stderr.write(USAGE);
      return 2;
    }
    if (!toplevel(from)) {
      process.stderr.write(`resolve-repo-placement: not inside a git repo: ${from}\n`);
      return 1;
    }
    const answer = worktreeTemplate(from, opts.prefix, opts.slug);
    if (answer.fallback) {
      process.stderr.write(`resolve-repo-placement: ${answer.reason}; worktree stays in the temp dir\n`);
    }
    process.stdout.write(`${answer.template}\n`);
    return 0;
  }
  if (opts.route !== 'manual' && opts.route !== 'clear') {
    process.stderr.write(USAGE);
    return 2;
  }
  const answer = handoffPath(from, opts.route);
  if (answer === null) {
    process.stderr.write(`resolve-repo-placement: not inside a git repo: ${from}\n`);
    return 1;
  }
  process.stdout.write(`${answer}\n`);
  return 0;
}

module.exports = { mainCheckout, resolveMain, behindHint, worktreeTemplate, clearHandoffKey, handoffPath };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
