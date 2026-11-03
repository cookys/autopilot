'use strict';

// scripts/quota-reporter.js — G40 D5, the local reporter's statusline adapter (plan
// project/plans/2026-11-03-g40-agent-lane-quota.md 18.2, 18.3, 6, 8.1 P2b, N18 N23 N51 N59 N90).
//
// One job: read the codeforge statusline snapshot (`codeforge.quota/1`) of an alias, convert it ONCE into a
// `fleet.quota/1` window row and write it into the local mirror. No hub, no push, no pacing, no queue, no resident
// process: the wrapper calls syncStatusline() once before `gather`, and `claude-account.js sync-statusline` calls
// it by hand. Everything here is synchronous and never throws; a failure is a result object, never an exception,
// so a bad snapshot or a busy lock can not reach gather, pick or run.
//
//   convertSnapshot(snap, opts)   pure: snapshot -> { ok: true, record } | { ok: false, reason }
//   syncAlias(liveDir, alias, o)  read, convert, write one alias -> { alias, wrote, reason }
//   syncStatusline(input)         every alias of input.accounts -> [{ alias, wrote, reason }]
//
// Conversions (plan 6), each done exactly here and nowhere after: `pct` is already a 0..1 fraction and goes through
// observation.clampUtilization (the single clamp boundary: 1..1.5 becomes 1 with clamped, above 1.5 is rejected, so an
// unconverted 0..100 value such as 62 never gets in); `resets_at` is already epoch seconds; `written_at_ms` becomes
// floor(written_at_ms / 1000) and is the window's observed_at (the snapshot's own observation time, not the write time).
// Window source is `passive`: the interactive statusline feed is not a separate source (plan 20.2).
//
// The G37 protections are kept by reusing account-quota.js interpretSnapshot as the gate: a wrong alias, a root hash8
// that differs from the expected one (N90, `snapshot_root_mismatch`), an unsupported schema, a stale or future-dated
// snapshot and a snapshot with no live window all write nothing.
//
// This file reads exactly one kind of input: the snapshot file under the live-state directory, through account-quota's
// no-follow reader. It never opens a secret of any kind; test N23 scans this source to keep that true.
// Node >= 20.10, built-ins only.

const observation = require('./lib/account-observation');
const quota = require('./lib/account-quota');
const capture = require('./lib/account-capture');

const KIND_OF = Object.freeze({ five_hour: 'rolling_5h', seven_day: 'weekly' });
const PROVIDER_KEY = { provider: 'claude' }; // the mirror's provider key (a record field, not a program name)

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

// opts: { alias, expectedRoot, nowMs, hostRole }. Pure: no fs, no clock (nowMs is a parameter).
function convertSnapshot(snap, opts) {
  const o = opts || {};
  const nowMs = o.nowMs;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return { ok: false, reason: 'now_invalid' };
  const q = quota.interpretSnapshot(snap, { alias: o.alias, expectedRoot: o.expectedRoot, nowMs });
  if (q.state !== 'known') return { ok: false, reason: q.note || 'snapshot_absent' };
  const observedAt = Math.floor(snap.written_at_ms / 1000);
  const windows = [];
  for (const [name, kind] of Object.entries(KIND_OF)) {
    const w = snap[name];
    if (!isObj(w)) continue;
    if (w.resets_at * 1000 <= nowMs) continue; // an elapsed window is not an observation of the present
    const c = observation.clampUtilization(w.pct);
    if (!c.ok) return { ok: false, reason: 'quota_invalid' };
    const win = { kind, utilization: c.value, resets_at: w.resets_at, source: 'passive', observed_at: observedAt };
    if (c.clamped) win.clamped = true;
    windows.push(win);
  }
  if (windows.length === 0) return { ok: false, reason: 'quota_windows_expired' };
  const record = {
    schema: observation.SCHEMA, provider: PROVIDER_KEY.provider, alias: o.alias, visibility: 'L3', windows,
    refusal: null, token_state: 'unknown', token_state_at: null,
  };
  if (typeof o.hostRole === 'string' && o.hostRole) record.host_role = o.hostRole;
  const v = observation.validateRecord(record, { provider: PROVIDER_KEY.provider, alias: o.alias });
  if (!v.ok) return { ok: false, reason: 'quota_invalid' };
  return { ok: true, record };
}

// The local courier's current record for the alias, or null. Never throws.
function currentRecord(liveDir, alias) {
  try {
    const r = observation.readView(liveDir, PROVIDER_KEY.provider, alias);
    if (!r || !r.view || !Array.isArray(r.view.rows)) return null;
    const row = r.view.rows.find((x) => isObj(x) && x.writer_courier === observation.LOCAL_COURIER);
    return row && isObj(row.record) ? row.record : null;
  } catch (_) { return null; }
}

// o: { expectedRoot, nowMs, hostRole }. Returns { alias, wrote: boolean, reason: string|null }:
//   wrote true, reason null            a new row is in the mirror
//   wrote false, reason 'up_to_date'   the same row is already there; 'superseded' a newer local observation kept
//   wrote false, any other reason      nothing written (snapshot problem or a write failure code)
function syncAlias(liveDir, alias, o) {
  const out = (wrote, reason) => ({ alias, wrote, reason });
  try {
    const opts = o || {};
    if (typeof liveDir !== 'string' || liveDir === '') return out(false, 'live_dir_refused');
    const raw = quota.readSnapshotFile(liveDir, alias);
    if (raw === null) return out(false, 'snapshot_absent');
    if (raw.__error) return out(false, raw.__error);
    const conv = convertSnapshot(raw, { alias, expectedRoot: opts.expectedRoot, nowMs: opts.nowMs, hostRole: opts.hostRole });
    if (!conv.ok) return out(false, conv.reason);
    const cur = currentRecord(liveDir, alias);
    if (cur !== null && JSON.stringify(cur) === JSON.stringify(conv.record)) return out(false, 'up_to_date');
    const w = observation.writeLocalRow(liveDir, conv.record, { secrets: [] });
    if (w.ok === true) return w.superseded ? out(false, 'superseded') : out(true, null);
    return out(false, capture.captureReason(w));
  } catch (_) { return out(false, 'sync_error'); }
}

// input: { liveDir, accounts: [{ alias, expectedRoot }], nowMs, hostRole }.
function syncStatusline(input) {
  const i = input || {};
  const results = [];
  try {
    for (const a of Array.isArray(i.accounts) ? i.accounts : []) {
      results.push(syncAlias(i.liveDir, a && a.alias, { expectedRoot: a && a.expectedRoot, nowMs: i.nowMs, hostRole: i.hostRole }));
    }
  } catch (_) { /* a broken input list loses the remaining aliases, never the caller */ }
  return results;
}

// Reasons that are a normal state of the world (no statusline, a stale one, a protected mismatch) and need no debug line.
const QUIET_REASONS = new Set(['snapshot_absent', 'up_to_date', 'superseded', 'snapshot_root_mismatch', 'quota_stale',
  'quota_windows_expired', 'quota_schema_unsupported', 'quota_invalid', 'quota_unreadable']);
function isFailure(r) { return r.wrote === false && r.reason !== null && !QUIET_REASONS.has(r.reason); }

module.exports = { convertSnapshot, syncAlias, syncStatusline, isFailure, QUIET_REASONS, KIND_OF };
