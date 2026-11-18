#!/usr/bin/env node
'use strict';
// worktree-removal-log.js — shared live-process cwd check and audit logger for automatic worktree removals.
//
// Contract:
//   - Log file: ${XDG_RUNTIME_DIR:-$HOME/.autopilot}/autopilot/worktree-removals.jsonl
//   - Rotates to .1 before appending when the file would exceed 2 MB (2097152 bytes).
//   - Creates parent directories automatically; never throws or writes to stdout/stderr on log.
//   - JSONL fields: ts (ISO), host, remover, path, branch, reason, lock (held_by_us|free|unavailable),
//     live_pids (integer[]), outcome (removed|skipped|failed).
//   - Live-process discovery reads ONLY /proc/<pid>/cwd via readlinkSync (never environ or cmdline).
//
// CLI:
//   node scripts/lib/worktree-removal-log.js check-live --path <wt> [--proc-root <dir>]
//     [--log-skip --remover <name> [--branch <br>] [--reason <why>] [--lock <held_by_us|free|unavailable>]]
//     -> prints JSON array of live PIDs on stdout; exits 1 when non-empty (live), 0 when empty.
//   node scripts/lib/worktree-removal-log.js log --remover <name> --path <wt> [--branch <br>]
//     --reason <why> [--lock <held_by_us|free|unavailable>] --outcome <removed|skipped|failed>
//     [--live-pids <csv-or-json>]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const VALID_LOCKS = new Set(['held_by_us', 'free', 'unavailable']);
const VALID_OUTCOMES = new Set(['removed', 'skipped', 'failed']);

function resolveRemovalLogPath(env = process.env) {
  const xdg = env && typeof env.XDG_RUNTIME_DIR === 'string' && env.XDG_RUNTIME_DIR.trim()
    ? env.XDG_RUNTIME_DIR.trim()
    : '';
  const base = xdg || path.join((env && env.HOME) || os.homedir(), '.autopilot');
  return path.join(base, 'autopilot', 'worktree-removals.jsonl');
}

function normalizeDir(p) {
  if (typeof p !== 'string' || !p) return '';
  const trimmed = p.replace(/\/+$/, '');
  return trimmed || '/';
}

function targetPrefixes(wtPath) {
  const out = new Set();
  if (typeof wtPath !== 'string' || !wtPath) return out;
  const abs = normalizeDir(path.resolve(wtPath));
  if (abs && abs !== '/') out.add(abs);
  try {
    const real = normalizeDir(fs.realpathSync(abs));
    if (real && real !== '/') out.add(real);
  } catch {
    try {
      const parentReal = normalizeDir(fs.realpathSync(path.dirname(abs)));
      const joined = normalizeDir(path.join(parentReal, path.basename(abs)));
      if (joined && joined !== '/') out.add(joined);
    } catch {
      // Unresolvable parent; literal resolved path is still checked.
    }
  }
  return out;
}

// Read /proc/<pid>/cwd via readlinkSync only. Skips unreadable or vanished PIDs.
function readProcCwds(procRoot = '/proc') {
  const map = new Map();
  let entries;
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (!/^[0-9]+$/.test(name)) continue;
    const pid = Number(name);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try {
      const raw = fs.readlinkSync(path.join(procRoot, name, 'cwd')).replace(/ \(deleted\)$/, '');
      if (raw) map.set(pid, raw);
    } catch {
      // Vanished or unreadable pid; skip.
    }
  }
  return map;
}

function findLivePids(wtPath, opts = {}) {
  const prefixes = targetPrefixes(wtPath);
  if (prefixes.size === 0) return [];
  const procRoot = (opts && typeof opts.procRoot === 'string' && opts.procRoot) || '/proc';
  const exclude = new Set([process.pid]);
  if (opts && Array.isArray(opts.excludePids)) {
    for (const p of opts.excludePids) {
      const n = Number(p);
      if (Number.isSafeInteger(n) && n > 0) exclude.add(n);
    }
  }
  const cwds = readProcCwds(procRoot);
  const found = [];
  for (const [pid, cwdRaw] of cwds.entries()) {
    if (exclude.has(pid)) continue;
    const cwd = normalizeDir(cwdRaw);
    if (!cwd || cwd === '/') continue;
    for (const prefix of prefixes) {
      if (cwd === prefix || cwd.startsWith(`${prefix}/`)) {
        found.push(pid);
        break;
      }
    }
  }
  found.sort((a, b) => a - b);
  return found;
}

// Probe .autopilot-worktree.lock without creating the file when absent.
function probeWorktreeLock(wtPath) {
  if (typeof wtPath !== 'string' || !wtPath) return 'unavailable';
  let st;
  try {
    st = fs.lstatSync(wtPath);
  } catch {
    return 'unavailable';
  }
  if (!st.isDirectory() || st.isSymbolicLink()) return 'unavailable';
  const lockPath = path.join(wtPath, '.autopilot-worktree.lock');
  let lockStat;
  try {
    lockStat = fs.lstatSync(lockPath);
  } catch (e) {
    if (e && e.code === 'ENOENT') return 'free';
    return 'unavailable';
  }
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) return 'unavailable';
  const r = spawnSync('flock', ['-n', lockPath, 'true'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 'unavailable';
  return 'free';
}

function normalizeBranch(branch) {
  if (typeof branch !== 'string') return null;
  const trimmed = branch.trim().replace(/^refs\/heads\//, '');
  return trimmed ? trimmed : null;
}

function normalizePids(livePids) {
  if (!Array.isArray(livePids)) return [];
  const set = new Set();
  for (const v of livePids) {
    const n = Number(v);
    if (Number.isSafeInteger(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function logWorktreeRemoval(entry = {}, env = process.env) {
  try {
    const logPath = resolveRemovalLogPath(env);
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    const lock = VALID_LOCKS.has(entry.lock) ? entry.lock : 'unavailable';
    const outcome = VALID_OUTCOMES.has(entry.outcome) ? entry.outcome : 'failed';
    const row = {
      ts: typeof entry.ts === 'string' && entry.ts ? entry.ts : new Date().toISOString(),
      host: typeof entry.host === 'string' && entry.host ? entry.host : os.hostname(),
      remover: typeof entry.remover === 'string' && entry.remover ? path.basename(entry.remover) : 'unknown',
      path: typeof entry.path === 'string' ? entry.path : '',
      branch: normalizeBranch(entry.branch),
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      lock,
      live_pids: normalizePids(entry.live_pids),
      outcome,
    };
    const line = `${JSON.stringify(row)}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    let curSize = 0;
    try {
      curSize = fs.statSync(logPath).size;
    } catch {
      curSize = 0;
    }
    if (curSize > 0 && curSize + lineBytes > MAX_LOG_BYTES) {
      try {
        fs.renameSync(logPath, `${logPath}.1`);
      } catch {
        // Best-effort rotation; never fail caller.
      }
    }
    fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function parsePidArg(raw) {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return normalizePids(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return normalizePids(trimmed.split(/[,\s]+/).filter(Boolean));
}

function main(argv) {
  const cmd = argv[0] || '';
  const opts = { logSkip: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--path') opts.path = argv[++i];
    else if (a === '--proc-root') opts.procRoot = argv[++i];
    else if (a === '--remover') opts.remover = argv[++i];
    else if (a === '--branch') opts.branch = argv[++i];
    else if (a === '--reason') opts.reason = argv[++i];
    else if (a === '--lock') opts.lock = argv[++i];
    else if (a === '--outcome') opts.outcome = argv[++i];
    else if (a === '--live-pids') opts.livePids = argv[++i];
    else if (a === '--log-skip') opts.logSkip = true;
  }

  if (cmd === 'check-live') {
    const pids = findLivePids(opts.path || '', { procRoot: opts.procRoot });
    if (pids.length > 0 && opts.logSkip) {
      logWorktreeRemoval({
        remover: opts.remover || 'unknown',
        path: opts.path || '',
        branch: opts.branch || null,
        reason: opts.reason || 'live_process_cwd',
        lock: VALID_LOCKS.has(opts.lock) ? opts.lock : probeWorktreeLock(opts.path || ''),
        live_pids: pids,
        outcome: 'skipped',
      });
    }
    process.stdout.write(`${JSON.stringify(pids)}\n`);
    return pids.length > 0 ? 1 : 0;
  }

  if (cmd === 'log') {
    logWorktreeRemoval({
      remover: opts.remover || 'unknown',
      path: opts.path || '',
      branch: opts.branch || null,
      reason: opts.reason || '',
      lock: VALID_LOCKS.has(opts.lock) ? opts.lock : probeWorktreeLock(opts.path || ''),
      live_pids: parsePidArg(opts.livePids),
      outcome: opts.outcome || 'failed',
    });
    return 0;
  }

  return 2;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  MAX_LOG_BYTES,
  resolveRemovalLogPath,
  readProcCwds,
  findLivePids,
  probeWorktreeLock,
  logWorktreeRemoval,
};
