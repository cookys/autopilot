'use strict';

// build-artifacts.js - reap per-worktree build output (e.g. courier/target) that a repo declares in
// `.autopilot/build-artifacts.json` = {"paths":["courier/target"]}. The repo maintains the file;
// autopilot only reads it. Trust boundary: the file comes from the repo, so every path is validated
// before anything is deleted (relative, no `..`, not a symlink, realpath strictly inside the worktree)
// and the repo's main checkout is never touched.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DECLARATION = path.join('.autopilot', 'build-artifacts.json');

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function loadDeclaration(worktreeDir) {
  const file = path.join(worktreeDir, DECLARATION);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { paths: [] }; }
  try {
    const j = JSON.parse(raw);
    const paths = Array.isArray(j && j.paths) ? j.paths.filter((p) => typeof p === 'string' && p) : [];
    return { paths };
  } catch (e) {
    return { paths: [], error: `invalid ${DECLARATION}: ${e.message}` };
  }
}

// Absolute path of the main checkout of the repo that owns `dir`, or null (bare repo / not a repo).
function mainCheckoutOf(dir) {
  let common;
  try { common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']); } catch { return null; }
  if (path.basename(common) !== '.git') return null;
  try { return fs.realpathSync(path.dirname(common)); } catch { return null; }
}

function isMainCheckout(worktreeDir) {
  const main = mainCheckoutOf(worktreeDir);
  if (!main) return false;
  let real;
  try { real = fs.realpathSync(worktreeDir); } catch { return false; }
  return real === main;
}

function treeBytes(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  let names = [];
  try { names = fs.readdirSync(p); } catch { return 0; }
  for (const n of names) total += treeBytes(path.join(p, n));
  return total;
}

// Returns {abs} or {reason}.
function resolveDeclared(worktreeReal, rel) {
  if (path.isAbsolute(rel)) return { reason: 'absolute_path' };
  if (rel.split(/[\\/]+/).includes('..')) return { reason: 'parent_segment' };
  const abs = path.join(worktreeReal, rel);
  let st;
  try { st = fs.lstatSync(abs); } catch { return { reason: 'absent' }; }
  if (st.isSymbolicLink()) return { reason: 'symlink_refused' };
  let real;
  try { real = fs.realpathSync(abs); } catch { return { reason: 'absent' }; }
  if (real === worktreeReal || !real.startsWith(worktreeReal + path.sep)) return { reason: 'outside_worktree' };
  return { abs: real };
}

function reapArtifacts(worktreeDir, opts = {}) {
  const dryRun = !!opts.dryRun;
  const out = { worktree: worktreeDir, dryRun, removed: [], skipped: [] };
  let worktreeReal;
  try { worktreeReal = fs.realpathSync(worktreeDir); } catch { out.skipped.push({ path: '.', reason: 'worktree_missing' }); return out; }
  if (isMainCheckout(worktreeReal)) { out.skipped.push({ path: '.', reason: 'main_checkout_refused' }); return out; }
  const decl = loadDeclaration(worktreeReal);
  if (decl.error) out.skipped.push({ path: DECLARATION, reason: 'declaration_invalid' });
  for (const rel of decl.paths) {
    const r = resolveDeclared(worktreeReal, rel);
    if (!r.abs) { if (r.reason !== 'absent') out.skipped.push({ path: rel, reason: r.reason }); continue; }
    if (opts.skipIf) {
      const why = opts.skipIf(r.abs);
      if (why) { out.skipped.push({ path: rel, reason: why }); continue; }
    }
    const bytes = treeBytes(r.abs);
    if (!dryRun) {
      try { fs.rmSync(r.abs, { recursive: true, force: true }); } catch (e) { out.skipped.push({ path: rel, reason: `rm_failed:${e.code || e.message}` }); continue; }
    }
    out.removed.push({ path: rel, bytes });
  }
  return out;
}

// ---- sweep -------------------------------------------------------------------------------------

function linkedWorktrees(repo) {
  const main = mainCheckoutOf(repo);
  let porcelain = '';
  try { porcelain = git(repo, ['worktree', 'list', '--porcelain']); } catch { return []; }
  const list = [];
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const p = line.slice(9);
    let real;
    try { real = fs.realpathSync(p); } catch { continue; }
    if (real === main) continue;
    list.push(real);
  }
  return list;
}

// True when anything under `dir` was modified at or after cutoffMs (early exit).
function modifiedSince(dir, cutoffMs) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return false; }
  if (st.mtimeMs >= cutoffMs) return true;
  if (!st.isDirectory()) return false;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return false; }
  for (const n of names) if (modifiedSince(path.join(dir, n), cutoffMs)) return true;
  return false;
}

// Linux only: any process with an fd or cwd under `dir`. readlink only; never environ.
function openUnder(dir) {
  if (process.platform !== 'linux') return false;
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return false; }
  const prefix = dir + path.sep;
  const inside = (t) => t === dir || t.startsWith(prefix);
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try { if (inside(fs.readlinkSync(`/proc/${pid}/cwd`))) return true; } catch { /* gone or not ours */ }
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      try { if (inside(fs.readlinkSync(`/proc/${pid}/fd/${fd}`))) return true; } catch { /* closed */ }
    }
  }
  return false;
}

function sweep(repo, opts = {}) {
  const idleMin = opts.idleMin == null ? 30 : opts.idleMin;
  const cutoff = Date.now() - idleMin * 60000;
  const out = { repo, dryRun: !!opts.dryRun, idleMin, removed: [], skipped: [] };
  for (const wt of linkedWorktrees(repo)) {
    const r = reapArtifacts(wt, {
      dryRun: opts.dryRun,
      skipIf: (abs) => {
        if (idleMin > 0 && modifiedSince(abs, cutoff)) return 'recently_modified';
        if (openUnder(abs)) return 'open_file';
        return null;
      },
    });
    for (const x of r.removed) out.removed.push({ worktree: wt, ...x });
    for (const x of r.skipped) out.skipped.push({ worktree: wt, ...x });
  }
  return out;
}

function auditFile() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'autopilot', 'build-artifact-reap.jsonl');
}

function audit(record) {
  try {
    const f = auditFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  } catch { /* the audit line must never fail a reap */ }
}

module.exports = { DECLARATION, loadDeclaration, reapArtifacts, sweep, mainCheckoutOf, isMainCheckout, treeBytes, audit, auditFile };
