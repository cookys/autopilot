#!/usr/bin/env node
'use strict';
// kimi-quota-observe.js - kimi has no usage subcommand, so quota is learned from dispatch results.
// A kimi dispatch whose output shows a rate limit or exhausted quota records an exhausted observation
// ({pool:"kimi", state:"exhausted", reset_at, observed_at, source:"dispatch_error"}); a later clean kimi run
// records "available". Store: the fleet.quota/1 mirror the quota adapters write (account-observation.js,
// <live_dir>/quota/kimi/default.json); pace-select reads it (exhaustedKimi) and will not pick an exhausted pool
// before its reset. Mapping: exhausted -> refusal{observed_at, retry_at: reset_at|null, reason}; available ->
// token_state ok at observed_at, no refusal. Patterns (the repo had none for kimi): HTTP 429, "rate limit",
// "too many requests" -> rate_limit; "quota", "usage limit", "insufficient balance" -> quota.
// retry_at unknown (no parsable reset): treated as exhausted for UNKNOWN_RESET_TTL_S (60 min) after observed_at.
// Node built-ins plus account-observation.js. Never writes a token, only the verdict.
//   CLI: observe --rc N --log-file F   (best effort, always exit 0)   |   exhausted  (exit 3 when exhausted now)

const fs = require('fs');
const obs = require('./account-observation');

const PROVIDER = 'kimi';
const ALIAS = 'default';
const UNKNOWN_RESET_TTL_S = 3600;
const RATE_RE = /\b429\b|rate[ _-]?limit|too many requests/i;
const QUOTA_RE = /quota|usage[ _-]?limit|insufficient (?:balance|credit)|limit (?:reached|exceeded)/i;
const UNITS = { s: 1, sec: 1, second: 1, m: 60, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600, d: 86400, day: 86400 };

function parseResetAt(text, nowS) {
  let m = /retry[- ]after:?\s*(\d+)\b/i.exec(text) || /(?:try again|retry|resets?|available again) in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i.exec(text);
  if (m) {
    const unit = m[2] ? UNITS[m[2].toLowerCase().replace(/s$/, '')] || UNITS[m[2].toLowerCase()] : 1;
    return nowS + Math.ceil(Number(m[1]) * (unit || 1));
  }
  m = /(?:resets?|try again|retry)(?: at| after| on)?\s*:?\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(text);
  if (m) {
    const t = Date.parse(/Z|[+-]\d{2}:?\d{2}$/.test(m[1]) ? m[1].replace(' ', 'T') : `${m[1].replace(' ', 'T')}Z`);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
  }
  return null;
}

// -> { state:'exhausted', reason, reset_at } | { state:'available' } | null (unrelated failure: no observation)
function classify(rc, text, nowS) {
  const t = String(text || '');
  if (RATE_RE.test(t) || QUOTA_RE.test(t)) {
    return { state: 'exhausted', reason: RATE_RE.test(t) && !QUOTA_RE.test(t) ? 'rate_limit' : 'quota', reset_at: parseResetAt(t, nowS) };
  }
  return Number(rc) === 0 ? { state: 'available' } : null;
}

function record(c, nowS) {
  const base = { schema: obs.SCHEMA, provider: PROVIDER, alias: ALIAS, visibility: 'L1', windows: [] };
  if (c.state === 'exhausted') {
    return Object.assign(base, { refusal: { observed_at: nowS, retry_at: c.reset_at, reason: c.reason } });
  }
  return Object.assign(base, { refusal: null, token_state: 'ok', token_state_at: nowS });
}

// observe({rc, text, liveDir, now}) -> { wrote, state, code? }
function observe({ rc, text, verdict, liveDir, now, env = process.env } = {}) {
  const nowS = Math.floor((now === undefined ? Date.now() : now) / 1000);
  const dir = liveDir || obs.liveDirOrNull({ env });
  if (!dir) return { wrote: false, code: 'live_dir_unavailable' };
  const c = verdict === undefined ? classify(rc, text, nowS)
    : verdict === 'stopped_billing' ? { state: 'exhausted', reason: 'quota', reset_at: nowS + UNKNOWN_RESET_TTL_S }
      : verdict === 'done' ? { state: 'available' } : null;
  if (!c) return { wrote: false, state: null };
  const b = obs.buildRecord(record(c, nowS));
  if (!b.ok) return { wrote: false, state: c.state, code: b.code };
  const w = obs.writeLocalRow(dir, b.record, {});
  return { wrote: w.ok === true, state: c.state, code: w.ok ? undefined : w.code, reset_at: c.reset_at };
}

// True when the stored local row is a refusal whose reset has not passed (or, with no reset, within the TTL).
function exhaustedKimi({ liveDir, now, env } = {}) {
  const nowS = Math.floor((now === undefined ? Date.now() : now) / 1000);
  let dir = liveDir;
  try { dir = dir || obs.liveDirOrNull({ env: env || process.env }); } catch { return false; }
  if (!dir) return false;
  const r = obs.readView(dir, PROVIDER, ALIAS, {});
  if (!r.view) return false;
  return r.view.rows.some((row) => {
    const rf = row.record && row.record.refusal;
    if (!rf) return false;
    return rf.retry_at !== null && rf.retry_at !== undefined ? rf.retry_at > nowS : rf.observed_at + UNKNOWN_RESET_TTL_S > nowS;
  });
}

function main(argv) {
  const a = {};
  for (let i = 1; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (argv[0] === 'observe') {
    let text = '';
    try { text = fs.readFileSync(a['log-file'], 'utf8').slice(-65536); } catch { /* no log: classify on rc alone */ }
    try { observe({ rc: a.rc, text }); } catch { /* best effort: never fail a dispatch over bookkeeping */ }
    return 0;
  }
  if (argv[0] === 'exhausted') return exhaustedKimi() ? 3 : 0;
  process.stderr.write('usage: kimi-quota-observe.js observe --rc N --log-file F | exhausted\n');
  return 64;
}

module.exports = { PROVIDER, ALIAS, UNKNOWN_RESET_TTL_S, classify, parseResetAt, record, observe, exhaustedKimi };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
