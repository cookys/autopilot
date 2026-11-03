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

const SCHEMA = 'autopilot.account-cooldown/1';
const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const DEFAULT_MINUTES = 30;

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
  const body = JSON.stringify({
    schema: SCHEMA, alias, cooldown_until_ms: Math.trunc(untilMs),
    written_at_ms: typeof o.nowMs === 'number' ? o.nowMs : Date.now(),
  });
  const file = path.join(dir, alias + '.json');
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, body + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

// Returns cooldown_until_ms, or null when absent/unusable. Unusable files count as absent here:
// a cooldown is a capacity hint, never an authority (token/config faults live in the registry).
function readCooldown(alias, opts) {
  if (!ALIAS_RE.test(String(alias))) return null;
  const file = path.join(cooldownDir(opts), alias + '.json');
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 1024) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!j || j.schema !== SCHEMA || j.alias !== alias || !Number.isFinite(j.cooldown_until_ms)) return null;
    return j.cooldown_until_ms;
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
  if (!ALIAS_RE.test(String(alias))) return false;
  try { fs.unlinkSync(path.join(cooldownDir(opts), alias + '.json')); return true; } catch (_) { return false; }
}

module.exports = {
  SCHEMA, DEFAULT_MINUTES, cooldownDir, computeUntil, writeCooldown, readCooldown, readAllCooldowns, isCooling, clearCooldown,
};
