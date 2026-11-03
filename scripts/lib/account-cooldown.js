'use strict';

// scripts/lib/account-cooldown.js — local 429 cooldown store (plan 5.3, 5.4).
// One file per alias under <live_base>/accounts/cooldown/<alias>.json (0600 in a 0700 dir), holding
// only {schema, alias, cooldown_until_ms, written_at_ms}. The live base is resolved by
// live-state-dir.js unless the caller injects `dir`.
//
// Cooldown end = earliest future resets_at among the tight windows (seconds), else now + default
// minutes (accounts.cooldown_default_minutes, default 30).
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readSmallFile } = require('./account-quota');

const SCHEMA = 'autopilot.account-cooldown/1';
const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const DEFAULT_MINUTES = 30;
const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function cooldownDir(opts) {
  const o = opts || {};
  if (o.dir) return o.dir;
  const { resolveLiveDir } = require('./live-state-dir');
  return path.join(resolveLiveDir(), 'accounts', 'cooldown');
}

function computeUntil(args) {
  const a = args || {};
  const nowMs = typeof a.nowMs === 'number' ? a.nowMs : Date.now();
  const mins = Number.isFinite(a.defaultMinutes) && a.defaultMinutes > 0 ? a.defaultMinutes : DEFAULT_MINUTES;
  const future = (Array.isArray(a.tightResets) ? a.tightResets : [])
    .filter((s) => Number.isFinite(s) && s * 1000 > nowMs)
    .map((s) => s * 1000);
  if (future.length > 0) return Math.min(...future);
  return nowMs + mins * 60 * 1000;
}

function writeCooldown(alias, untilMs, opts) {
  if (!ALIAS_RE.test(String(alias))) throw new Error('invalid alias');
  if (!Number.isFinite(untilMs)) throw new Error('invalid cooldown_until_ms');
  const o = opts || {};
  const dir = cooldownDir(o);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('cooldown dir is not a plain directory');
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error('cooldown dir has a foreign owner');
  if ((st.mode & 0o777) !== 0o700) throw new Error('cooldown dir mode must be 0700');
  const body = JSON.stringify({
    schema: SCHEMA, alias, cooldown_until_ms: Math.trunc(untilMs),
    written_at_ms: typeof o.nowMs === 'number' ? o.nowMs : Date.now(),
  });
  const file = path.join(dir, alias + '.json');
  const tmp = path.join(dir, alias + '.json.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeSync(fd, body + '\n');
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
  return file;
}

// Returns cooldown_until_ms, or null when absent/unusable. Unusable files count as absent here:
// a cooldown is a capacity hint, never an authority. Values beyond now + 7 days are clamped.
function readCooldown(alias, opts) {
  if (!ALIAS_RE.test(String(alias))) return null;
  const o = opts || {};
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : Date.now();
  const r = readSmallFile(path.join(cooldownDir(o), alias + '.json'), 1024, o);
  if (!r.text) return null;
  try {
    const j = JSON.parse(r.text);
    if (!j || j.schema !== SCHEMA || j.alias !== alias || !Number.isFinite(j.cooldown_until_ms)) return null;
    return Math.min(j.cooldown_until_ms, nowMs + MAX_COOLDOWN_MS);
  } catch (_) { return null; }
}

// Map alias -> cooldown_until_ms for aliases with a cooldown file (expired ones included; the picker compares to now).
function readAllCooldowns(aliases, opts) {
  const out = {};
  for (const a of aliases) {
    const v = readCooldown(a, opts);
    if (v !== null) out[a] = v;
  }
  return out;
}

function isCooling(untilMs, nowMs) {
  return Number.isFinite(untilMs) && untilMs > nowMs;
}

function clearCooldown(alias, opts) {
  if (!ALIAS_RE.test(String(alias))) throw new Error('invalid alias');
  try { fs.unlinkSync(path.join(cooldownDir(opts), alias + '.json')); return true; } catch (_) { return false; }
}

module.exports = {
  SCHEMA, DEFAULT_MINUTES, MAX_COOLDOWN_MS, cooldownDir, computeUntil, writeCooldown, readCooldown, readAllCooldowns, isCooling, clearCooldown,
};
