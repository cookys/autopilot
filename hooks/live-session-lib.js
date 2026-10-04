/**
 * live-session-lib — shared helpers for the two per-session live-state writers
 * (session-tasks.js -> <live>/tasks/<sid>.json, awaiting-owner.js -> <live>/attention/<sid>.json).
 *
 * Not a hook (excluded from the hook inventory by the `-lib.js` suffix). Built-ins only.
 *
 * Contract: nothing here throws on expected-bad input; callers wrap main() in try/catch and
 * exit 0 (fail-open). The file base is scripts/lib/live-state-dir.js resolveLiveDir() — tests
 * point AUTOPILOT_LIVE_DIR at a /dev/shm temp dir, never the operator's real one.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
const { withWriteLock } = require('../scripts/lib/jsonl-store.js');

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// A knob is OFF for the literal values `off`, `false`, `0`, `no` (case-insensitive).
function knobOff(envName) {
  const v = process.env[envName];
  if (typeof v !== 'string') return false;
  return ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

// Hook payloads always carry session_id. Without one there is nothing to key a file by, so the
// writers do nothing (no cwd/pid fallback: a wrong-keyed file is worse than no file).
function sessionFile(payload, purpose) {
  const raw = payload && typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!raw) return null;
  const { base } = resolveLiveDir();
  return path.join(base, purpose, `${sanitizeSessionId(raw)}.json`);
}

function readJsonFile(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Per-file writer serialisation with the repo's lock primitive (scripts/lib/jsonl-store.js:
// PID lock file + stale-holder breaker). Concurrent hook processes (parallel TaskCreate calls
// arrive ~0.1 s apart) must not lose each other's read-modify-write. A lock timeout throws; the
// caller's fail-open catch turns that into one stderr line + exit 0.
function withLock(file, fn) {
  const dir = path.dirname(file);
  return withWriteLock({ storeDir: dir, lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, fn);
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
}

// project_key via the CLI-side derivation only (mods plan §2.8); null outside a git repo.
// Lazy-required: loading task-runtime costs ~40 ms and most events never need it.
function projectKeyFor(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  try {
    const { scopeFromCwd } = require('../src/status/project-key.js');
    return scopeFromCwd(cwd).project_key || null;
  } catch {
    return null;
  }
}

function failOpen(name, e) {
  try { process.stderr.write(`${name}: fail-open: ${e && e.message ? e.message : e}\n`); } catch { /* ignore */ }
}

module.exports = {
  readStdinJson,
  knobOff,
  sessionFile,
  readJsonFile,
  withLock,
  atomicWriteJson,
  removeFile,
  projectKeyFor,
  failOpen,
};
