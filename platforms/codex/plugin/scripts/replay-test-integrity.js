#!/usr/bin/env node
'use strict';
// replay-test-integrity.js — replay the L0 test-integrity checker over recent merges.
//
// Usage:
//   node scripts/replay-test-integrity.js [--count N] [--out <file>] [--ref <ref>]
//
// This script scans the HEAD of the repo it lives in (override with --ref) and
// should be run on develop. Lists the N most recent first-parent merge commits
// (default 60). For each merge the range is <merge>^1..<merge>.
// One detached temporary worktree of that commit (under os.tmpdir, shared
// object store) runs scripts/check-test-integrity.sh validate --range <range>.
// Each range's checker is a detached child so SIGINT/SIGTERM can interrupt the
// replay: the handler kills that child's process group, removes the worktree,
// and exits 128+signo (130 / 143). `git worktree prune` runs afterwards. If the
// temp directory or the worktree entry is still there, a warning is written to
// stderr and the process exits 3 when the replay itself succeeded. The caller's
// checkout, index, and HEAD are not modified.
//
// --repo is NOT passed. The checker is executed with its cwd set to the detached
// worktree, so its default repository is that worktree: the binary and
// scripts/lib/test-integrity-l1.py are the HEAD versions, and merge ranges resolve
// through the shared object store. Pointing --repo at the original checkout would
// read a dirty worktree and would let L1 create nested worktrees against it.
//
// Exit codes:
//   0  report written (per-range checker failures are in errors[], not fatal)
//   2  usage error (unknown flag, bad --count / --out / --ref)
//   3  cleanup left the temp directory or a worktree entry behind
//   130 SIGINT, 143 SIGTERM (128 plus the signal number)
//
// Output: JSON { count_requested, ranges_scanned, ranges_with_violations,
//   counts_by_kind, records, errors } on stdout, or to --out <file>.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const HELP = `replay-test-integrity.js — replay check-test-integrity over recent merges.

Usage:
  node scripts/replay-test-integrity.js [--count N] [--out <file>] [--ref <ref>]

Options:
  --count N     Number of first-parent merge commits to scan (default 60).
  --out <file>  Write the JSON report to this file instead of stdout.
  --ref <ref>   Commit whose checker and history are replayed (default HEAD).
                The script scans the HEAD of the repo it lives in; run it on develop.
  -h, --help    Show this help.

Each range is <merge>^1..<merge>. A non-JSON checker stdout or checker exit 2
is recorded in errors and does not stop the replay. Unknown flags exit 2.
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { count: 60, out: null, ref: 'HEAD' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === '--count' || arg.startsWith('--count=')) {
      const value = arg === '--count' ? argv[++i] : arg.slice('--count='.length);
      if (value === undefined || !/^[1-9]\d*$/.test(value)) fail('Error: --count expects a positive integer.');
      opts.count = Number(value);
      continue;
    }
    if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? argv[++i] : arg.slice('--out='.length);
      if (!value) fail('Error: --out expects a file path.');
      opts.out = value;
      continue;
    }
    if (arg === '--ref' || arg.startsWith('--ref=')) {
      const value = arg === '--ref' ? argv[++i] : arg.slice('--ref='.length);
      if (!value) fail('Error: --ref expects a ref.');
      opts.ref = value;
      continue;
    }
    fail(`Error: unknown flag: ${arg}`);
  }
  return opts;
}

function git(repo, args, stdio) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: stdio || 'pipe',
  });
}

function excerpt(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function repoRoot() {
  const top = execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  if (!top) fail('Error: this script is not inside a git repository.');
  return top;
}

function listMerges(repo, count, ref) {
  const raw = git(repo, ['log', '-n', String(count), '--first-parent', '--merges', '--pretty=format:%H%x09%s', ref]);
  if (!raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { sha: line.slice(0, tab), subject: tab === -1 ? '' : line.slice(tab + 1) };
  });
}

let inflight = null;
let signalExit = null;
let cleaning = false;
let cleaned = false;
let active = null;

function killInflight(sig) {
  const child = inflight;
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, sig);
  } catch (err) {
    if (!err || err.code === 'ESRCH') return;
    try {
      process.kill(child.pid, sig);
    } catch (err2) {
      if (!err2 || err2.code === 'ESRCH') return;
    }
  }
}

function worktreeStillRegistered(repo, wt) {
  try {
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (list.split('\n').some((line) => line === `worktree ${wt}`)) return true;
  } catch {
    /* fall through to the admin directory */
  }
  try {
    const gitPath = execFileSync('git', ['-C', repo, 'rev-parse', '--git-path', 'worktrees'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    const admin = path.isAbsolute(gitPath) ? gitPath : path.resolve(repo, gitPath);
    if (!fs.existsSync(admin)) return false;
    for (const name of fs.readdirSync(admin)) {
      try {
        const text = fs.readFileSync(path.join(admin, name, 'gitdir'), 'utf8');
        if (text.includes(wt)) return true;
      } catch {
        /* not this entry */
      }
    }
  } catch {
    /* no admin directory */
  }
  return false;
}

function cleanup() {
  if (cleaned || cleaning || !active) return false;
  cleaning = true;
  const { repo, parent, wt } = active;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' });
  } catch {
    /* removal failed; leftover check below */
  }
  try {
    fs.rmSync(parent, { recursive: true, force: true });
  } catch {
    /* removal failed; leftover check below */
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' });
  } catch {
    /* prune failed; leftover check below */
  }
  const leftovers = [];
  try {
    if (fs.existsSync(parent)) leftovers.push(parent);
  } catch {
    leftovers.push(parent);
  }
  try {
    if (worktreeStillRegistered(repo, wt)) leftovers.push(wt);
  } catch {
    leftovers.push(wt);
  }
  for (const item of leftovers) {
    try {
      process.stderr.write(`warning: replay cleanup left ${item} behind\n`);
    } catch {
      /* stderr closed */
    }
  }
  cleaned = true;
  cleaning = false;
  return leftovers.length > 0;
}

function onSignal(sig) {
  if (signalExit !== null) return;
  const code = 128 + (os.constants.signals[sig] || 0);
  signalExit = code;
  try { killInflight(sig); } catch { /* signal path must not throw */ }
  try { cleanup(); } catch { /* signal path must not throw */ }
  process.exit(code);
}

function runChecker(checker, range, cwd) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn('bash', [checker, 'validate', '--range', range], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    inflight = child;
    const out = [];
    const err = [];
    if (child.stdout) child.stdout.on('data', (chunk) => out.push(chunk));
    if (child.stderr) child.stderr.on('data', (chunk) => err.push(chunk));
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (inflight === child) inflight = null;
      resolve({
        status,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        error,
      });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (status) => finish(status, null));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = repoRoot();
  try {
    git(repo, ['rev-parse', '--verify', '--quiet', `${opts.ref}^{commit}`]);
  } catch {
    fail(`Error: unknown ref: ${opts.ref}`);
  }
  const merges = listMerges(repo, opts.count, opts.ref);

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-integrity-'));
  const wt = path.join(parent, `wt-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  active = { repo, parent, wt };

  const records = [];
  const errors = [];
  const counts = {};
  const rangesWith = new Set();
  let dirty = false;

  try {
    git(repo, ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', wt, opts.ref]);
    const checker = path.join(wt, 'scripts', 'check-test-integrity.sh');
    for (const merge of merges) {
      if (signalExit !== null) return;
      const range = `${merge.sha}^1..${merge.sha}`;
      const res = await runChecker(checker, range, wt);
      const stdout = res.stdout || '';
      const stderr = res.stderr || '';
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      if (res.status === 2 || parsed === null || typeof parsed !== 'object') {
        errors.push({ range, stderr: excerpt(stderr || stdout || res.error) });
        continue;
      }
      let any = false;
      for (const violation of parsed.violations || []) {
        any = true;
        const kind = violation.kind;
        counts[kind] = (counts[kind] || 0) + 1;
        records.push({
          range,
          merge_sha: merge.sha,
          merge_subject: merge.subject,
          kind,
          file: violation.file,
          line: violation.line,
          detail: excerpt(violation.detail),
        });
      }
      for (const entry of parsed.surface_touches || []) {
        any = true;
        const obj = typeof entry === 'string'
          ? { kind: 'surface_touch', file: entry, line: null, detail: entry }
          : entry;
        const kind = obj.kind || 'surface_touch';
        counts[kind] = (counts[kind] || 0) + 1;
        records.push({
          range,
          merge_sha: merge.sha,
          merge_subject: merge.subject,
          kind,
          file: obj.file,
          line: Object.prototype.hasOwnProperty.call(obj, 'line') ? obj.line : null,
          detail: excerpt(obj.detail),
        });
      }
      if (any) rangesWith.add(range);
    }
  } finally {
    if (signalExit === null) {
      try { dirty = cleanup(); } catch { dirty = true; }
    }
  }

  if (signalExit !== null) return;

  const report = {
    count_requested: opts.count,
    ranges_scanned: merges.length,
    ranges_with_violations: rangesWith.size,
    counts_by_kind: counts,
    records,
    errors,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (opts.out) fs.writeFileSync(opts.out, text);
  else fs.writeSync(1, text);
  if (dirty) process.exit(3);
}

process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

main().catch((err) => {
  try { cleanup(); } catch { /* already reported */ }
  process.stderr.write(`${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
