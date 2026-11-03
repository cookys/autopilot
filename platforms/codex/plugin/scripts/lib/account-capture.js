'use strict';

// scripts/lib/account-capture.js — G40 D4 write side, pure parts (plan project/plans/2026-11-03-g40-agent-lane-quota.md
// 5.1, 5.3, 18.3, 21.8, 9).
//
//   extractRateLimit(text)       the LAST `rate_limit_event` (or `rate_limit_info` on a `result` line) in a stream-json
//                                stdout, as { status: 'none' } | { status: 'bad' } | { status: 'event', windows }.
//                                Utilization and resetsAt are copied verbatim (already a 0..1 fraction and epoch seconds);
//                                the clamp happens once, in observation.buildRecord.
//   buildPassiveRow(input)       a `fleet.quota/1` record for windows seen in an attempt (source passive or probe).
//   buildRefusalRow(input)       a shape (b) record (21.6, 21.8): visibility L1, no window, no record-level source.
//   parseRetryAt(text)           the `usage limit reached|<epoch>` hint of a quota 429, or null.
//   captureReason(writeResult)   the audit reason code of a failed mirror write, or null when nothing failed
//                                (`superseded` is a normal outcome, not a failure).
//
// Time: the caller passes `observedAtS` in epoch SECONDS (the attempt's start, converted from the wrapper's
// millisecond clock exactly once at the capture boundary in claude-account.js). Nothing here reads a clock and
// nothing here converts a unit. No token, credential path or file IO. Node >= 20.10, built-ins only.

const observation = require('./account-observation');
const { captureReasonOk } = require('./account-audit');

const KIND_OF = Object.freeze({ five_hour: 'rolling_5h', seven_day: 'weekly' });

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// One window object of an event -> { kind, utilization, resets_at } | null (absent) | 'bad'.
function windowOf(kind, w) {
  if (!isObj(w)) return null;
  if (w.utilization === undefined || w.utilization === null) return null; // a window without a figure is absent, never 0
  if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return 'bad';
  let resets = null;
  if (w.resetsAt !== undefined && w.resetsAt !== null) {
    if (typeof w.resetsAt !== 'number' || !Number.isFinite(w.resetsAt)) return 'bad';
    resets = w.resetsAt;
  }
  return { kind, utilization: w.utilization, resets_at: resets };
}

// rate_limit_info -> windows[] | 'bad'. unifiedWindows.{five_hour,seven_day} first; the older top-level shape
// (rateLimitType + utilization + resetsAt, one window) only when unifiedWindows is absent.
function windowsOfInfo(info) {
  if (!isObj(info)) return 'bad';
  const out = [];
  if (info.unifiedWindows !== undefined) {
    if (!isObj(info.unifiedWindows)) return 'bad';
    for (const [src, kind] of Object.entries(KIND_OF)) {
      const w = windowOf(kind, info.unifiedWindows[src]);
      if (w === 'bad') return 'bad';
      if (w) out.push(w);
    }
    return out;
  }
  const kind = KIND_OF[info.rateLimitType];
  if (kind) {
    const w = windowOf(kind, { utilization: info.utilization, resetsAt: info.resetsAt });
    if (w === 'bad') return 'bad';
    if (w) out.push(w);
  }
  return out;
}

function extractRateLimit(text) {
  if (typeof text !== 'string' || text.length === 0) return { status: 'none' };
  let last = null; // the last line that claims to be an event, parsed
  let lastBad = false;
  for (const line of text.split('\n')) {
    if (line.indexOf('rate_limit_') === -1) continue; // cheap prefilter: most stdout lines are not events
    let j;
    try { j = JSON.parse(line); } catch (_) {
      // A line that mentions rate_limit_event/rate_limit_info as the type but does not parse is a malformed event.
      if (/"type"\s*:\s*"rate_limit_event"/.test(line)) { last = null; lastBad = true; }
      continue;
    }
    if (!isObj(j)) continue;
    if (j.type === 'rate_limit_event' || (j.type === 'result' && j.rate_limit_info !== undefined)) {
      last = j;
      lastBad = false;
    }
  }
  if (lastBad) return { status: 'bad' };
  if (last === null) return { status: 'none' };
  const windows = windowsOfInfo(last.rate_limit_info);
  if (windows === 'bad') return { status: 'bad' };
  if (windows.length === 0) return { status: 'none' }; // an event with no window (a bare `rejected`): nothing to record, not an error
  return { status: 'event', windows };
}

function hostRoleKey(hostRole) { return typeof hostRole === 'string' && hostRole ? { host_role: hostRole } : {}; }

// input: { alias, windows: [{kind, utilization, resets_at}], observedAtS, hostRole, source: 'passive'|'probe' }.
// Returns observation.buildRecord's result: { ok: true, record } | { ok: false, code, reason }.
function buildPassiveRow(input) {
  const i = input || {};
  const source = i.source === 'probe' ? 'probe' : 'passive';
  const windows = (Array.isArray(i.windows) ? i.windows : []).map((w) => ({
    kind: w.kind, utilization: w.utilization, resets_at: w.resets_at, source, observed_at: i.observedAtS,
  }));
  return observation.buildRecord(Object.assign({
    provider: 'claude', alias: i.alias, visibility: 'L3', windows,
  }, hostRoleKey(i.hostRole)));
}

// input: { alias, observedAtS, retryAtS (number | null), reason: 'rate_limit'|'quota'|'other', hostRole }.
function buildRefusalRow(input) {
  const i = input || {};
  const retry = Number.isFinite(i.retryAtS) && i.retryAtS > i.observedAtS ? i.retryAtS : null;
  return observation.buildRecord(Object.assign({
    provider: 'claude', alias: i.alias, visibility: 'L1', windows: [],
    refusal: { observed_at: i.observedAtS, retry_at: retry, reason: i.reason },
  }, hostRoleKey(i.hostRole)));
}

function parseRetryAt(text) {
  const m = /usage limit reached\|(\d{10})\b/i.exec(typeof text === 'string' ? text : '');
  return m ? Number(m[1]) : null;
}

// writeLocalRow result -> reason code | null.
function captureReason(r) {
  if (r && r.ok === true) return null;
  const code = r && typeof r.code === 'string' ? r.code : 'write_failed';
  if (code === 'write_failed' && typeof r.reason === 'string' && captureReasonOk(r.reason)) return r.reason;
  return captureReasonOk(code) ? code : 'capture_error'; // only a closed reason code ever reaches the audit line
}

module.exports = { extractRateLimit, buildPassiveRow, buildRefusalRow, parseRetryAt, captureReason, KIND_OF };
