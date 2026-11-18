#!/usr/bin/env node
'use strict';

// reap-build-artifacts.js - delete the build output a repo declares in `.autopilot/build-artifacts.json`.
//
//   node scripts/reap-build-artifacts.js reap  --worktree <abs> [--dry-run] [--json]
//   node scripts/reap-build-artifacts.js sweep --repo <abs> [--idle-min N] [--dry-run] [--json]
//
// reap   one linked worktree, regardless of merge status. Refuses the repo's main checkout.
// sweep  every linked worktree of the repo (never the main checkout) whose declared artifact dirs were
//        not modified in the last N minutes (default 30) and have no open file / cwd by any process
//        (Linux /proc readlink only; elsewhere idle-min alone).
//
// Coverage: dispatch worktrees are reaped by reap-dispatch-worktrees.sh. Agent-isolation and manual
// worktrees (no WorktreeCreate hook on purpose: it would take over Agent isolation) are covered by
// `sweep` (called by scripts/lib/disk-guard.js before each dispatch worktree) and by depth-0 running
// `reap --worktree` when it closes a lane. Each run appends one JSON audit line to
// $XDG_STATE_HOME or ~/.local/state, autopilot/build-artifact-reap.jsonl.
// Exit: 0 ok, 2 usage.

const fs = require('fs');
const path = require('path');
const lib = require('./lib/build-artifacts.js');

function usage(code) {
  const text = fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 18).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
  (code ? process.stderr : process.stdout).write(text + '\n');
  process.exit(code);
}

const argv = process.argv.slice(2);
const cmd = argv.shift();
if (!cmd || cmd === '--help' || cmd === '-h') usage(cmd ? 0 : 2);
const opt = { dryRun: false, json: false };
while (argv.length) {
  const a = argv.shift();
  if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--worktree' || a === '--repo' || a === '--idle-min') {
    if (!argv.length) usage(2);
    opt[a.slice(2)] = argv.shift();
  } else usage(2);
}

let res;
if (cmd === 'reap' && opt.worktree) {
  if (!path.isAbsolute(opt.worktree)) usage(2);
  res = lib.reapArtifacts(opt.worktree, { dryRun: opt.dryRun });
} else if (cmd === 'sweep' && opt.repo) {
  if (!path.isAbsolute(opt.repo)) usage(2);
  const idle = opt['idle-min'] == null ? 30 : Number(opt['idle-min']);
  if (!Number.isFinite(idle) || idle < 0) usage(2);
  res = lib.sweep(opt.repo, { dryRun: opt.dryRun, idleMin: idle });
} else usage(2);

const bytes = res.removed.reduce((n, x) => n + x.bytes, 0);
lib.audit({ cmd, target: opt.worktree || opt.repo, dry_run: opt.dryRun, removed: res.removed.length, bytes, skipped: res.skipped.length });
if (opt.json) process.stdout.write(JSON.stringify(res) + '\n');
else {
  const verb = opt.dryRun ? 'would remove' : 'removed';
  for (const x of res.removed) process.stdout.write(`${verb} ${x.worktree ? x.worktree + '/' : ''}${x.path} (${x.bytes} bytes)\n`);
  for (const x of res.skipped) process.stdout.write(`skipped ${x.worktree ? x.worktree + '/' : ''}${x.path}: ${x.reason}\n`);
}
