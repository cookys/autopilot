#!/usr/bin/env node
'use strict';

// disk-guard.js - refuse to create a worktree on a nearly full disk.
//
//   node scripts/lib/disk-guard.js check --path <dir> [--repo <abs>] [--min-free-pct 20]
//
// Exit 0 ok, 3 refused (one-line reason on stderr: free %, threshold, biggest reclaimable declared
// artifact dirs). Below the threshold it first runs `sweep` (non-dry) on the repo and re-checks.
// Threshold: --min-free-pct, else AUTOPILOT_DISK_GUARD_MIN_FREE_PCT, else 20.
// Test seam: AUTOPILOT_DISK_GUARD_FAKE_STATFS = JSON file {"free_pct":[5,50]} (number or list; one value
// per statfs call, the last repeats) so no test fills a real disk.

const fs = require('fs');
const path = require('path');
const lib = require('./build-artifacts.js');

let fakeCalls = 0;
function freePct(dir) {
  const seam = process.env.AUTOPILOT_DISK_GUARD_FAKE_STATFS;
  if (seam) {
    const v = JSON.parse(fs.readFileSync(seam, 'utf8')).free_pct;
    const list = Array.isArray(v) ? v : [v];
    return list[Math.min(fakeCalls++, list.length - 1)];
  }
  const s = fs.statfsSync(dir);
  return s.blocks ? (100 * s.bavail) / s.blocks : 100;
}

function nearestExisting(p) {
  let cur = path.resolve(p);
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return cur;
}

function human(n) {
  const u = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)}${u[i]}`;
}

function main(argv) {
  if (argv.shift() !== 'check') { process.stderr.write('usage: disk-guard.js check --path <dir> [--repo <abs>] [--min-free-pct N]\n'); return 2; }
  const o = {};
  while (argv.length) {
    const a = argv.shift();
    if (!['--path', '--repo', '--min-free-pct'].includes(a) || !argv.length) { process.stderr.write(`disk-guard: bad argument ${a}\n`); return 2; }
    o[a.slice(2)] = argv.shift();
  }
  if (!o.path) { process.stderr.write('disk-guard: --path required\n'); return 2; }
  let min = Number(o['min-free-pct'] != null ? o['min-free-pct'] : process.env.AUTOPILOT_DISK_GUARD_MIN_FREE_PCT);
  if (!Number.isFinite(min) || min < 0 || min > 100) min = 20;
  const dir = nearestExisting(o.path);
  const repo = o.repo || lib.mainCheckoutOf(dir);

  let free = freePct(dir);
  if (free >= min) return 0;
  if (repo) {
    const r = lib.sweep(repo, { dryRun: false });
    lib.audit({ cmd: 'disk-guard-sweep', target: repo, removed: r.removed.length, bytes: r.removed.reduce((n, x) => n + x.bytes, 0) });
  }
  free = freePct(dir);
  if (free >= min) return 0;
  let hint = 'none declared';
  if (repo) {
    const dry = lib.sweep(repo, { dryRun: true, idleMin: 0 });
    const top = dry.removed.sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((x) => `${x.worktree}/${x.path} ${human(x.bytes)}`);
    if (top.length) hint = top.join(', ');
  }
  process.stderr.write(`disk-guard: refused: free ${free.toFixed(1)}% < min ${min}% on ${dir}; biggest reclaimable declared artifacts: ${hint}\n`);
  return 3;
}

process.exitCode = main(process.argv.slice(2));
