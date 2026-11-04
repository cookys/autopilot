'use strict';

// scripts/lib/account-probe.js — G40 D4 probe, pure parts (plan project/plans/2026-11-03-g40-agent-lane-quota.md 5.3, 10;
// N13, N14, N66, N73, N76; amendment 2026-11-04 d-2d6a93aa, BL-0375). `accounts.quota_probe` unset follows the manifest:
// on-demand (`stale`) for every provider, periodic (`scheduled`) only when the periodic gate below passes.
//
//   probeArgv(manifest, prompt)         the tinyprobe argv of the adapter manifest with <PROMPT> filled in, nothing else
//                                       added or removed (the matrix's live command; `--strict-mcp-config` is NOT in it).
//   probePolicy(manifest)               { confirmed, q5, periodic }: periodic needs starts_window false AND
//                                       starts_window_confidence high AND an evidence path AND a recorded Q5
//                                       (tinyprobe quota_share_per_probe). Anything else is on-demand only.
//   probeModeAllowed(manifest, mode)    `off` and `stale` always; `scheduled` only when probePolicy says periodic (N66).
//   resolveProbeMode(manifest, setting) unset -> `scheduled` when periodic, else `stale`; no tinyprobe -> `off`; an explicit
//                                       setting is returned as is (explicit `off` beats the manifest). Never throws.
//   periodicDue(opts)                   aliases due for a periodic probe: stale at 30 minutes AND in the demand set.
//   demandAliases(records, nowMs)       aliases a run touched in the last 24 h, from validated audit records.
//   staleCandidates(accounts, merged, cooldowns, exclude, nowS, minutes)
//                                       aliases worth probing, in the order given; the caller probes at most one.
//   checkProbeConfig(a)                 the range checks of N73 as a pure function: null or a short reason code.
//
// No IO, no clock, no spawn here; the spawn goes through claude-account.js execAttempt (one spawn site).
// Node >= 20.10, built-ins only.

const PROMPT_PLACEHOLDER = '<PROMPT>';
const PROBE_PROMPT = 'Reply with the single word: ok'; // a few words, no tools; the figure we want is in the event, not the reply
const STALE_MINUTES_MIN = 5;
const STALE_MINUTES_MAX = 360;
const STALE_MINUTES_DEFAULT = 60;
const TIMEOUT_SECS_DEFAULT = 20;
const TIGHT = 0.90; // a tight alias is never probed: it needs no refresh and is the one most likely to 429
const MODES = Object.freeze(['off', 'stale', 'scheduled']);

function tinyprobe(manifest) {
  const caps = manifest && Array.isArray(manifest.capture) ? manifest.capture : [];
  return caps.find((c) => c && c.mode === 'tinyprobe' && Array.isArray(c.argv_template)) || null;
}

// Throws when the manifest has no tinyprobe argv template or the template has no (or more than one) placeholder.
function probeArgv(manifest, prompt) {
  const t = tinyprobe(manifest);
  if (!t) throw new Error('probe_manifest_missing');
  const hits = t.argv_template.filter((x) => x === PROMPT_PLACEHOLDER).length;
  if (hits !== 1) throw new Error('probe_template_placeholder');
  if (typeof prompt !== 'string' || prompt.length === 0) throw new Error('probe_prompt_empty');
  return t.argv_template.map((x) => (x === PROMPT_PLACEHOLDER ? prompt : x));
}

const CONFIDENCES = Object.freeze(['low', 'medium', 'high']);
const Q5_WINDOWS = Object.freeze(['rolling_5h', 'weekly']);
const PERIODIC_MINUTES = 30; // amendment A.1: about one probe per 30 minutes, only without a newer observation
const DEMAND_SECS = 24 * 3600; // plan 19.6 A demand rule
const nonEmpty = (x) => typeof x === 'string' && x.length > 0;

// The facts the policy reads: the TOP-LEVEL starts_window trio plus the tinyprobe capture's Q5 record.
function probePolicy(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const t = tinyprobe(m);
  const confirmed = m.starts_window === false && m.starts_window_confidence === 'high' && nonEmpty(m.starts_window_evidence);
  const q = t && t.quota_share_per_probe;
  const q5 = !!q && typeof q === 'object' && Number.isFinite(q.percent) && q.percent > 0 && q.percent <= 100
    && Q5_WINDOWS.includes(q.window) && nonEmpty(q.evidence);
  return { confirmed, q5, periodic: !!t && confirmed && q5 };
}

function probeModeAllowed(manifest, mode) {
  if (!MODES.includes(mode)) return false;
  if (mode !== 'scheduled') return true;
  return probePolicy(manifest).periodic;
}

// quota_probe unset follows the manifest; an explicit setting wins (explicit `off` stays off). No tinyprobe: nothing to run.
function resolveProbeMode(manifest, setting) {
  if (setting !== undefined) return setting;
  if (!tinyprobe(manifest)) return 'off';
  return probePolicy(manifest).periodic ? 'scheduled' : 'stale';
}

// Returns null when fine, else a short reason code. `a` is the raw `accounts` config object (already an object).
function checkProbeConfig(a) {
  if (a.quota_probe !== undefined && !MODES.includes(a.quota_probe)) return 'config_quota_probe_invalid';
  if (a.quota_probe_stale_minutes !== undefined) {
    const m = a.quota_probe_stale_minutes;
    if (!Number.isInteger(m) || m < STALE_MINUTES_MIN || m > STALE_MINUTES_MAX) return 'config_quota_probe_stale_minutes_invalid';
  }
  if (a.quota_probe_timeout_secs !== undefined) {
    const t = a.quota_probe_timeout_secs;
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return 'config_quota_probe_timeout_secs_invalid';
  }
  return null;
}

// accounts: [{alias, priority}] in pick order; merged: { alias -> interpretWindows result | undefined };
// cooldowns: { alias -> until ms }; exclude: [alias]; nowS: epoch seconds; minutes: stale threshold.
// A candidate is not excluded, not cooling (a cooldown file or a live refusal), has `used` below 0.90 (or unknown),
// and its newest window observation is older than `minutes` or missing. Cooldown `until` is in ms like account-cooldown.js.
function staleCandidates(accounts, merged, cooldowns, exclude, nowS, minutes) {
  const out = [];
  const ex = new Set(Array.isArray(exclude) ? exclude : []);
  const m = merged || {};
  const cd = cooldowns || {};
  for (const acct of Array.isArray(accounts) ? accounts : []) {
    const alias = acct && acct.alias;
    if (typeof alias !== 'string' || ex.has(alias)) continue;
    if (Number.isFinite(cd[alias]) && cd[alias] > nowS * 1000) continue; // cooling
    const w = m[alias];
    if (w && (w.class === 'cooling' || w.refusal)) continue;
    if (w && w.class === 'tight') continue;
    if (w && Number.isFinite(w.used) && w.used >= TIGHT) continue;
    let newest = null;
    for (const x of (w && Array.isArray(w.windows)) ? w.windows : []) {
      if (Number.isFinite(x.observed_at) && (newest === null || x.observed_at > newest)) newest = x.observed_at;
    }
    if (newest !== null && nowS - newest <= minutes * 60) continue; // fresh enough
    out.push(alias);
  }
  return out;
}

// Aliases a run used in the last 24 h. `records` are VALIDATED audit records (account-audit.readAudit); a probe's own line
// (purpose `quota-probe`) and a pre-attempt line (alias `-`) are not demand. Any other input shape yields an empty set.
function demandAliases(records, nowMs) {
  const out = new Set();
  if (!Array.isArray(records) || !Number.isFinite(nowMs)) return out;
  for (const r of records) {
    if (!r || typeof r.alias !== 'string' || r.alias === '-' || typeof r.outcome !== 'string' || !r.outcome) continue;
    if (r.purpose === 'quota-probe' || !Number.isFinite(r.ts)) continue;
    if (nowMs - r.ts <= DEMAND_SECS * 1000 && r.ts <= nowMs) out.add(r.alias);
  }
  return out;
}

// opts: { manifest, accounts, merged, cooldowns, exclude, nowS, demand:Set }. Empty unless the manifest is periodic.
function periodicDue(opts) {
  const o = opts || {};
  if (!probePolicy(o.manifest).periodic || !(o.demand instanceof Set)) return [];
  return staleCandidates(o.accounts, o.merged, o.cooldowns, o.exclude, o.nowS, PERIODIC_MINUTES).filter((a) => o.demand.has(a));
}

module.exports = {
  PROMPT_PLACEHOLDER, PROBE_PROMPT, STALE_MINUTES_MIN, STALE_MINUTES_MAX, STALE_MINUTES_DEFAULT, TIMEOUT_SECS_DEFAULT, MODES,
  CONFIDENCES, Q5_WINDOWS, PERIODIC_MINUTES,
  probeArgv, probePolicy, probeModeAllowed, resolveProbeMode, checkProbeConfig, staleCandidates, demandAliases, periodicDue,
};
