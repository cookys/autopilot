'use strict';
/**
 * account-audit.js — append-only, alias-only audit log for the G37 account layer
 * (plan project/plans/2026-11-03-g37-account-switching.md section 5.6) plus the
 * reader/renderer behind `claude-account.js status`.
 *
 * File: $XDG_STATE_HOME/autopilot/accounts-audit.jsonl (default ~/.local/state/autopilot/),
 * mode 0600, written with O_APPEND. One line per attempt, exactly these keys:
 *   ts, ts_local, alias, purpose, attempt, outcome
 * No quota class, used fraction, run id or mode is ever written. The writer rejects an
 * extra key, an unknown outcome, a bad purpose, any value containing a live token
 * (caller-supplied `tokens`) and any value matching `sk-ant-`.
 * Human views render Taipei time (UTC+8).
 *
 * Exports: AUDIT_KEYS OUTCOMES PRE_ATTEMPT_OUTCOMES auditPath validateRecord
 *          formatTaipei buildRecord appendAudit readAudit renderStatus
 * Built-ins only, Node >= 20.10.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIT_KEYS = ['ts', 'ts_local', 'alias', 'purpose', 'attempt', 'outcome'];
const OUTCOMES = [
  'ok', 'rate_limited', 'auth_failed', 'child_error', 'timeout', 'other_failure',
  'token_scrubbed', 'all_tight', 'all_limited', 'no_account', 'invalid_config',
  'quota_schema_unsupported', 'mode_off',
];
// Outcomes that may occur before an alias is chosen (alias "-", attempt 0).
const PRE_ATTEMPT_OUTCOMES = ['no_account', 'invalid_config', 'all_limited', 'mode_off'];
// Outcomes that can only occur before an alias is chosen: alias "-" is mandatory.
const ALWAYS_PRE_ATTEMPT = ['no_account', 'invalid_config', 'mode_off'];

const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const PURPOSE_RE = /^[a-z0-9-]{1,32}$/;
const TOKEN_SHAPE_RE = /sk-ant-/i;
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

function auditPath(env, homedir) {
  const e = env || process.env;
  const base = e.XDG_STATE_HOME && path.isAbsolute(e.XDG_STATE_HOME)
    ? e.XDG_STATE_HOME
    : path.join(homedir || os.userInfo().homedir, '.local', 'state');
  return path.join(base, 'autopilot', 'accounts-audit.jsonl');
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }

/** Epoch ms -> `YYYY-MM-DDTHH:MM:SS.mmm+08:00` (Taipei, UTC+8). */
function formatTaipei(ms) {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    + `.${pad(d.getUTCMilliseconds(), 3)}+08:00`;
}

function liveTokens(tokens) {
  return (Array.isArray(tokens) ? tokens : [tokens]).filter((t) => typeof t === 'string' && t.length > 0);
}

/** Validate a full record (all six keys). Returns {ok:true} or {ok:false, reason}. */
function validateRecord(rec, opts) {
  const tokens = liveTokens(opts && opts.tokens);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, reason: 'not_object' };
  for (const k of Object.keys(rec)) {
    if (!AUDIT_KEYS.includes(k)) return { ok: false, reason: `extra_key:${k}` };
  }
  for (const k of AUDIT_KEYS) {
    if (!(k in rec)) return { ok: false, reason: `missing_key:${k}` };
  }
  if (!Number.isSafeInteger(rec.ts) || rec.ts < 0) return { ok: false, reason: 'bad_ts' };
  if (typeof rec.ts_local !== 'string' || rec.ts_local !== formatTaipei(rec.ts)) return { ok: false, reason: 'bad_ts_local' };
  if (typeof rec.outcome !== 'string' || !OUTCOMES.includes(rec.outcome)) return { ok: false, reason: 'unknown_outcome' };
  if (typeof rec.purpose !== 'string' || !PURPOSE_RE.test(rec.purpose)) return { ok: false, reason: 'bad_purpose' };
  if (!Number.isSafeInteger(rec.attempt) || rec.attempt < 0 || rec.attempt > 99) return { ok: false, reason: 'bad_attempt' };
  if (typeof rec.alias !== 'string') return { ok: false, reason: 'bad_alias' };
  if (rec.alias === '-') {
    if (rec.attempt !== 0) return { ok: false, reason: 'pre_attempt_needs_attempt_0' };
    if (!PRE_ATTEMPT_OUTCOMES.includes(rec.outcome)) return { ok: false, reason: 'pre_attempt_alias_on_attempt_outcome' };
  } else {
    if (!ALIAS_RE.test(rec.alias)) return { ok: false, reason: 'bad_alias' };
    if (rec.attempt < 1) return { ok: false, reason: 'alias_needs_attempt_ge_1' };
    if (ALWAYS_PRE_ATTEMPT.includes(rec.outcome)) return { ok: false, reason: 'pre_attempt_outcome_needs_dash_alias' };
  }
  for (const k of AUDIT_KEYS) {
    const v = rec[k];
    if (typeof v !== 'string') continue;
    if (TOKEN_SHAPE_RE.test(v)) return { ok: false, reason: `token_shape_in:${k}` };
    for (const t of tokens) if (v.includes(t)) return { ok: false, reason: `token_in:${k}` };
  }
  return { ok: true };
}

/** Build a full record from caller input {alias,purpose,attempt,outcome}; extra keys throw. */
function buildRecord(input, now) {
  if (!input || typeof input !== 'object') throw new Error('audit: input must be an object');
  const allowed = ['alias', 'purpose', 'attempt', 'outcome'];
  for (const k of Object.keys(input)) {
    if (!allowed.includes(k)) throw new Error(`audit: rejected extra key ${k}`);
  }
  const ts = Number.isSafeInteger(now) ? now : Date.now();
  return {
    ts, ts_local: formatTaipei(ts),
    alias: input.alias, purpose: input.purpose, attempt: input.attempt, outcome: input.outcome,
  };
}

/**
 * Validate then append one line. opts: {path, env, homedir, now, tokens}.
 * Throws (nothing written) when the record is rejected. Returns the written record.
 */
function appendAudit(input, opts) {
  const o = opts || {};
  const rec = buildRecord(input, o.now);
  const v = validateRecord(rec, { tokens: o.tokens });
  if (!v.ok) throw new Error(`audit: rejected record (${v.reason})`);
  const file = o.path || auditPath(o.env, o.homedir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    if ((fs.fstatSync(fd).mode & 0o077) !== 0) throw new Error('audit: file mode is not 0600');
    fs.writeSync(fd, JSON.stringify(rec) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return rec;
}

/**
 * Read the log. Lines that are not valid records are counted in `invalid` and never
 * returned, so a tampered line cannot reach `status` output. ENOENT -> empty.
 */
function readAudit(file, opts) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { records: [], invalid: 0 };
    throw e;
  }
  const records = [];
  let invalid = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { invalid++; continue; }
    if (validateRecord(rec, opts).ok) records.push(rec); else invalid++;
  }
  return { records, invalid };
}

/** Render the last `limit` records (default 20) as Taipei-time lines, from validated fields only. */
function renderStatus(result, opts) {
  const limit = (opts && opts.limit) || 20;
  const lines = [];
  for (const r of result.records.slice(-limit)) {
    const t = formatTaipei(r.ts).replace('T', ' ').replace(/\.\d+\+08:00$/, ' +08:00');
    lines.push(`${t} alias=${r.alias} purpose=${r.purpose} attempt=${r.attempt} outcome=${r.outcome}`);
  }
  if (result.invalid > 0) lines.push(`(${result.invalid} unreadable audit line(s) skipped)`);
  return lines;
}

module.exports = {
  AUDIT_KEYS, OUTCOMES, PRE_ATTEMPT_OUTCOMES, auditPath, validateRecord,
  formatTaipei, buildRecord, appendAudit, readAudit, renderStatus,
};
