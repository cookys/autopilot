'use strict';

// scripts/lib/account-pick.js — pure account picker (plan 5.3). No fs, no clock: every input is a
// parameter.
//
// pick({ accounts:[{alias,priority}], snapshots:{alias: parsedSnapshot|null}, roots:{alias: hash8},
//        cooldowns:{alias: untilMs}, exclude:[alias], nowMs, refuseAllTight })
// ->  { ok:true,  choice:{alias,class,used,source}, outcome:'all_tight'|null, notes:[{alias,note}], dropped:[{alias,reason}] }
//   | { ok:false, exit:3, code:'no_account_available'|'all_tight_refused', dropped:[...], notes:[...] }
//
// Classes: ok (known, used < 0.90), unknown, tight (known, used >= 0.90).
// Order: ok by used asc, then unknown by priority, then tight by used asc; ties by priority, alias.
// Drop reasons are capacity only: excluded, cooldown. Token/config faults are never a drop reason.

const { interpretSnapshot, TIGHT_THRESHOLD } = require('./account-quota');

const CLASS_RANK = { ok: 0, unknown: 1, tight: 2 };

function classify(q) {
  if (q.state !== 'known') return 'unknown';
  return q.used >= TIGHT_THRESHOLD ? 'tight' : 'ok';
}

function pick(input) {
  const i = input || {};
  const nowMs = i.nowMs;
  const accounts = Array.isArray(i.accounts) ? i.accounts : [];
  const exclude = new Set(i.exclude || []);
  const cooldowns = i.cooldowns || {};
  const snapshots = i.snapshots || {};
  const roots = i.roots || {};
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
    const cls = classify(q);
    cands.push({ alias, priority: Number.isFinite(acct.priority) ? acct.priority : 0, cls, used: q.used, source: q.source });
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
  return {
    ok: true,
    choice: { alias: first.alias, class: first.cls, used: first.used, source: first.source },
    outcome: first.cls === 'tight' ? 'all_tight' : null,
    notes, dropped,
  };
}

module.exports = { pick, classify };
