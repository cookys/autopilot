#!/usr/bin/env node
'use strict';

// scripts/quota-provider-sync.js — G40 provider quota adapters for the env-token endpoints (minimax, glm).
// Sibling of quota-reporter.js (the claude statusline adapter): one GET against the provider's quota endpoint,
// converted ONCE into a `fleet.quota/1` row and written to the local mirror through observation.writeLocalRow.
// No hub, no resident process, no retry. A failure is a result object with a fixed reason code, never an exception,
// and the token never appears in a result, an error or the output.
//
//   node scripts/quota-provider-sync.js sync-provider --provider minimax|glm [--alias NAME]
//   2xx success writes an L3 row with token_state 'ok' and token_state_at in epoch seconds; HTTP 401 writes an
//   empty-windows L1 row with token_state 'invalid' and returns reason `token_invalid` (exit 1); other non-2xx: `http_status`.
//   exit 0 = a row was written or is already current (`wrote` / `superseded`); 1 = nothing written (reason code on stderr); 2 = usage.
//
//   syncProvider(provider, o)  async -> { provider, alias, wrote, reason, shape?, tightest?, assumed? }
//   convertMinimax(json, nowMs[, secret]) / convertGlm(json, nowMs[, secret])  pure -> { ok, windows, shape, tightest? } | { ok: false, reason, shape }
//   watchFirstUsed5h(result, { liveDir, env, nowMs, send }) -> { fired: true, sent } | { fired: false, reason? }
//   Result `shape` (on the result and main() output, never in the record; token-free and value-free):
//     glm:     { limits: [{ type, unit, number, used_window: 'rolling_5h'|'weekly'|null, dropped: 'expired'|'fields_missing'|null,
//                           keys: (string|null)[], missing: ('percentage'|'nextResetTime')[],
//                           pct_from: 'currentValue'|'remaining'|null, reset_assumed: boolean, pct_positive: boolean }, ...] }
//              (one entry per data.limits[] item; type/unit/number copied only when string/number; keys lists up to 16 sorted own
//              key names and never values; strings and key names are scrubbed before slicing to 32 chars; missing lists whichever of
//              ['percentage','nextResetTime'] is absent or not a finite number; pct_positive is true only on rolling_5h/weekly
//              TOKENS_LIMIT candidates whose given-or-derived percentage is finite > 0, including when dropped fields_missing)
//     minimax: { models: <count of model_remains>, dropped: { rolling_5h: 'expired'|null, weekly: 'expired'|null } }
//     An entry/window is `expired` when dropped because resets_at is in the past.
//
// Endpoint facts (probed by the PM; the field semantics marked ASSUMED are not confirmed by documentation):
//   minimax  GET https://www.minimax.io/v1/token_plan/remains   Authorization: Bearer <token>
//     model_remains[] carries current_interval_remaining_percent (+ end_time) for the 5 h window and
//     current_weekly_remaining_percent (+ weekly_end_time) for the week. ASSUMED: remaining is a percentage 0..100,
//     so used = 1 - remaining/100; end_time may be epoch ms (above 1e11) and is converted to seconds. usage_count and
//     total_count are always 0 and are not read. Several model entries: the tightest (largest used) wins per window; the
//     record schema is closed, so winning model names return in the result as `tightest: { rolling_5h, weekly }`, not in the record.
//   glm      GET https://api.z.ai/api/monitor/usage/quota/limit   Authorization: <token> (NO Bearer; unpublished API)
//     data.limits[] of type TOKENS_LIMIT: unit 3 / number 5 is the rolling 5 h window, unit 6 / number 1 the week
//     (ASSUMED, unconfirmed; result carries `assumed: true`); percentage is ASSUMED 0..100 used; nextResetTime is epoch ms or s.
//     When `percentage` is not a finite number, `convertGlm` derives it only from finite `currentValue` + `usage` (> 0) or
//     finite `remaining` + `usage` (> 0), clamped to [0, 100] (`pct_from: 'currentValue'|'remaining'`); these fallback field
//     names are UNVERIFIED candidates, not confirmed provider fields. When `nextResetTime` is missing and the (given or derived)
//     percentage is 0, resets_at defaults to floor(now/1000) + window length (5 h / 7 d) with `reset_assumed: true`; for
//     percentage > 0 a missing reset stays `fields_missing`.
//   One-shot watch (`watchFirstUsed5h`, run by main() for glm whenever `result.shape` exists, whether wrote or failed):
//     the first time a glm rolling_5h entry (TOKENS_LIMIT, unit 3, number 5) has `pct_positive: true`, sends one Traditional
//     Chinese diagnostic paragraph per recipient via `<AUTOPILOT_FLEET_BIN||'fleet'> send <addr> <msg>` (30 s timeout, shape
//     fields only, never a token or response value) and records `<live_dir>/quota/glm/<alias>.first-used-5h.json` (0600,
//     `{ at, alias, entry }`) once every send exits 0. Recipients come from `AUTOPILOT_QUOTA_WATCH_TO` (comma-separated,
//     trimmed, empties dropped, e.g. `ns/courier/member`), else `AUTOPILOT_PM_ADDRESS`; missing recipients or a non-zero send
//     warns on stderr and leaves no marker so the next hourly run retries. Never alters main()'s stdout line or exit code.
// Every utilization goes through observation.clampUtilization: 1..1.5 clamps to 1, anything outside is rejected. Window
// source is `probe`, observed_at is request completion time in seconds, elapsed windows are dropped. Rate limit: newer of
// last ATTEMPT (`<alias>.attempt`, token-free, stamped before request) and mirror observed_at < 3600 s -> `too_soon`.
// Not itself a timer. A caller runs it (the opt-in quota-mirror user timer, before scheduling, or after a 429). The hourly cap still applies.
// Token: read from caller env (AUTOPILOT_ENDPOINT_<NAME>_TOKEN; for minimax also MINIMAX_API_KEY). Opens no secret file.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const observation = require('./lib/account-observation');
const { resolveLiveDir } = require('./lib/live-state-dir');
const { ensurePrivateDir } = require('./lib/runtime-paths');

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_INTERVAL_S = 3600; // one query per provider/alias per hour (PM): a calibration, not a poll
const MS_THRESHOLD = 1e11; // observation's EPOCH_MAX_S: above it a value is milliseconds

const PROVIDERS = Object.freeze({
  minimax: { url: 'https://www.minimax.io/v1/token_plan/remains', bearer: true, tokenEnv: ['AUTOPILOT_ENDPOINT_MINIMAX_TOKEN', 'MINIMAX_API_KEY'] },
  glm: { url: 'https://api.z.ai/api/monitor/usage/quota/limit', bearer: false, tokenEnv: ['AUTOPILOT_ENDPOINT_GLM_TOKEN'] },
});

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function num(x) { return typeof x === 'number' && Number.isFinite(x); }
function toEpochSeconds(x) { return Math.floor(x > MS_THRESHOLD ? x / 1000 : x); }
function sliceClean(s, max, secret) {
  const clean = scrubSecret(s, secret);
  return clean === null ? null : clean.slice(0, max);
}
function shapeVal(x, secret) {
  if (typeof x === 'string') return sliceClean(x, 32, secret);
  return num(x) ? x : null;
}

// remaining percent (0..100) -> raw used fraction; unit errors surface in clampUtilization, not here.
function usedFromRemainingPct(p) { return 1 - p / 100; }

function finish(byKind, nowMs, tightest) {
  const windows = [];
  const expired = { rolling_5h: null, weekly: null };
  let quotaInvalid = false;
  for (const kind of ['rolling_5h', 'weekly']) {
    const w = byKind[kind];
    if (!w) continue;
    if (w.resets_at * 1000 <= nowMs) { expired[kind] = 'expired'; continue; } // an elapsed window is not an observation of the present
    const c = observation.clampUtilization(w.used);
    if (!c.ok) { quotaInvalid = true; continue; }
    const win = { kind, utilization: c.value, resets_at: w.resets_at, source: 'probe', observed_at: Math.floor(nowMs / 1000) };
    if (c.clamped) win.clamped = true;
    windows.push(win);
  }
  if (quotaInvalid) return { ok: false, reason: 'quota_invalid', expired };
  if (Object.keys(byKind).length === 0) return { ok: false, reason: 'fields_missing', expired };
  if (windows.length === 0) return { ok: false, reason: 'quota_windows_expired', expired };
  return { ok: true, windows, tightest, expired };
}

function convertMinimax(j, nowMs, secret) {
  if (!isObj(j) || !Array.isArray(j.model_remains)) {
    return { ok: false, reason: 'fields_missing', shape: { models: 0, dropped: { rolling_5h: null, weekly: null } } };
  }
  const byKind = {};
  const tightest = {};
  const spec = [
    ['rolling_5h', 'current_interval_remaining_percent', 'end_time'],
    ['weekly', 'current_weekly_remaining_percent', 'weekly_end_time'],
  ];
  for (const m of j.model_remains) {
    if (!isObj(m)) continue;
    for (const [kind, remKey, endKey] of spec) {
      if (!num(m[remKey]) || !num(m[endKey])) continue;
      const used = usedFromRemainingPct(m[remKey]);
      if (!byKind[kind] || used > byKind[kind].used) {
        byKind[kind] = { used, resets_at: toEpochSeconds(m[endKey]) };
        tightest[kind] = typeof m.model_name === 'string' ? sliceClean(m.model_name, 64, secret) : null;
      }
    }
  }
  const f = finish(byKind, nowMs, tightest);
  const shape = { models: j.model_remains.length, dropped: f.expired };
  return f.ok ? { ok: true, windows: f.windows, tightest: f.tightest, shape } : { ok: false, reason: f.reason, shape };
}

const GLM_WINDOW_S = Object.freeze({ rolling_5h: 5 * 3600, weekly: 7 * 86400 });
const GLM_REQUIRED_FIELDS = Object.freeze(['percentage', 'nextResetTime']);
const GLM_MAX_KEYS = 16;

function ownNum(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k) && num(o[k]);
}

function clampPct(x) {
  const c = Math.min(100, Math.max(0, x));
  return c === 0 ? 0 : c;
}

function convertGlm(j, nowMs, secret) {
  if (!isObj(j) || !isObj(j.data) || !Array.isArray(j.data.limits)) {
    return { ok: false, reason: 'fields_missing', shape: { limits: [] } };
  }
  const byKind = {};
  const limits = [];
  const winnerIdx = {};
  for (const l of j.data.limits) {
    if (!isObj(l)) {
      limits.push({
        type: null, unit: null, number: null, used_window: null, dropped: null,
        keys: [], missing: GLM_REQUIRED_FIELDS.slice(), pct_from: null, reset_assumed: false, pct_positive: false,
      });
      continue;
    }
    const keys = Object.keys(l).sort().slice(0, GLM_MAX_KEYS).map((k) => sliceClean(k, 32, secret));
    const missing = GLM_REQUIRED_FIELDS.filter((k) => !ownNum(l, k));
    const entry = {
      type: shapeVal(l.type, secret), unit: shapeVal(l.unit, secret), number: shapeVal(l.number, secret),
      used_window: null, dropped: null, keys, missing, pct_from: null, reset_assumed: false, pct_positive: false,
    };
    limits.push(entry);
    if (l.type !== 'TOKENS_LIMIT') continue;
    let kind = null;
    if (l.unit === 3 && l.number === 5) kind = 'rolling_5h';
    else if (l.unit === 6 && l.number === 1) kind = 'weekly';
    if (kind === null) continue;
    entry.used_window = kind;
    let pct = null;
    if (ownNum(l, 'percentage')) {
      pct = l.percentage === 0 ? 0 : l.percentage;
    } else if (ownNum(l, 'currentValue') && ownNum(l, 'usage') && l.usage > 0) {
      pct = clampPct((l.currentValue / l.usage) * 100);
      entry.pct_from = 'currentValue';
    } else if (ownNum(l, 'remaining') && ownNum(l, 'usage') && l.usage > 0) {
      pct = clampPct(((l.usage - l.remaining) / l.usage) * 100);
      entry.pct_from = 'remaining';
    }
    if (pct === null) { entry.dropped = 'fields_missing'; continue; }
    if (pct > 0) entry.pct_positive = true;
    let resetsAt;
    if (ownNum(l, 'nextResetTime')) {
      resetsAt = toEpochSeconds(l.nextResetTime);
    } else if (pct === 0) {
      resetsAt = Math.floor(nowMs / 1000) + GLM_WINDOW_S[kind];
      entry.reset_assumed = true;
    } else {
      entry.dropped = 'fields_missing';
      continue;
    }
    if (winnerIdx[kind] !== undefined) limits[winnerIdx[kind]].used_window = null;
    winnerIdx[kind] = limits.length - 1;
    byKind[kind] = { used: pct === 0 ? 0 : pct / 100, resets_at: resetsAt, assumed: true };
  }
  const f = finish(byKind, nowMs, undefined);
  for (const kind of ['rolling_5h', 'weekly']) {
    if (f.expired[kind] && winnerIdx[kind] !== undefined) limits[winnerIdx[kind]].dropped = 'expired';
  }
  const shape = { limits };
  return f.ok ? { ok: true, windows: f.windows, shape } : { ok: false, reason: f.reason, shape };
}

const CONVERT = { minimax: convertMinimax, glm: convertGlm };

function scrubSecret(val, secret) {
  if (typeof secret !== 'string' || secret === '') return val;
  const prefix32 = secret.length > 32 ? secret.slice(0, 32) : null;
  if (typeof val === 'string') {
    if (val.includes(secret) || (prefix32 !== null && val.includes(prefix32))) return null;
    return val;
  }
  if (Array.isArray(val)) return val.map((x) => scrubSecret(x, secret));
  if (isObj(val)) {
    const o = {};
    for (const k of Object.keys(val)) o[k] = scrubSecret(val[k], secret);
    return o;
  }
  return val;
}

// Newest observed_at (epoch s) among the local row's windows, or null (no row, unreadable, no window). Never throws.
function lastObservedAt(liveDir, provider, alias) {
  try {
    const r = observation.readView(liveDir, provider, alias);
    if (!r || !r.view || !Array.isArray(r.view.rows)) return null;
    let best = null;
    for (const row of r.view.rows) {
      if (!isObj(row) || row.writer_courier !== observation.LOCAL_COURIER || !isObj(row.record)) continue;
      for (const w of row.record.windows || []) if (isObj(w) && num(w.observed_at) && (best === null || w.observed_at > best)) best = w.observed_at;
    }
    return best;
  } catch (_) { return null; }
}

function tokenOf(spec, env) {
  for (const name of spec.tokenEnv) {
    const v = env[name];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

// o: { alias, env, fetch, nowMs (function), liveDir, hostRole, timeoutMs (test seam) }. Never throws; the result carries no token.
async function syncProvider(provider, o) {
  const opts = o || {};
  const alias = typeof opts.alias === 'string' && opts.alias !== '' ? opts.alias : provider;
  const out = (wrote, reason, extra) => Object.assign({ provider, alias, wrote, reason }, extra || {});
  try {
    const spec = PROVIDERS[provider];
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) return out(false, 'provider_unknown');
    const env = opts.env || process.env;
    const token = tokenOf(spec, env);
    if (token === null) return out(false, 'token_missing');
    let liveDir = opts.liveDir;
    if (liveDir === undefined) {
      try { liveDir = resolveLiveDir({ env, warn: () => {} }).base; } catch (_) { return out(false, 'live_dir_refused'); }
    }
    // Rate limit (PM): at most one query per provider/alias per hour, judged from the mirror's own observed_at.
    const lastAt = lastObservedAt(liveDir, provider, alias);
    const startMs = typeof opts.nowMs === 'function' ? opts.nowMs() : Date.now();
    // The gate counts ATTEMPTS: claimAttempt stamps the attempt (no token) under the per-alias lock before any request,
    // so a failing endpoint or a missing mirror row cannot turn a poller into one query per call.
    const claim = observation.claimAttempt(liveDir, provider, alias, { nowMs: startMs, minIntervalS: MIN_INTERVAL_S, lastObservedAt: lastAt });
    if (!claim.ok) return out(false, typeof claim.code === 'string' ? claim.code : 'write_failed');
    if (!claim.claimed) return out(false, 'too_soon');
    const doFetch = opts.fetch || globalThis.fetch;
    let res;
    try {
      res = await doFetch(spec.url, {
        method: 'GET',
        headers: { Authorization: spec.bearer ? `Bearer ${token}` : token, Accept: 'application/json' },
        signal: AbortSignal.timeout(Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS),
      });
    } catch (_) { return out(false, 'request_failed'); }
    const nowMs = typeof opts.nowMs === 'function' ? opts.nowMs() : Date.now();
    if (res && res.status === 401) {
      // The provider rejected the token: record that (empty windows, L1, token_state invalid, seconds) so consumers see it is bad.
      const bad = { schema: observation.SCHEMA, provider, alias, visibility: 'L1', windows: [], refusal: null,
        token_state: 'invalid', token_state_at: Math.floor(nowMs / 1000) };
      if (typeof opts.hostRole === 'string' && opts.hostRole) bad.host_role = opts.hostRole;
      const bv = observation.validateRecord(bad, { provider, alias, secrets: [token] });
      if (!bv.ok) return out(false, 'quota_invalid');
      const bw = observation.writeLocalRow(liveDir, bad, { secrets: [token] });
      if (bw.ok !== true) return out(false, typeof bw.code === 'string' ? bw.code : 'write_failed');
      return out(false, 'token_invalid');
    }
    if (!res || typeof res.status !== 'number' || res.status < 200 || res.status > 299) return out(false, 'http_status');
    let json;
    try { json = await res.json(); } catch (_) { return out(false, 'json_invalid'); }
    const conv = CONVERT[provider](json, nowMs, token);
    const shape = scrubSecret(conv.shape, token);
    if (!conv.ok) return out(false, conv.reason, { shape });
    const record = {
      schema: observation.SCHEMA, provider, alias, visibility: 'L3', windows: conv.windows,
      refusal: null, token_state: 'ok', token_state_at: Math.floor(nowMs / 1000),
    };
    if (typeof opts.hostRole === 'string' && opts.hostRole) record.host_role = opts.hostRole;
    const v = observation.validateRecord(record, { provider, alias, secrets: [token] });
    if (!v.ok) return out(false, 'quota_invalid', { shape });
    const w = observation.writeLocalRow(liveDir, record, { secrets: [token] });
    const extra = provider === 'glm' ? { assumed: true, shape } : { tightest: scrubSecret(conv.tightest, token), shape };
    if (w.ok === true) return w.superseded ? out(false, 'superseded', extra) : out(true, null, extra);
    return out(false, typeof w.code === 'string' ? w.code : 'write_failed', { shape });
  } catch (_) { return out(false, 'sync_error'); }
}

const WATCH_TIMEOUT_MS = 30000;

function parseWatchList(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function watchRecipients(env) {
  const explicit = parseWatchList(env.AUTOPILOT_QUOTA_WATCH_TO);
  if (explicit.length > 0) return explicit;
  return parseWatchList(env.AUTOPILOT_PM_ADDRESS);
}

function cleanWatchEntry(e, secret) {
  const keys = Array.isArray(e.keys)
    ? e.keys.slice(0, GLM_MAX_KEYS).map((k) => (typeof k === 'string' ? sliceClean(k, 32, secret) : null))
    : [];
  const missing = Array.isArray(e.missing)
    ? e.missing.filter((k) => k === 'percentage' || k === 'nextResetTime')
    : [];
  const pctFrom = e.pct_from === 'currentValue' || e.pct_from === 'remaining' ? e.pct_from : null;
  const dropped = e.dropped === 'expired' || e.dropped === 'fields_missing' ? e.dropped : null;
  const usedWindow = e.used_window === 'rolling_5h' || e.used_window === 'weekly' ? e.used_window : null;
  return {
    type: 'TOKENS_LIMIT', unit: 3, number: 5,
    used_window: usedWindow, dropped, keys, missing,
    pct_from: pctFrom, reset_assumed: e.reset_assumed === true, pct_positive: true,
  };
}

function defaultWatchSend(addr, msg, env) {
  const childEnv = Object.assign({}, env);
  delete childEnv.FLEET_FYI;
  for (const p of Object.values(PROVIDERS)) {
    for (const k of p.tokenEnv) delete childEnv[k];
  }
  return spawnSync(env.AUTOPILOT_FLEET_BIN || 'fleet', ['send', addr, msg], {
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: WATCH_TIMEOUT_MS,
    env: childEnv,
  });
}

function sendExitedZero(r) {
  if (isObj(r)) return r.status === 0;
  if (typeof r === 'number') return r === 0;
  if (typeof r === 'boolean') return r === true;
  return false;
}

function writeWatchMarker(markerPath, payload) {
  const made = ensurePrivateDir(path.dirname(markerPath));
  if (!made.ok) return false;
  const tmp = `${markerPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  let fd = -1;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.fchmodSync(fd, 0o600);
    const body = `${JSON.stringify(payload)}\n`;
    fs.writeSync(fd, body, null, 'utf8');
    fs.closeSync(fd);
    fd = -1;
    fs.renameSync(tmp, markerPath);
    return true;
  } catch (_) {
    if (fd !== -1) { try { fs.closeSync(fd); } catch (_e) { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    return false;
  }
}

function watchFirstUsed5h(result, o) {
  const opts = isObj(o) ? o : {};
  try {
    if (!isObj(result) || !isObj(result.shape) || !Array.isArray(result.shape.limits)) return { fired: false };
    const rawEntry = result.shape.limits.find((e) => (
      isObj(e) && e.type === 'TOKENS_LIMIT' && e.unit === 3 && e.number === 5 && e.pct_positive === true
    ));
    if (!rawEntry) return { fired: false };
    const alias = typeof result.alias === 'string' && result.alias !== '' ? result.alias : 'glm';
    const env = opts.env || process.env;
    let liveDir = opts.liveDir;
    if (liveDir === undefined) {
      try { liveDir = resolveLiveDir({ env, warn: () => {} }).base; } catch (_) { return { fired: false, reason: 'live_dir_refused' }; }
    }
    let markerPath;
    try {
      const mirror = observation.mirrorPath(liveDir, 'glm', alias);
      markerPath = path.join(path.dirname(mirror), `${alias}.first-used-5h.json`);
    } catch (_) { return { fired: false, reason: 'live_dir_refused' }; }
    if (fs.existsSync(markerPath)) return { fired: false, reason: 'already' };
    const recipients = watchRecipients(env);
    if (recipients.length === 0) {
      process.stderr.write(`quota-watch glm/${alias}: no recipient configured (set AUTOPILOT_QUOTA_WATCH_TO or AUTOPILOT_PM_ADDRESS)\n`);
      return { fired: false, reason: 'no_recipient' };
    }
    const secret = tokenOf(PROVIDERS.glm, env);
    const entry = cleanWatchEntry(rawEntry, secret);
    const msg = `[quota-watch] GLM ${alias} rolling_5h 第一次出現 percentage>0：keys=${JSON.stringify(entry.keys)} missing=${JSON.stringify(entry.missing)} pct_from=${entry.pct_from} dropped=${entry.dropped} reset_assumed=${entry.reset_assumed}`;
    const customSend = typeof opts.send === 'function' ? opts.send : null;
    let allOk = true;
    for (const addr of recipients) {
      let sr;
      try { sr = customSend ? customSend(addr, msg) : defaultWatchSend(addr, msg, env); } catch (_) { sr = null; }
      if (!sendExitedZero(sr)) allOk = false;
    }
    if (!allOk) {
      process.stderr.write(`quota-watch glm/${alias}: fleet send failed; marker not written\n`);
      return { fired: false, reason: 'send_failed' };
    }
    const rawNow = typeof opts.nowMs === 'function' ? opts.nowMs() : (num(opts.nowMs) ? opts.nowMs : Date.now());
    const at = Math.floor(rawNow / 1000);
    if (!writeWatchMarker(markerPath, { at, alias, entry })) {
      process.stderr.write(`quota-watch glm/${alias}: marker write failed\n`);
      return { fired: false, reason: 'write_failed' };
    }
    return { fired: true, sent: recipients.length };
  } catch (_) { return { fired: false, reason: 'watch_error' }; }
}

async function main(argv, env) {
  const a = argv.slice();
  if (a.shift() !== 'sync-provider') { process.stderr.write('usage: quota-provider-sync.js sync-provider --provider minimax|glm [--alias NAME]\n'); return 2; }
  let provider = null; let alias;
  while (a.length) {
    const k = a.shift();
    if (k === '--provider') provider = a.shift();
    else if (k === '--alias') alias = a.shift();
    else { process.stderr.write(`quota-provider-sync: unknown argument\n`); return 2; }
  }
  if (!provider) { process.stderr.write('quota-provider-sync: --provider required\n'); return 2; }
  const r = await syncProvider(provider, { alias, env });
  if (provider === 'glm' && r && r.shape) watchFirstUsed5h(r, { env });
  const shapePart = r.shape ? ` shape=${JSON.stringify(r.shape)}` : '';
  if (r.wrote) { process.stdout.write(`sync-provider ${r.provider}/${r.alias}: wrote${shapePart}\n`); return 0; }
  if (r.reason === 'superseded') { process.stdout.write(`sync-provider ${r.provider}/${r.alias}: superseded${shapePart}\n`); return 0; }
  process.stderr.write(`sync-provider ${r.provider}/${r.alias}: ${r.reason}${shapePart}\n`);
  return 1;
}

module.exports = { MIN_INTERVAL_S, syncProvider, convertMinimax, convertGlm, watchFirstUsed5h, PROVIDERS, TIMEOUT_MS: DEFAULT_TIMEOUT_MS };

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((c) => { process.exitCode = c; });
}
