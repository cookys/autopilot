'use strict';

// scripts/lib/account-pick.js — pure account picker (plan 5.3). No fs, no clock: every input is a
// parameter.
//
// pick({ accounts:[{alias,priority}], snapshots:{alias: parsedSnapshot|null}, roots:{alias: hash8},
//        cooldowns:{alias: untilMs}, exclude:[alias], nowMs, refuseAllTight })
// ->  { ok:true,  choice:{alias,class,used,source}, outcome:'all_tight'|null, notes:[{alias,note}], dropped:[{alias,reason}] }
//   | { ok:false, exit:3, code:'no_account_available'|'all_tight_refused', dropped:[...], notes:[...] }
//
// Optional mirror input (G40 D3, plan 8.1 P2 interim, 8.2):
//   observations: { alias: [row...] }   rows of the local quota mirror view (account-observation.js readView, already
//                                       passed through account-interpret.js selectView: peer rows never reach pick)
//   manifest: adapter manifest (account-interpret.js interpretWindows), optional
// PM parity (L): the mirror can change a pick in exactly two ways and no other. (1) A fresh live window at or above
// 0.90 makes the alias tight (the class interpretWindows gives it, estimated windows included: plan 5.2 rule 4, N26);
// only rows written by the local courier count (writer_courier 'local', no hub stamp). The mirror observation takes over from the snapshot only when it is at least
// strictly newer than the snapshot's (a tie goes to the snapshot: D5's adapter row is a same-second copy of it); an older tight mirror row under a newer snapshot is ignored.
// (2) A live refusal drops the alias with reason `refusal` (after `excluded` and after the G37 `cooldown`, which keeps
// its own string). An ok, unknown, stale, placeholder, estimated-below-0.90 or peer mirror row never changes
// anything: no promotion of an unknown alias to ok (KR2 is off this wave), no "newer whole" for an ok row, no notes.
// Without observations (or with only unusable rows) the output is byte-for-byte the G37 output, no extra key.
// A tight takeover adds `observed_at` (epoch seconds of the deciding window) to `choice`; nothing else does.
//
// Classes: ok (known, used < 0.90), unknown, tight (known, used >= 0.90).
// Order: ok by used asc, then unknown by priority, then tight by used asc; ties by priority, alias.
// Drop reasons are capacity only: excluded, cooldown, refusal. Token/config faults are never a drop reason.

const { interpretSnapshot, TIGHT_THRESHOLD } = require('./account-quota');
const { interpretWindows } = require('./account-interpret');
const { LOCAL_COURIER } = require('./account-observation');

const CLASS_RANK = { ok: 0, unknown: 1, tight: 2 };

function classify(q) {
  if (q.state !== 'known') return 'unknown';
  return q.used >= TIGHT_THRESHOLD ? 'tight' : 'ok';
}

// What the mirror rows of one alias may contribute: { refusal: bool, tight: null | { used, source, observed_at } }.
// The class is interpretWindows' own (cooling beats tight); anything unreadable is no contribution, never an error.
function mirrorEffect(rows, manifest, nowMs) {
  const none = { refusal: false, tight: null };
  if (!Array.isArray(rows)) return none;
  // Local rows only (no hub this wave): a row is local when its writer is the local courier and it has no hub stamp.
  const local = rows.filter((r) => r && typeof r === 'object' && r.writer_courier === LOCAL_COURIER &&
    !(typeof r.observed_at_hub === 'number' && Number.isFinite(r.observed_at_hub)));
  if (local.length === 0) return none;
  let m;
  try { m = interpretWindows(local, manifest, nowMs / 1000); } catch (_) { return none; }
  if (m.class === 'cooling') return { refusal: true, tight: null };
  if (m.class !== 'tight') return none;
  // used is null only for an empty credits balance: fully used.
  return { refusal: false, tight: { used: typeof m.used === 'number' ? m.used : 1, source: m.source, observed_at: m.observed_at } };
}

// The class/used/source of one alias after the mirror had its say: { drop, cls, used, source, observed_at? }.
// `drop` is 'refusal' or null. q is interpretSnapshot's result, snap the raw snapshot it was made from.
function judge(q, snap, rows, manifest, nowMs) {
  const base = { drop: null, cls: classify(q), used: q.used, source: q.source };
  const eff = mirrorEffect(rows, manifest, nowMs);
  if (eff.refusal) return Object.assign(base, { drop: 'refusal' });
  if (eff.tight === null) return base;
  const snapAgeMs = q.state === 'known' && snap && Number.isFinite(snap.written_at_ms) ? nowMs - snap.written_at_ms : Infinity;
  const mirrorAgeMs = nowMs - eff.tight.observed_at * 1000;
  if (snapAgeMs <= mirrorAgeMs) return base; // the snapshot observation is newer or equal: it keeps the alias
  return { drop: null, cls: 'tight', used: eff.tight.used, source: eff.tight.source, observed_at: eff.tight.observed_at };
}

function pick(input) {
  const i = input || {};
  const nowMs = i.nowMs;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new TypeError('pick: nowMs must be a finite number');
  const accounts = Array.isArray(i.accounts) ? i.accounts : [];
  const exclude = new Set(i.exclude || []);
  const cooldowns = i.cooldowns || {};
  const snapshots = i.snapshots || {};
  const roots = i.roots || {};
  const observations = i.observations || {};
  const dropped = [];
  const notes = [];
  const cands = [];

  for (const acct of accounts) {
    const alias = acct.alias;
    if (exclude.has(alias)) { dropped.push({ alias, reason: 'excluded' }); continue; }
    const until = cooldowns[alias];
    if (Number.isFinite(until) && until > nowMs) { dropped.push({ alias, reason: 'cooldown' }); continue; }
    const q = interpretSnapshot(snapshots[alias], { alias, expectedRoot: roots[alias], nowMs });
    if (q.note === 'quota_schema_unsupported' || q.note === 'snapshot_root_mismatch') notes.push({ alias, note: q.note });
    const j = judge(q, snapshots[alias], observations[alias], i.manifest, nowMs);
    if (j.drop !== null) { dropped.push({ alias, reason: j.drop }); continue; }
    const cand = { alias, priority: Number.isFinite(acct.priority) ? acct.priority : 0, cls: j.cls, used: j.used, source: j.source };
    if (j.observed_at !== undefined) cand.observed_at = j.observed_at;
    cands.push(cand);
  }

  if (cands.length === 0) return { ok: false, exit: 3, code: 'no_account_available', dropped, notes };

  cands.sort((a, b) => {
    if (CLASS_RANK[a.cls] !== CLASS_RANK[b.cls]) return CLASS_RANK[a.cls] - CLASS_RANK[b.cls];
    if (a.cls !== 'unknown' && a.used !== b.used) return a.used - b.used;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
  });

  const first = cands[0];
  if (first.cls === 'tight' && i.refuseAllTight === true) {
    return { ok: false, exit: 3, code: 'all_tight_refused', dropped, notes };
  }
  const choice = { alias: first.alias, class: first.cls, used: first.used, source: first.source };
  if (first.observed_at !== undefined) choice.observed_at = first.observed_at;
  return {
    ok: true,
    choice,
    outcome: first.cls === 'tight' ? 'all_tight' : null,
    notes, dropped,
  };
}

module.exports = { pick, classify, judge };
