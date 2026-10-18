#!/usr/bin/env node
'use strict';
// replay-test-integrity.js — replay the L0 test-integrity checker over recent merges.
//
// Usage:
//   node scripts/replay-test-integrity.js [--count N] [--out <file>]
//
// Lists the N most recent first-parent merge commits of HEAD (default 60) in the
// git repo that contains this script. For each merge the range is <merge>^1..<merge>.
// One detached temporary worktree of this repo's HEAD (under os.tmpdir, shared
// object store) runs scripts/check-test-integrity.sh validate --range <range>.
// The worktree is removed on success, on error, and on SIGINT/SIGTERM, and
// `git worktree prune` runs afterwards. The caller's checkout, index, and HEAD
// are not modified.
//
// --repo is NOT passed. The checker is executed with its cwd set to the detached
// worktree, so its default repository is that worktree: the binary and
// scripts/lib/test-integrity-l1.py are the HEAD versions, and merge ranges resolve
// through the shared object store. Pointing --repo at the original checkout would
// read a dirty worktree and would let L1 create nested worktrees against it.
//
// Exit codes:
//   0  report written (per-range checker failures are in errors[], not fatal)
//   2  usage error (unknown flag, bad --count / --out)
//
// Output: JSON { count_requested, ranges_scanned, ranges_with_violations,
//   counts_by_kind, records, errors } on stdout, or to --out <file>.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const HELP = `replay-test-integrity.js — replay check-test-integrity over recent merges.

Usage:
  node scripts/replay-test-integrity.js [--count N] [--out <file>]

Options:
  --count N     Number of first-parent merge commits to scan (default 60).
  --out <file>  Write the JSON report to this file instead of stdout.
  -h, --help    Show this help.

Each range is <merge>^1..<merge>. A non-JSON checker stdout or checker exit 2
is recorded in errors and does not stop the replay. Unknown flags exit 2.
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { count: 60, out: null };
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

function listMerges(repo, count) {
  const raw = git(repo, ['log', '-n', String(count), '--first-parent', '--merges', '--pretty=format:%H%x09%s', 'HEAD']);
  if (!raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { sha: line.slice(0, tab), subject: tab === -1 ? '' : line.slice(tab + 1) };
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repo = repoRoot();
  const merges = listMerges(repo, opts.count);

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-integrity-'));
  const wt = path.join(parent, 'wt');
  let cleaning = false;
  let cleaned = false;

  function cleanup() {
    if (cleaned || cleaning) return;
    cleaning = true;
    try {
      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' });
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(parent, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' });
    } catch {
      /* prune is best-effort */
    }
    cleaned = true;
    cleaning = false;
  }

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  const records = [];
  const errors = [];
  const counts = {};
  const rangesWith = new Set();

  try {
    git(repo, ['worktree', 'add', '--detach', wt, 'HEAD']);
    const checker = path.join(wt, 'scripts', 'check-test-integrity.sh');
    for (const merge of merges) {
      const range = `${merge.sha}^1..${merge.sha}`;
      const res = spawnSync('bash', [checker, 'validate', '--range', range], {
        cwd: wt,
        encoding: 'utf8',
      });
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
    cleanup();
  }

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
}

main();
