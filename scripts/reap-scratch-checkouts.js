#!/usr/bin/env node
// reap-scratch-checkouts.js - list (and with --apply remove) clean, merged worktrees piled up in a scratch dir.
// Usage: reap-scratch-checkouts.js --root DIR --repo MAIN [--keep a,b] [--warn-gb N] [--apply] [--json]
// REAP = top-level entry of DIR that is a worktree of MAIN, `git status --porcelain` empty (ignored files only),
// HEAD contained in a ref of MAIN, no process cwd inside, not in --keep. Everything else is reported with a reason
// and never touched. --apply runs `git worktree remove` (no --force) on REAP entries only; the branch ref stays.
// Clones and plain directories are reported, never deleted. Exit 0 except bad usage (2).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function usage() {
  process.stderr.write('usage: reap-scratch-checkouts.js --root DIR --repo MAIN [--keep a,b] [--warn-gb N] [--apply] [--json]\n');
  process.exit(2);
}
const opt = { keep: new Set(), warnGb: 20, apply: false, json: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => { if (i + 1 >= argv.length) usage(); return argv[++i]; };
  if (a === '--root') opt.root = val();
  else if (a === '--repo') opt.repo = val();
  else if (a === '--keep') val().split(',').filter(Boolean).forEach((k) => opt.keep.add(k));
  else if (a === '--warn-gb') { opt.warnGb = Number(val()); if (!Number.isFinite(opt.warnGb)) usage(); }
  else if (a === '--apply') opt.apply = true;
  else if (a === '--json') opt.json = true;
  else usage();
}
if (!opt.root || !opt.repo) usage();
const root = fs.realpathSync(opt.root);
const main = fs.realpathSync(opt.repo);

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim();
  } catch { return null; }
}
function reachable(sha) {
  if (!sha || git(main, 'cat-file', '-e', sha + '^{commit}') === null) return false;
  return (git(main, 'for-each-ref', '--count=1', '--contains', sha, 'refs/heads', 'refs/remotes', 'refs/tags') || '') !== '';
}
function sizeKb(p) {
  try { return Number(execFileSync('du', ['-sk', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\t')[0]) || 0; } catch { return 0; }
}
const live = new Set();
for (const p of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(p)) continue;
  try {
    const c = fs.readlinkSync('/proc/' + p + '/cwd');
    if (c.startsWith(root + '/')) live.add(c.slice(root.length + 1).split('/')[0]);
  } catch { /* process gone or not ours */ }
}

const rows = [];
for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const name = ent.name;
  const dir = path.join(root, name);
  const row = { name, kind: 'plain', cls: 'SKIP', reason: 'plain directory: not a git checkout', kb: sizeKb(dir) };
  const dotgit = path.join(dir, '.git');
  if (fs.existsSync(dotgit)) {
    row.kind = fs.statSync(dotgit).isFile() ? 'worktree' : 'clone';
    if (row.kind === 'clone') {
      row.reason = 'clone: reported, never deleted';
    } else {
      const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
      const st = git(dir, 'status', '--porcelain', '--ignore-submodules');
      const head = git(dir, 'rev-parse', 'HEAD');
      row.cls = 'KEEP';
      if (common === null || fs.realpathSync(common) !== path.join(main, '.git')) row.reason = 'worktree of another repo';
      else if (opt.keep.has(name)) row.reason = 'in --keep';
      else if (live.has(name)) row.reason = 'live process cwd inside';
      else if (st === null) row.reason = 'git status failed';
      else if (st !== '') row.reason = 'dirty: uncommitted or untracked files';
      else if (!reachable(head)) row.reason = 'unreachable commit: HEAD is in no ref of the main repo';
      else { row.cls = 'REAP'; row.reason = 'clean, HEAD reachable'; }
    }
  } else if (opt.keep.has(name)) row.reason = 'in --keep';
  else if (live.has(name)) row.reason = 'live process cwd inside';
  rows.push(row);
}

if (opt.apply) {
  for (const r of rows) {
    if (r.cls !== 'REAP') continue;
    const target = path.join(root, r.name);
    git(main, 'worktree', 'remove', target);
    r.removed = !fs.existsSync(target);
    if (!r.removed) r.reason = 'git worktree remove refused';
  }
}
const gb = (kb) => kb / 1048576;
const reapRows = rows.filter((r) => r.cls === 'REAP');
const totalKb = rows.reduce((s, r) => s + r.kb, 0);
const summary = {
  root,
  reapable: reapRows.length,
  reapable_gb: Number(gb(reapRows.reduce((s, r) => s + r.kb, 0)).toFixed(2)),
  total_gb: Number(gb(totalKb).toFixed(2)),
  warn_gb: opt.warnGb,
  over_cap: gb(totalKb) > opt.warnGb,
  applied: opt.apply,
  removed: rows.filter((r) => r.removed).length,
  apply_command: 'node scripts/reap-scratch-checkouts.js --root ' + root + ' --repo ' + main + ' --apply',
};
if (opt.json) {
  process.stdout.write(JSON.stringify({ summary, entries: rows }, null, 2) + '\n');
} else {
  for (const r of rows) {
    process.stdout.write([r.removed ? 'REMOVED' : r.cls, gb(r.kb).toFixed(2) + 'GB', r.kind, r.name, r.reason].join('\t') + '\n');
  }
  process.stdout.write('reap-scratch: ' + summary.reapable + ' reapable (' + summary.reapable_gb + ' GB) of ' + summary.total_gb + ' GB in ' + root + '\n');
  if (summary.over_cap) process.stdout.write('WARNING: scratch dir ' + summary.total_gb + ' GB exceeds cap ' + opt.warnGb + ' GB\n');
}
