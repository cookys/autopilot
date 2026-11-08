#!/usr/bin/env node
'use strict';

// scripts/quota-provider-sync.js — G40 provider quota adapters for the env-token endpoints (minimax, glm).
// Sibling of quota-reporter.js (the claude statusline adapter): one GET against the provider's quota endpoint,
// converted ONCE into a `fleet.quota/1` row and written to the local mirror through observation.writeLocalRow.
// No hub, no resident process, no retry. A failure is a result object with a fixed reason code, never an exception,
// and the token never appears in a result, an error or the output.
//
//   node scripts/quota-provider-sync.js sync-provider --provider minimax|glm [--alias NAME]
//   exit 0 = a row was written or is already current; 1 = nothing written (reason code on stderr); 2 = usage.
//
//   syncProvider(provider, o)  async -> { provider, alias, wrote, reason, tightest? }
//   convertMinimax(json, nowMs) / convertGlm(json, nowMs)  pure -> { ok, windows, tightest? } | { ok: false, reason }
//
// Endpoint facts (probed by the PM; the field semantics marked ASSUMED are not confirmed by documentation):
//   minimax  GET https://www.minimax.io/v1/token_plan/remains   Authorization: Bearer <token>
//     model_remains[] carries current_interval_remaining_percent (+ end_time) for the 5 h window and
//     current_weekly_remaining_percent (+ weekly_end_time) for the week. ASSUMED: remaining is a percentage 0..100,
//     so used = 1 - remaining/100; end_time may be epoch ms (above 1e11) and is converted to seconds. usage_count and
//     total_count are always 0 and are not read. Several model entries: the tightest (largest used) wins per window; the record schema is closed, so the winning
//     model names are returned in the result as `tightest: { rolling_5h, weekly }`, not in the record.
//   glm      GET https://api.z.ai/api/monitor/usage/quota/limit   Authorization: <token> (NO Bearer; unpublished API)
//     data.limits[] of type TOKENS_LIMIT: unit 3 / number 5 is the rolling 5 h window, unit 6 / number 1 the week
//     (ASSUMED, unconfirmed; the closed record schema has no field for it, so the result object carries `assumed: true`); percentage is ASSUMED 0..100 used; nextResetTime is epoch ms or s. Other types ignored.
// Every utilization goes through observation.clampUtilization (the single clamp boundary): 1..1.5 clamps to 1, anything
// outside is rejected, so a value in the wrong unit never gets in. Window source is `probe`, observed_at is the
// request completion time in seconds, an elapsed window is dropped. Rate limit: a mirror row observed less than 900 s
// ago skips the request and returns `too_soon` (the fetch is not called).
//
// Token: read from the environment the caller passes, the same names scripts/resolve-endpoint.sh uses
// (AUTOPILOT_ENDPOINT_<NAME>_TOKEN; for minimax also the provider-native MINIMAX_API_KEY). This file opens no secret file.
// Node >= 20.10, built-ins only.

const observation = require('./lib/account-observation');
const { resolveLiveDir } = require('./lib/live-state-dir');

const TIMEOUT_MS = 10000;
const MIN_INTERVAL_S = 900; // one query per provider/alias per 15 minutes
const MS_THRESHOLD = 1e11; // observation's EPOCH_MAX_S: above it a value is milliseconds

const PROVIDERS = Object.freeze({
  minimax: { url: 'https://www.minimax.io/v1/token_plan/remains', bearer: true, tokenEnv: ['AUTOPILOT_ENDPOINT_MINIMAX_TOKEN', 'MINIMAX_API_KEY'] },
  glm: { url: 'https://api.z.ai/api/monitor/usage/quota/limit', bearer: false, tokenEnv: ['AUTOPILOT_ENDPOINT_GLM_TOKEN'] },
});

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function num(x) { return typeof x === 'number' && Number.isFinite(x); }
function toEpochSeconds(x) { return Math.floor(x > MS_THRESHOLD ? x / 1000 : x); }

// remaining percent (0..100) -> raw used fraction; unit errors surface in clampUtilization, not here.
function usedFromRemainingPct(p) { return 1 - p / 100; }

function finish(byKind, nowMs, tightest) {
  const windows = [];
  for (const kind of ['rolling_5h', 'weekly']) {
    const w = byKind[kind];
    if (!w) continue;
    if (w.resets_at * 1000 <= nowMs) continue; // an elapsed window is not an observation of the present
    const c = observation.clampUtilization(w.used);
    if (!c.ok) return { ok: false, reason: 'quota_invalid' };
    const win = { kind, utilization: c.value, resets_at: w.resets_at, source: 'probe', observed_at: Math.floor(nowMs / 1000) };
    if (c.clamped) win.clamped = true;
    windows.push(win);
  }
  if (Object.keys(byKind).length === 0) return { ok: false, reason: 'fields_missing' };
  if (windows.length === 0) return { ok: false, reason: 'quota_windows_expired' };
  return { ok: true, windows, tightest };
}

function convertMinimax(j, nowMs) {
  if (!isObj(j) || !Array.isArray(j.model_remains)) return { ok: false, reason: 'fields_missing' };
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
        tightest[kind] = typeof m.model_name === 'string' ? m.model_name.slice(0, 64) : null;
      }
    }
  }
  return finish(byKind, nowMs, tightest);
}

function convertGlm(j, nowMs) {
  if (!isObj(j) || !isObj(j.data) || !Array.isArray(j.data.limits)) return { ok: false, reason: 'fields_missing' };
  const byKind = {};
  for (const l of j.data.limits) {
    if (!isObj(l) || l.type !== 'TOKENS_LIMIT') continue;
    let kind = null;
    if (l.unit === 3 && l.number === 5) kind = 'rolling_5h';
    else if (l.unit === 6 && l.number === 1) kind = 'weekly';
    if (kind === null) continue;
    if (!num(l.percentage) || !num(l.nextResetTime)) continue;
    byKind[kind] = { used: l.percentage / 100, resets_at: toEpochSeconds(l.nextResetTime), assumed: true };
  }
  return finish(byKind, nowMs, undefined);
}

const CONVERT = { minimax: convertMinimax, glm: convertGlm };

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

// o: { alias, env, fetch, nowMs (function), liveDir, hostRole }. Never throws; the result carries no token.
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
    // Rate limit (PM): at most one query per provider/alias per 15 minutes, judged from the mirror's own observed_at.
    const lastAt = lastObservedAt(liveDir, provider, alias);
    const startMs = typeof opts.nowMs === 'function' ? opts.nowMs() : Date.now();
    if (lastAt !== null && startMs / 1000 - lastAt < MIN_INTERVAL_S) return out(false, 'too_soon');
    const doFetch = opts.fetch || globalThis.fetch;
    let res;
    try {
      res = await doFetch(spec.url, {
        method: 'GET',
        headers: { Authorization: spec.bearer ? `Bearer ${token}` : token, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (_) { return out(false, 'request_failed'); }
    const nowMs = typeof opts.nowMs === 'function' ? opts.nowMs() : Date.now();
    if (!res || typeof res.status !== 'number' || res.status < 200 || res.status > 299) return out(false, 'http_status');
    let json;
    try { json = await res.json(); } catch (_) { return out(false, 'json_invalid'); }
    const conv = CONVERT[provider](json, nowMs);
    if (!conv.ok) return out(false, conv.reason);
    const record = {
      schema: observation.SCHEMA, provider, alias, visibility: 'L3', windows: conv.windows,
      refusal: null, token_state: 'unknown', token_state_at: null,
    };
    if (typeof opts.hostRole === 'string' && opts.hostRole) record.host_role = opts.hostRole;
    const v = observation.validateRecord(record, { provider, alias, secrets: [token] });
    if (!v.ok) return out(false, 'quota_invalid');
    const w = observation.writeLocalRow(liveDir, record, { secrets: [token] });
    const extra = provider === 'glm' ? { assumed: true } : { tightest: conv.tightest };
    if (w.ok === true) return w.superseded ? out(false, 'superseded', extra) : out(true, null, extra);
    return out(false, typeof w.code === 'string' ? w.code : 'write_failed');
  } catch (_) { return out(false, 'sync_error'); }
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
  if (r.wrote) { process.stdout.write(`sync-provider ${r.provider}/${r.alias}: wrote\n`); return 0; }
  if (r.reason === 'superseded') { process.stdout.write(`sync-provider ${r.provider}/${r.alias}: superseded\n`); return 0; }
  process.stderr.write(`sync-provider ${r.provider}/${r.alias}: ${r.reason}\n`);
  return 1;
}

module.exports = { MIN_INTERVAL_S, syncProvider, convertMinimax, convertGlm, PROVIDERS, TIMEOUT_MS };

if (require.main === module) {
  main(process.argv.slice(2), process.env).then((c) => { process.exitCode = c; });
}
