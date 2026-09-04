'use strict';

// scripts/lib/live-state-dir.js — Node twin of codeforge's src/live.rs (P1). Resolves the
// RAM-backed base directory the statusline live files live under, sanitises session ids the
// same way the writer does, reads a live file with schema/freshness checks, and classifies a
// model id into a "family" for guarded-model comparisons.
//
// Contract (plan §2.5, docs/plans/2026-09-05-statusline-live-context-feed.md):
//   - resolveLiveDir() tries, in order: $AUTOPILOT_LIVE_DIR (override) → $XDG_RUNTIME_DIR/autopilot
//     (xdg) → /dev/shm/autopilot-<uid> (shm) → /tmp/autopilot-<uid> (tmp). A candidate is accepted
//     ONLY if `findmnt -T <dir> -o FSTYPE -n` prints tmpfs or ramfs; if findmnt is not on PATH,
//     fall back to a longest-prefix match against /proc/mounts; if neither settles it the
//     candidate is rejected. A rejected override is skipped, not fatal — later candidates are
//     still tried. If every candidate is rejected, the base is ~/.autopilot (SSD) and exactly one
//     warning line is printed. resolveLiveDir() returns a BASE only — every consumer appends its
//     own purpose segment (`context/`, `context-budget/`, …).
//   - sanitizeSessionId(s): replace every Unicode scalar not in [A-Za-z0-9_-] with one `_` (per
//     scalar — a multi-byte character yields exactly one `_`), keep the first 64 scalars, empty
//     input ⇒ 'unknown'. This is the writer/reader contract for the live-file name.
//   - readLive(base, sid, {kind, nowMs, maxAgeMs}): returns the parsed live file (main or tasks)
//     iff it exists, parses as JSON, carries integer schema_version 1, and its `written_at` is no
//     older than maxAgeMs (default 120000ms). Anything else ⇒ null (treated as absent — silence
//     is never a gate pass).
//   - modelFamily(id): lowercase id must match ^claude-([a-z]+)-[0-9]+(-[0-9]+)*(\[[a-z0-9]+\])?$;
//     group 1 is the family, else 'unknown' (unknown never blocks a guarded-model check).
//
// Exit semantics: this module never calls process.exit — it is a pure library. Callers (hooks)
// own fail-open behaviour; every function here either returns a value or returns null/'unknown'
// on any malformed input, never throws on expected-bad input (a thrown error means a caller bug).
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync: nodeExecSync } = require('child_process');

const RAM_FSTYPES = new Set(['tmpfs', 'ramfs']);
const DEFAULT_MAX_AGE_MS = 120000;
const MODEL_ID_RE = /^claude-([a-z]+)-[0-9]+(?:-[0-9]+)*(?:\[[a-z0-9]+\])?$/;

function uid() {
  try {
    if (typeof process.getuid === 'function') return process.getuid();
  } catch { /* platform without getuid (e.g. Windows) */ }
  return 0;
}

// Walk up to the nearest existing ancestor — `findmnt -T` needs a real path to stat, but the
// purpose-suffixed candidate directory (e.g. /dev/shm/autopilot-1000) may not exist yet.
function nearestExistingAncestor(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(d)) return d;
    const parent = path.dirname(d);
    if (parent === d) return d;
    d = parent;
  }
}

function commandAvailable(execSyncFn, cmd) {
  try {
    execSyncFn(`command -v ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function fstypeViaFindmnt(dir, execSyncFn) {
  const target = nearestExistingAncestor(dir);
  try {
    const out = execSyncFn(`findmnt -T ${JSON.stringify(target)} -o FSTYPE -n`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.trim().split('\n')[0] || '';
    return line.trim() || null;
  } catch {
    return null; // findmnt ran but the candidate is not a resolvable mount point ⇒ reject
  }
}

// /proc/mounts fallback: longest-prefix match of the candidate path against every mountpoint.
// Text-based on purpose (a synthetic fixture in tests need not exist on real disk).
function fstypeViaProcMounts(dir, procMountsPath) {
  let content;
  try {
    content = fs.readFileSync(procMountsPath || '/proc/mounts', 'utf8');
  } catch {
    return null;
  }
  const target = path.resolve(dir);
  let best = null;
  let bestLen = -1;
  for (const line of content.split('\n')) {
    const parts = line.split(' ');
    if (parts.length < 3) continue;
    const mp = parts[1].replace(/\\040/g, ' ');
    const isPrefix = mp === '/' || target === mp || target.startsWith(mp.endsWith('/') ? mp : `${mp}/`);
    if (isPrefix && mp.length > bestLen) {
      bestLen = mp.length;
      best = parts[2];
    }
  }
  return best;
}

function isRamBacked(dir, ctx) {
  const fstype = ctx.findmntAvailable
    ? fstypeViaFindmnt(dir, ctx.execSync)
    : fstypeViaProcMounts(dir, ctx.procMountsPath);
  return !!fstype && RAM_FSTYPES.has(fstype);
}

/**
 * Resolve the live-state base directory. Returns {base, source} where source is one of
 * 'override' | 'xdg' | 'shm' | 'tmp' | 'ssd-fallback'.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] — defaults to process.env
 * @param {Function} [opts.execSync] — defaults to child_process.execSync (injectable for tests)
 * @param {string} [opts.procMountsPath] — defaults to /proc/mounts (injectable for tests)
 * @param {Function} [opts.warn] — defaults to a single process.stderr.write call
 */
function resolveLiveDir(opts = {}) {
  const env = opts.env || process.env;
  const execSync = opts.execSync || nodeExecSync;
  const procMountsPath = opts.procMountsPath;
  const warn = typeof opts.warn === 'function'
    ? opts.warn
    : (msg) => { try { process.stderr.write(`${msg}\n`); } catch { /* ignore */ } };

  const ctx = { execSync, procMountsPath, findmntAvailable: commandAvailable(execSync, 'findmnt') };

  const candidates = [];
  if (env.AUTOPILOT_LIVE_DIR) candidates.push({ dir: env.AUTOPILOT_LIVE_DIR, source: 'override' });
  if (env.XDG_RUNTIME_DIR) candidates.push({ dir: path.join(env.XDG_RUNTIME_DIR, 'autopilot'), source: 'xdg' });
  candidates.push({ dir: `/dev/shm/autopilot-${uid()}`, source: 'shm' });
  candidates.push({ dir: `/tmp/autopilot-${uid()}`, source: 'tmp' });

  for (const c of candidates) {
    if (isRamBacked(c.dir, ctx)) return { base: c.dir, source: c.source };
  }

  // Every candidate rejected (a rejected override is skipped, not fatal — we simply fall
  // through to here like any other all-rejected run). Never assume a path is RAM.
  warn('autopilot: no RAM-backed live-state directory found (findmnt/proc-mounts rejected every '
    + 'candidate); falling back to ~/.autopilot (SSD). Set AUTOPILOT_LIVE_DIR to override.');
  return { base: path.join(os.homedir(), '.autopilot'), source: 'ssd-fallback' };
}

/**
 * Sanitise a raw session id the same way the writer (codeforge src/live.rs) does: replace
 * every Unicode scalar value not in [A-Za-z0-9_-] with one '_', keep the first 64 scalars,
 * empty input ⇒ 'unknown'.
 */
function sanitizeSessionId(raw) {
  const str = typeof raw === 'string' ? raw : '';
  if (str.length === 0) return 'unknown';
  const scalars = Array.from(str); // one element per Unicode code point (handles surrogate pairs)
  const kept = scalars.slice(0, 64).map((ch) => (/^[A-Za-z0-9_-]$/.test(ch) ? ch : '_')).join('');
  return kept.length > 0 ? kept : 'unknown';
}

/**
 * Read one live file (main or tasks) for a session, honouring the schema-version and
 * freshness contract. Returns the parsed object, or null if absent/stale/malformed/wrong
 * schema — callers treat null as "no live signal", falling back to their own inference path.
 *
 * @param {string} base — the resolved live-state BASE (from resolveLiveDir().base)
 * @param {string} sid — sanitised session id
 * @param {object} [opts]
 * @param {'main'|'tasks'} [opts.kind='main']
 * @param {number} [opts.nowMs] — defaults to Date.now()
 * @param {number} [opts.maxAgeMs=120000]
 */
function readLive(base, sid, opts = {}) {
  const kind = opts.kind === 'tasks' ? 'tasks' : 'main';
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const fileName = kind === 'tasks' ? `${sid}.tasks.json` : `${sid}.json`;
  const file = path.join(base, 'context', fileName);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // absent
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null; // malformed
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!Number.isInteger(obj.schema_version) || obj.schema_version !== 1) return null;
  const writtenMs = typeof obj.written_at === 'string' ? Date.parse(obj.written_at) : NaN;
  if (!Number.isFinite(writtenMs)) return null;
  if (nowMs - writtenMs > maxAgeMs) return null; // stale ⇒ absent, silence is never a gate pass
  return obj;
}

/**
 * Classify a model id into its family for guarded_models comparisons. Lowercases first;
 * anything not matching the grammar ⇒ 'unknown' (never blocks).
 */
function modelFamily(id) {
  if (typeof id !== 'string' || id.length === 0) return 'unknown';
  const m = MODEL_ID_RE.exec(id.toLowerCase());
  return m ? m[1] : 'unknown';
}

module.exports = {
  resolveLiveDir,
  sanitizeSessionId,
  readLive,
  modelFamily,
  DEFAULT_MAX_AGE_MS,
};
