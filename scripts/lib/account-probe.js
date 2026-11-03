'use strict';

// scripts/lib/account-probe.js — G40 D4 probe, pure parts (plan project/plans/2026-11-03-g40-agent-lane-quota.md 5.3, 10;
// N13, N14, N66, N73, N76). The probe PROGRAM PATH ships, but `accounts.quota_probe` is `off` by default and nothing in
// a document or a default may turn it on until the section 19 experiment is recorded.
//
//   probeArgv(manifest, prompt)         the tinyprobe argv of the adapter manifest with <PROMPT> filled in, nothing else
//                                       added or removed (the matrix's live command; `--strict-mcp-config` is NOT in it).
//   probeModeAllowed(manifest, mode)    `off` and `stale` always; `scheduled` only when the manifest says
//                                       `starts_window: false` WITH an evidence path (N66). Claude says `unknown`.
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

function probeModeAllowed(manifest, mode) {
  if (!MODES.includes(mode)) return false;
  if (mode !== 'scheduled') return true;
  const t = tinyprobe(manifest);
  return !!t && t.starts_window === false && typeof t.evidence === 'string' && t.evidence.length > 0;
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

module.exports = {
  PROMPT_PLACEHOLDER, PROBE_PROMPT, STALE_MINUTES_MIN, STALE_MINUTES_MAX, STALE_MINUTES_DEFAULT, TIMEOUT_SECS_DEFAULT, MODES,
  probeArgv, probeModeAllowed, checkProbeConfig, staleCandidates,
};
