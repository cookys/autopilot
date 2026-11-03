'use strict';

// scripts/lib/account-observation.js — G40 contract `fleet.quota/1`: build, validate, the one clamp
// boundary, and the mirror view file IO (plan project/plans/2026-11-03-g40-agent-lane-quota.md 6, 20.2,
// 21.2, 21.6, 21.8, 22.2, 18.4, 5.4).
//
// Pure parts: clampUtilization, buildRecord, validateRecord, hasMsKey. IO parts: mirrorPath, readView,
// readNamespaceBinding, writeLocalRow. Nothing here interprets windows into a class (that is the pure
// merge of D2) and nothing talks to a hub.
//
// Units (section 6): observed_at, resets_at, token_state_at, token_issued_at, token_expires_at,
// refusal.observed_at, refusal.retry_at are epoch SECONDS, integers; one above 1e11 is a millisecond value
// and is rejected `unit_magnitude`. utilization is a fraction in [0, 1]. A received value in (1, 1.5] is
// clamped to 1 with `clamped: true` (clampUtilization is the only place that happens); above 1.5 or below
// 0 is rejected. A stored record with utilization > 1 is rejected by every reader.
//
// Results never echo an unvalidated string: a rejection carries a short fixed reason code only.
// Mirror path: <live_dir>/quota/<provider>/<alias>.json, 0600 in a 0700 directory made through
// runtime-paths.js ensurePrivateDir; <live_dir> is the caller's resolveLiveDir() base (liveDirOrNull below).
// Writers touch only their own row, under <alias>.lock (O_EXCL; reclaimed only from a dead holder or after 120 s; 2 s wait).
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { readSmallFile } = require('./account-quota');
const { ensurePrivateDir } = require('./runtime-paths');
const { resolveLiveDir, LiveDirRefusedError } = require('./live-state-dir');

const SCHEMA = 'fleet.quota/1';
const VIEW_SCHEMA = 'fleet.quota-view/1';
const NAMESPACE_SCHEMA = 'fleet.quota-ns/1';

// Age and tight constants (MAX_AGE_S, FUTURE_SKEW_S, TIGHT_THRESHOLD) live only in account-interpret.js; this file
// holds just the validator's own limits.
const EPOCH_MAX_S = 1e11; // above this an epoch field is a millisecond value
const CLAMP_MAX = 1.5; // received utilization above this is almost surely an unconverted 0..100 value

const WINDOW_KINDS = Object.freeze(['rolling_5h', 'weekly', 'daily', 'monthly', 'credits', 'rpm', 'tpm']);
const WINDOW_SOURCES = Object.freeze(['passive', 'endpoint', 'probe', 'estimated']);
const UNITS = Object.freeze(['requests', 'tokens', 'credits']);
const VISIBILITY = Object.freeze(['L0', 'L1', 'L2', 'L3']);
const TOKEN_STATES = Object.freeze(['ok', 'invalid', 'unknown']);
const REFUSAL_REASONS = Object.freeze(['rate_limit', 'quota', 'other']);
// Q21 (ruled): the record-level `source` is a CLOSED enum. Adding a value bumps the contract version.
const RECORD_SOURCES = Object.freeze(['registry']);
const MAX_WINDOWS = 7;

// String patterns (the hub's, N39; host_role/namespace/courier are assumptions, see the report).
const PROVIDER_RE = /^[a-z0-9-]{1,24}$/;
const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const HOST_ROLE_RE = /^[a-z0-9_-]{1,24}$/;
const NAMESPACE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const COURIER_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const LOCAL_COURIER = 'local';

const RECORD_KEYS = Object.freeze([
  'schema', 'provider', 'alias', 'visibility', 'windows', 'refusal', 'token_state', 'token_state_at',
  'host_role', 'token_issued_at', 'token_expires_at', 'source',
]);
const WINDOW_KEYS = Object.freeze([
  'kind', 'utilization', 'used', 'limit', 'unit', 'remaining', 'resets_at', 'source', 'observed_at', 'clamped',
]);
const REFUSAL_KEYS = Object.freeze(['observed_at', 'retry_at', 'reason']);
const VIEW_KEYS = Object.freeze(['schema', 'namespace', 'hub_offset', 'rows']);
const ROW_KEYS = Object.freeze(['writer_courier', 'host_role', 'observed_at_hub', 'skewed', 'record']);
// Spellings that belong to another contract (21.5) or to the frame / connection, never to the record (N38, N39).
const FORBIDDEN_KEYS = new Set(['pct', 'resetsAt', 'five_hour', 'seven_day', 'namespace', 'writer_courier', 'sent_at', 'hub_offset']);
const MS_KEY_RE = /(^|_)ms$/;

const VIEW_MAX_BYTES = 65536;
const LOCK_WAIT_MS = 2000;
const LOCK_HARD_MAX_MS = 120000; // a lock older than this is reclaimable even if its pid answers (pid reuse)
const CORRUPT_KEEP = 3;
const LOCK_POLL_MS = 25;

// Token shapes (two layers, as account-audit.js: shapes here, caller-supplied live tokens via opts.secrets).
// PREFIX shapes name a token by how it starts; TOKEN_SHAPES adds the long-opaque-string rule, which is only right
// for fields whose grammar is already short (a courier id such as ns/courier/member may legitimately pass 40 chars).
const TOKEN_PREFIX_SHAPES = Object.freeze([/sk-ant-/i, /\bsk-[A-Za-z0-9_-]{20,}/, /FAKE-/, /\bBearer\s+\S/i]);
const TOKEN_SHAPES = Object.freeze([...TOKEN_PREFIX_SHAPES, /[A-Za-z0-9_+/=-]{40,}/]);

function bad(reason) { return { ok: false, code: 'quota_invalid', reason }; }
function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; }

// --- the one clamp boundary ----------------------------------------------------------------------

// Received utilization -> stored utilization. (1, 1.5] -> 1 + clamped; above 1.5, below 0, NaN, non-number: rejected.
function clampUtilization(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, reason: 'utilization_type' };
  if (raw < 0 || raw > CLAMP_MAX) return { ok: false, reason: 'utilization_range' };
  if (raw > 1) return { ok: true, value: 1, clamped: true };
  return { ok: true, value: raw, clamped: false };
}

// --- validation ----------------------------------------------------------------------------------

function keyProblem(k, allowed) {
  if (FORBIDDEN_KEYS.has(k)) return `forbidden_key:${k}`;
  if (MS_KEY_RE.test(k)) return 'forbidden_key:_ms';
  if (!allowed.includes(k)) return 'unknown_key';
  return null;
}

// null when fine, else a reason. nullable: null/undefined allowed.
function epochProblem(x, nullable) {
  if (x === null || x === undefined) return nullable ? null : 'epoch_missing';
  if (typeof x !== 'number' || !Number.isFinite(x)) return 'epoch_type';
  if (x > EPOCH_MAX_S) return 'unit_magnitude';
  if (!Number.isInteger(x)) return 'epoch_not_integer';
  if (x < 0) return 'epoch_negative';
  return null;
}

function scanTokenShape(v, secrets, depth, shapes) {
  const sh = shapes || TOKEN_SHAPES;
  if (depth > 8) return true; // fail closed: content nested deeper than any record is refused, never waved through
  if (typeof v === 'string') {
    if (sh.some((re) => re.test(v))) return true;
    return secrets.some((s) => typeof s === 'string' && s.length > 0 && v.includes(s));
  }
  if (Array.isArray(v)) return v.some((x) => scanTokenShape(x, secrets, depth + 1, sh));
  if (isObj(v)) return Object.keys(v).some((k) => scanTokenShape(k, secrets, depth + 1, sh) || scanTokenShape(v[k], secrets, depth + 1, sh));
  return false;
}

// True when any key at any depth is a millisecond spelling (`*_ms`, `observed_at_ms`). Static-scan helper (N49).
function hasMsKey(v, depth) {
  const d = depth || 0;
  if (d > 8) return false;
  if (Array.isArray(v)) return v.some((x) => hasMsKey(x, d + 1));
  if (isObj(v)) return Object.keys(v).some((k) => MS_KEY_RE.test(k) || hasMsKey(v[k], d + 1));
  return false;
}

function nonNegNumber(x) { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }

function windowProblem(w) {
  if (!isObj(w)) return 'window_not_object';
  for (const k of Object.keys(w)) { const p = keyProblem(k, WINDOW_KEYS); if (p) return p; }
  if (!WINDOW_KINDS.includes(w.kind)) return 'window_kind';
  if (!WINDOW_SOURCES.includes(w.source)) return 'window_source';
  let p = epochProblem(w.observed_at, false);
  if (p) return `observed_at:${p}`;
  if (!has(w, 'resets_at') && w.resets_at !== null) return 'resets_at_missing';
  p = epochProblem(w.resets_at, true);
  if (p) return `resets_at:${p}`;
  // `clamped` is set only by clampUtilization: true, and only on a window stored at exactly 1 (N50).
  if (has(w, 'clamped') && !(w.clamped === true && w.utilization === 1)) return 'clamped_invalid';

  const used = w.used === undefined ? null : w.used;
  const limit = w.limit === undefined ? null : w.limit;
  const unit = w.unit === undefined ? null : w.unit;
  const remaining = w.remaining === undefined ? null : w.remaining;
  if ((used === null) !== (limit === null)) return 'used_limit_pair';
  if (used !== null && (!nonNegNumber(used) || !nonNegNumber(limit))) return 'used_limit_type';
  if (unit !== null && !UNITS.includes(unit)) return 'unit_enum';
  if ((used !== null || remaining !== null) && unit === null) return 'unit_required';
  if (remaining !== null) {
    if (w.kind !== 'credits') return 'remaining_kind';
    if (!nonNegNumber(remaining)) return 'remaining_type';
    if (used !== null && Math.abs(remaining - (limit - used)) > 1e-9) return 'remaining_mismatch';
  }
  const u = w.utilization;
  if (u === null) {
    // 21.2 shape (b): a remaining-only credits balance is the ONLY place a null utilization is legal.
    const remainingOnly = w.kind === 'credits' && remaining !== null && used === null && limit === null && unit !== null;
    if (!remainingOnly) return 'utilization_null';
  } else {
    if (typeof u !== 'number' || !Number.isFinite(u)) return 'utilization_type';
    if (u < 0 || u > 1) return 'utilization_range';
    if (remaining !== null && used === null) return 'remaining_only_needs_null_utilization';
  }
  return null;
}

function refusalProblem(r) {
  if (!isObj(r)) return 'refusal_not_object';
  for (const k of Object.keys(r)) { if (!REFUSAL_KEYS.includes(k)) return 'refusal_key'; }
  let p = epochProblem(r.observed_at, false);
  if (p) return `refusal.observed_at:${p}`;
  p = epochProblem(r.retry_at, true);
  if (p) return `refusal.retry_at:${p}`;
  if (!REFUSAL_REASONS.includes(r.reason)) return 'refusal_reason';
  return null;
}

// validateRecord(rec, opts) -> { ok: true } | { ok: false, code: 'quota_invalid', reason }.
// opts: { provider, alias } the key the record was found under (a mismatch is `provider_mismatch`, N24);
//       secrets: [live token values] (any occurrence anywhere is `token_shaped`, N2).
function validateRecord(rec, opts) {
  const o = opts || {};
  if (!isObj(rec)) return bad('not_object');
  if (scanTokenShape(rec, Array.isArray(o.secrets) ? o.secrets : [], 0, TOKEN_SHAPES)) return bad('token_shaped');
  for (const k of Object.keys(rec)) { const p = keyProblem(k, RECORD_KEYS); if (p) return bad(p); }
  if (rec.schema !== SCHEMA) return bad('schema');
  if (typeof rec.provider !== 'string' || !PROVIDER_RE.test(rec.provider)) return bad('provider');
  if (typeof rec.alias !== 'string' || !ALIAS_RE.test(rec.alias)) return bad('alias');
  if (o.provider !== undefined && rec.provider !== o.provider) return bad('provider_mismatch');
  if (o.alias !== undefined && rec.alias !== o.alias) return bad('alias_mismatch');
  if (!VISIBILITY.includes(rec.visibility)) return bad('visibility');
  if (has(rec, 'host_role') && (typeof rec.host_role !== 'string' || !HOST_ROLE_RE.test(rec.host_role))) return bad('host_role');
  if (!Array.isArray(rec.windows) || rec.windows.length > MAX_WINDOWS) return bad('windows');
  const kinds = new Set();
  for (const w of rec.windows) {
    const p = windowProblem(w);
    if (p) return bad(p);
    if (kinds.has(w.kind)) return bad('window_kind_duplicate');
    kinds.add(w.kind);
  }

  const hasRefusal = rec.refusal !== null && rec.refusal !== undefined;
  if (hasRefusal) {
    const p = refusalProblem(rec.refusal);
    if (p) return bad(p);
    if (rec.visibility === 'L0') return bad('refusal_needs_L1'); // a visible refusal is by definition level 1 (N77)
  }

  const state = has(rec, 'token_state') ? rec.token_state : 'unknown';
  if (!TOKEN_STATES.includes(state)) return bad('token_state');
  const stateAt = rec.token_state_at === undefined ? null : rec.token_state_at;
  const sp = epochProblem(stateAt, true);
  if (sp) return bad(`token_state_at:${sp}`);
  if (state === 'unknown' && stateAt !== null) return bad('token_state_at_with_unknown');
  if (state !== 'unknown' && stateAt === null) return bad('token_state_at_required');
  for (const k of ['token_issued_at', 'token_expires_at']) {
    const p = epochProblem(rec[k], true);
    if (p) return bad(`${k}:${p}`);
  }

  // Record-level `source` (21.6, Q21, N89): closed enum, only on shape (a).
  const hasSource = rec.source !== undefined;
  if (hasSource && !(typeof rec.source === 'string' && RECORD_SOURCES.includes(rec.source))) return bad('record_source_unknown');

  if (rec.windows.length > 0) {
    if (hasSource) return bad('source_not_allowed');
    return { ok: true };
  }
  // Empty `windows` is valid in exactly the shapes of 21.6, and only with L0 or L1 (N77).
  if (rec.visibility === 'L2' || rec.visibility === 'L3') return bad('empty_windows_visibility');
  if (hasRefusal) { // (b), possibly combined with (c)
    if (hasSource) return bad('source_not_allowed');
  } else if (state === 'ok' || state === 'invalid') { // (c)
    if (hasSource) return bad('source_not_allowed');
  } else { // (a) placeholder: never observed
    if (!hasSource) return bad('empty_windows_shape');
    if (rec.visibility !== 'L0') return bad('placeholder_needs_L0');
  }
  return { ok: true };
}

// buildRecord(input) -> { ok: true, record } | { ok: false, code, reason }.
// input is a record whose window utilizations are RAW received values: each goes through clampUtilization
// (the single boundary; `clamped: true` is set here and nowhere else). Unknown keys are passed through on
// purpose so the validator rejects them (N38: never silently renamed or dropped).
function buildRecord(input, opts) {
  if (!isObj(input)) return bad('not_object');
  const windows = [];
  for (const w of Array.isArray(input.windows) ? input.windows : []) {
    if (!isObj(w)) return bad('window_not_object');
    const out = Object.assign({}, w);
    delete out.clamped; // never carried in: derived at this boundary only
    if (w.utilization !== null && w.utilization !== undefined) {
      const c = clampUtilization(w.utilization);
      if (!c.ok) return bad(c.reason);
      out.utilization = c.value;
      if (c.clamped) out.clamped = true;
    }
    windows.push(out);
  }
  const record = Object.assign({ schema: SCHEMA, refusal: null, token_state: 'unknown', token_state_at: null }, input, { windows });
  const v = validateRecord(record, opts);
  return v.ok ? { ok: true, record } : v;
}

// --- mirror paths --------------------------------------------------------------------------------

function checkNames(liveDir, provider, alias) {
  if (typeof liveDir !== 'string' || !path.isAbsolute(liveDir)) throw new TypeError('liveDir must be an absolute path');
  if (typeof provider !== 'string' || !PROVIDER_RE.test(provider)) throw new TypeError('provider outside its grammar');
  if (alias !== undefined && (typeof alias !== 'string' || !ALIAS_RE.test(alias))) throw new TypeError('alias outside its grammar');
}

function mirrorDir(liveDir, provider) {
  checkNames(liveDir, provider);
  return path.join(liveDir, 'quota', provider);
}

function mirrorPath(liveDir, provider, alias) {
  checkNames(liveDir, provider, alias);
  return path.join(liveDir, 'quota', provider, `${alias}.json`);
}

function namespacePath(liveDir) {
  if (typeof liveDir !== 'string' || !path.isAbsolute(liveDir)) throw new TypeError('liveDir must be an absolute path');
  return path.join(liveDir, 'quota', 'namespace.json');
}

// The <live_dir> base (the autopilot resolver, never re-implemented), or null when the resolver refuses it.
function liveDirOrNull(opts) {
  try { return resolveLiveDir(opts || {}).base; } catch (e) {
    if (e instanceof LiveDirRefusedError) return null;
    throw e;
  }
}

// --- view read ------------------------------------------------------------------------------------

// Parse one view file object into { view, note, row_notes } without IO. Invalid rows are dropped and named in
// row_notes so a reader can filter; a bad view as a whole is { view: null, note }.
function parseView(j, key, secrets) {
  if (!isObj(j)) return { view: null, note: 'quota_invalid', row_notes: [] };
  if (j.schema !== VIEW_SCHEMA) return { view: null, note: 'quota_schema_unsupported', row_notes: [] };
  for (const k of Object.keys(j)) if (!VIEW_KEYS.includes(k)) return { view: null, note: 'quota_invalid', row_notes: [] };
  const namespace = j.namespace === undefined ? null : j.namespace;
  if (namespace !== null && !(typeof namespace === 'string' && NAMESPACE_RE.test(namespace))) return { view: null, note: 'quota_invalid', row_notes: [] };
  const hubOffset = j.hub_offset === undefined ? 0 : j.hub_offset;
  if (typeof hubOffset !== 'number' || !Number.isFinite(hubOffset)) return { view: null, note: 'quota_invalid', row_notes: [] };
  if (!Array.isArray(j.rows)) return { view: null, note: 'quota_invalid', row_notes: [] };
  const rows = [];
  const notes = [];
  const seen = new Set();
  for (const r of j.rows) {
    const label = isObj(r) && typeof r.writer_courier === 'string' && COURIER_RE.test(r.writer_courier) ? r.writer_courier : null;
    const reason = rowProblem(r, key, seen, secrets);
    if (reason) { notes.push({ writer_courier: label, note: reason }); continue; }
    seen.add(r.writer_courier);
    rows.push({
      writer_courier: r.writer_courier,
      host_role: has(r, 'host_role') ? r.host_role : (has(r.record, 'host_role') ? r.record.host_role : null),
      observed_at_hub: r.observed_at_hub === undefined ? null : r.observed_at_hub,
      skewed: r.skewed === true,
      record: r.record,
    });
  }
  return { view: { schema: VIEW_SCHEMA, namespace, hub_offset: hubOffset, rows }, note: null, row_notes: notes };
}

function rowProblem(r, key, seen, secrets) {
  if (!isObj(r)) return 'row_not_object';
  const sec = Array.isArray(secrets) ? secrets : [];
  if (scanTokenShape(Object.assign({}, r, { record: null }), sec, 0, TOKEN_PREFIX_SHAPES)) return 'token_shaped';
  for (const k of Object.keys(r)) if (!ROW_KEYS.includes(k)) return 'row_key';
  if (typeof r.writer_courier !== 'string' || !COURIER_RE.test(r.writer_courier)) return 'writer_courier';
  if (seen.has(r.writer_courier)) return 'duplicate_writer';
  if (has(r, 'host_role') && r.host_role !== null && (typeof r.host_role !== 'string' || !HOST_ROLE_RE.test(r.host_role))) return 'host_role';
  const p = epochProblem(r.observed_at_hub, true);
  if (p) return `observed_at_hub:${p}`;
  if (has(r, 'skewed') && typeof r.skewed !== 'boolean') return 'skewed';
  const v = validateRecord(r.record, Object.assign({}, key, { secrets: sec }));
  return v.ok ? null : v.reason;
}

// readView(liveDir, provider, alias, opts) -> { view, note, row_notes }
//   view null + note null: no file (absent).  view null + note: unusable file (quota_invalid | quota_unreadable |
//   quota_schema_unsupported).  Otherwise view is the normalised view and row_notes names every dropped row
//   ({ writer_courier, note }): a stored utilization above 1, a provider mismatch and the like (N24, N50).
function readView(liveDir, provider, alias, opts) {
  const file = mirrorPath(liveDir, provider, alias);
  const r = readSmallFile(file, VIEW_MAX_BYTES, opts);
  if (r.absent) return { view: null, note: null, row_notes: [] };
  if (r.error) return { view: null, note: r.error === 'invalid' ? 'quota_invalid' : 'quota_unreadable', row_notes: [] };
  let j;
  try { j = JSON.parse(r.text); } catch (_) { return { view: null, note: 'quota_invalid', row_notes: [] }; }
  return parseView(j, { provider, alias }, opts && opts.secrets);
}

// readNamespaceBinding(liveDir) -> { namespace: string|null, note: string|null }. Absent is null with no note.
function readNamespaceBinding(liveDir, opts) {
  const r = readSmallFile(namespacePath(liveDir), 1024, opts);
  if (r.absent) return { namespace: null, note: null };
  if (r.error) return { namespace: null, note: r.error === 'invalid' ? 'quota_invalid' : 'quota_unreadable' };
  let j;
  try { j = JSON.parse(r.text); } catch (_) { return { namespace: null, note: 'quota_invalid' }; }
  if (!isObj(j) || j.schema !== NAMESPACE_SCHEMA) return { namespace: null, note: 'quota_schema_unsupported' };
  if (Object.keys(j).some((k) => k !== 'schema' && k !== 'namespace')) return { namespace: null, note: 'quota_invalid' };
  if (!(typeof j.namespace === 'string' && NAMESPACE_RE.test(j.namespace))) return { namespace: null, note: 'quota_invalid' };
  return { namespace: j.namespace, note: null };
}

// --- view write (the local row only) -----------------------------------------------------------------

function defaultSleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function newNonce() { return `${process.pid}.${Math.random().toString(36).slice(2, 12)}.${Date.now()}`; }

// { nonce, pid, ino } of the lock file as it is now, or null.
function readLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const st = fs.fstatSync(fd);
      let j = null;
      try { j = JSON.parse(fs.readFileSync(fd, 'utf8')); } catch (_) { /* empty or half-written */ }
      return { nonce: isObj(j) && typeof j.nonce === 'string' ? j.nonce : null, pid: isObj(j) && Number.isInteger(j.pid) ? j.pid : null, ino: st.ino, mtimeMs: st.mtimeMs };
    } finally { fs.closeSync(fd); }
  } catch (_) { return null; }
}

// ESRCH means the process is gone; EPERM means it exists (another user). Same-host only, which a /run/user lock is.
function pidGone(pid) {
  try { process.kill(pid, 0); return false; } catch (e) { return !!(e && e.code === 'ESRCH'); }
}

// true when WE still hold it: same nonce AND same inode as when we took it.
function holdsLock(lockPath, held) {
  const cur = readLock(lockPath);
  return !!cur && cur.nonce === held.nonce && cur.ino === held.ino;
}

// Takes the lock with O_EXCL and writes { pid, nonce, t } into it. A lock is reclaimed only when its holder is GONE
// (process.kill(pid, 0) says ESRCH) or when it is older than the hard cap (hardMaxMs, default 120 s: pid reuse).
// A live holder is waited for; waitMs without getting it is `busy` (null). Reclaiming renames the lock to a unique
// name (atomic: one reclaimer wins) and checks the renamed file is the lock that was judged dead; if it is a
// different lock it is put back under its own name (link, never overwriting), and if the name is taken the renamed
// file is left in place and reported through o.log. Returns { nonce, ino } or null.
// opts: { now() -> ms, sleep(ms), waitMs, hardMaxMs, log(msg), hooks: { beforeReclaim(), beforePublish() } } (hooks are test seams).
function acquireLock(lockPath, o) {
  const now = o.now || Date.now;
  const sleep = o.sleep || defaultSleep;
  const waitMs = o.waitMs === undefined ? LOCK_WAIT_MS : o.waitMs;
  const hardMaxMs = o.hardMaxMs === undefined ? LOCK_HARD_MAX_MS : o.hardMaxMs;
  const nonce = newNonce();
  const deadline = now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, nonce, t: now() }));
        return { nonce, ino: fs.fstatSync(fd).ino };
      } finally { fs.closeSync(fd); }
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
    const judged = readLock(lockPath);
    if (!judged) continue; // released while we looked
    const reclaimable = (judged.pid !== null && pidGone(judged.pid)) || now() - judged.mtimeMs > hardMaxMs;
    if (reclaimable) {
      if (o.hooks && typeof o.hooks.beforeReclaim === 'function') o.hooks.beforeReclaim();
      const moved = `${lockPath}.stale.${nonce}`;
      try { fs.renameSync(lockPath, moved); } catch (e) {
        if (e && e.code === 'ENOENT') continue; // another reclaimer won
        throw e;
      }
      const got = readLock(moved);
      if (got && got.nonce === judged.nonce && got.ino === judged.ino) { try { fs.unlinkSync(moved); } catch (_) { /* ignore */ } continue; }
      try { fs.linkSync(moved, lockPath); fs.unlinkSync(moved); } catch (_) {
        if (typeof o.log === 'function') o.log(`lock moved aside and left in place: ${path.basename(moved)}`);
      }
    }
    if (now() >= deadline) return null;
    sleep(LOCK_POLL_MS);
  }
}

function releaseLock(lockPath, held) {
  if (held && holdsLock(lockPath, held)) { try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ } }
}

// The view envelope keys a writer understands; anything else means a newer writer made the file.
function envelopeKnown(j) { return Object.keys(j).every((k) => VIEW_KEYS.includes(k)); }

// Fail closed over the whole view about to be written. Every value gets the full TOKEN_SHAPES (peer records are
// written back raw) EXCEPT a courier id (`writer_courier`), which gets the prefix shapes only: a legitimate
// ns/courier/member id can pass 40 characters. secrets are matched at every depth; too deep is a hit.
function viewHasToken(view, secrets) {
  const full = (v) => scanTokenShape(v, secrets, 0, TOKEN_SHAPES);
  for (const k of Object.keys(view)) {
    if (full(k)) return true;
    if (k !== 'rows') { if (full(view[k])) return true; continue; }
    if (!Array.isArray(view.rows)) return true;
    for (const r of view.rows) {
      if (!isObj(r)) { if (full(r)) return true; continue; }
      for (const rk of Object.keys(r)) {
        if (full(rk)) return true;
        if (rk === 'writer_courier' ? scanTokenShape(r[rk], secrets, 0, TOKEN_PREFIX_SHAPES) : full(r[rk])) return true;
      }
    }
  }
  return false;
}

// Row basis B (5.2 rule 1): the largest stamp in the record, or null when it has none.
function basisOf(rec) {
  const s = [];
  if (isObj(rec) && Array.isArray(rec.windows)) for (const w of rec.windows) if (isObj(w) && Number.isFinite(w.observed_at)) s.push(w.observed_at);
  if (isObj(rec) && isObj(rec.refusal) && Number.isFinite(rec.refusal.observed_at)) s.push(rec.refusal.observed_at);
  if (isObj(rec) && Number.isFinite(rec.token_state_at)) s.push(rec.token_state_at);
  return s.length ? Math.max(...s) : null;
}

// Keeps the newest CORRUPT_KEEP copies of a damaged view, deletes older ones.
function pruneCorrupt(dir, prefix) {
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)); } catch (_) { return; }
  const ts = (n) => Number((/^\.?(\d+)/.exec(n.slice(prefix.length)) || [0, 0])[1]);
  names.sort((a, b) => ts(b) - ts(a) || (a < b ? 1 : -1));
  for (const n of names.slice(CORRUPT_KEEP)) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) { /* ignore */ } }
}

// Copies the damaged file (at most VIEW_MAX_BYTES, then a marker) to <file>.corrupt.<ts>[.<nonce>], 0600.
function keepCorrupt(file, dir, base) {
  let src;
  try { src = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch (_) { return false; }
  try {
    const size = fs.fstatSync(src).size;
    const n = Math.min(size, VIEW_MAX_BYTES);
    const buf = Buffer.alloc(n);
    const got = fs.readSync(src, buf, 0, n, 0);
    const body = size > VIEW_MAX_BYTES ? Buffer.concat([buf.subarray(0, got), Buffer.from(`\n[truncated by the mirror writer: ${size} bytes in the original]\n`)]) : buf.subarray(0, got);
    const stem = `${file}.corrupt.${Math.floor(Date.now() / 1000)}`;
    for (const name of [stem, `${stem}.${newNonce()}`]) { // a same-second clash gets a nonce tail, never a failure
      try {
        const fd = fs.openSync(name, 'wx', 0o600);
        try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, body); } finally { fs.closeSync(fd); }
        pruneCorrupt(dir, `${base}.corrupt.`);
        return true;
      } catch (e) { if (!e || e.code !== 'EEXIST') return false; }
    }
    return false;
  } catch (_) { return false; } finally { fs.closeSync(src); }
}

// writeLocalRow(liveDir, record, opts) -> { ok: true, path, reset, superseded? } | { ok: false, code, reason? }
// Read-modify-write of ONLY the row tagged opts.courier (default `local`). Every other row, the namespace and
// hub_offset are written back as the raw parsed JSON found on disk (an invalid peer row stays; readers ignore it).
// The whole view about to be written is scanned, fail closed (viewHasToken, opts.secrets): a hit refuses the write.
// A newer schema or an unknown top-level key refuses the write (view_unsupported); only unparseable JSON is
// replaced, after the damaged bytes are kept as <alias>.json.corrupt.<ts> (0600, newest 3 kept).
// Monotonic guard: just before publishing, the file is read again; if its local row already carries a newer basis
// than the one being written (or this record has none and the file's does), nothing is overwritten and the result is
// { ok: true, superseded: true }: not an error.
// Codes: quota_invalid, live_dir_refused, dir_refused, target_invalid, view_unsupported, mirror_lock_busy,
// view_too_large, write_failed.
// opts: { courier, secrets, now, sleep, waitMs, hardMaxMs, log, hooks }.
function writeLocalRow(liveDir, record, opts) {
  const o = opts || {};
  const courier = o.courier === undefined ? LOCAL_COURIER : o.courier;
  const secrets = Array.isArray(o.secrets) ? o.secrets : [];
  if (typeof liveDir !== 'string' || !path.isAbsolute(liveDir)) return { ok: false, code: 'live_dir_refused' };
  if (typeof courier !== 'string' || !COURIER_RE.test(courier)) return bad('courier');
  if (scanTokenShape(courier, secrets, 0, TOKEN_PREFIX_SHAPES)) return bad('token_shaped');
  const v = validateRecord(record, { secrets });
  if (!v.ok) return v;

  const dir = mirrorDir(liveDir, record.provider);
  const file = mirrorPath(liveDir, record.provider, record.alias);
  const made = ensurePrivateDir(dir);
  if (!made.ok) return { ok: false, code: 'dir_refused', reason: made.reason };
  let st = null;
  try { st = fs.lstatSync(file); } catch (e) { if (!e || e.code !== 'ENOENT') return { ok: false, code: 'target_invalid', reason: 'unreadable' }; }
  if (st && st.isSymbolicLink()) return { ok: false, code: 'target_invalid', reason: 'symlink' };
  if (st && !st.isFile()) return { ok: false, code: 'target_invalid', reason: 'not_regular_file' };

  const lockPath = path.join(dir, `${record.alias}.lock`);
  let held;
  try { held = acquireLock(lockPath, o); } catch (_) { return { ok: false, code: 'write_failed', reason: 'lock' }; }
  if (!held) return { ok: false, code: 'mirror_lock_busy' };
  let tmp = null;
  try {
    let view = { schema: VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [] };
    let reset = false;
    const cur = readSmallFile(file, VIEW_MAX_BYTES);
    if (cur.error === 'unreadable') return { ok: false, code: 'target_invalid', reason: 'unreadable' };
    let damaged = cur.error === 'invalid';
    if (cur.text !== undefined) {
      let j = null;
      try { j = JSON.parse(cur.text); } catch (_) { damaged = true; }
      if (!damaged) {
        if (!isObj(j)) damaged = true;
        else if (j.schema !== VIEW_SCHEMA || !envelopeKnown(j)) return { ok: false, code: 'view_unsupported', reason: j.schema !== VIEW_SCHEMA ? 'schema' : 'unknown_key' };
        else if (!Array.isArray(j.rows)) damaged = true;
        else view = Object.assign({ namespace: null, hub_offset: 0 }, j);
      }
    }
    if (damaged) {
      if (st && !keepCorrupt(file, dir, `${record.alias}.json`)) return { ok: false, code: 'write_failed', reason: 'corrupt_copy' };
      view = { schema: VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [] };
      reset = true;
    }
    const row = {
      writer_courier: courier,
      host_role: has(record, 'host_role') ? record.host_role : null,
      observed_at_hub: null, // the local row is judged by the local clock (22.2)
      skewed: false,
      record,
    };
    const at = view.rows.findIndex((r) => isObj(r) && r.writer_courier === courier);
    if (at >= 0) view.rows[at] = row; else view.rows.push(row);
    if (viewHasToken(view, secrets)) return bad('token_shaped');
    const text = `${JSON.stringify(view)}\n`;
    if (Buffer.byteLength(text) > VIEW_MAX_BYTES) return { ok: false, code: 'view_too_large' };

    tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
    if (o.hooks && typeof o.hooks.beforePublish === 'function') o.hooks.beforePublish();
    if (!holdsLock(lockPath, held)) return { ok: false, code: 'mirror_lock_busy' }; // lost the lock: do not publish
    // monotonic guard: never replace a newer local observation with an older one, whatever raced
    const now2 = readSmallFile(file, VIEW_MAX_BYTES);
    if (now2.text !== undefined) {
      let j2 = null;
      try { j2 = JSON.parse(now2.text); } catch (_) { /* damaged: nothing newer to protect */ }
      const prev = isObj(j2) && Array.isArray(j2.rows) ? j2.rows.find((r) => isObj(r) && r.writer_courier === courier) : null;
      const pb = prev ? basisOf(prev.record) : null;
      const nb = basisOf(record);
      if (pb !== null && (nb === null || pb > nb)) return { ok: true, path: file, reset: false, superseded: true };
    }
    fs.renameSync(tmp, file);
    tmp = null;
    return { ok: true, path: file, reset };
  } catch (_) {
    return { ok: false, code: 'write_failed' };
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
    releaseLock(lockPath, held);
  }
}

module.exports = {
  SCHEMA, VIEW_SCHEMA, NAMESPACE_SCHEMA,
  EPOCH_MAX_S, CLAMP_MAX,
  WINDOW_KINDS, WINDOW_SOURCES, UNITS, VISIBILITY, TOKEN_STATES, REFUSAL_REASONS, RECORD_SOURCES, LOCAL_COURIER,
  clampUtilization, buildRecord, validateRecord, hasMsKey, TOKEN_SHAPES, TOKEN_PREFIX_SHAPES,
  mirrorDir, mirrorPath, namespacePath, liveDirOrNull,
  parseView, readView, readNamespaceBinding, writeLocalRow,
};
