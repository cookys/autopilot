'use strict';

// src/status/scope-key.js — the scope key of a watcher scope (mods plan §2.7): `project_key` for the unbound scope,
// `project_key--<root_run_id>` for an execution root, the root segment passed through the same safeSegment the
// watcher uses for its envelope file names. Shared by the watcher inputs and scripts/open-decision.js.

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || '_';
}

function scopeKeyOf(projectKey, root) {
  return root ? `${projectKey}--${safeSegment(root)}` : projectKey;
}

// repo_identity `git-common-dir:<abs path>` -> the common dir, else null.
function commonDirOf(identity) {
  const m = typeof identity === 'string' ? /^git-common-dir:(.+)$/.exec(identity) : null;
  return m ? m[1] : null;
}

// Every scope file of one project in a decisions dir: the unbound `<scopeKeyOf(key)>.json` and each `<scopeKeyOf(key)>--<safeSegment>.json`.
// Names are matched in their encoded form (scopeKeyOf / safeSegment), never by a raw root. Returns [file]. A foreign project whose key
// shares the prefix also matches by name: callers must pass each file through readScopeFile.
function listScopeFiles(dir, projectKey) {
  const fs = require('fs');
  const path = require('path');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_error) { return []; }
  const unbound = scopeKeyOf(projectKey, null);
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json')) continue;
    const base = n.slice(0, -5);
    if (base === unbound) { out.push(path.join(dir, n)); continue; }
    const rest = base.startsWith(`${unbound}--`) ? base.slice(unbound.length + 2) : '';
    if (rest && safeSegment(rest) === rest) out.push(path.join(dir, n));
  }
  return out;
}

// One scope file, bound to itself: parsed JSON with `raw`, or null when it is unreadable, not schema `schema`, not this project_key /
// repo_identity, or its root_run_id does not give back its own file name (scopeKeyOf(key, root) === name). Shared by every reader.
function readScopeFile(file, { schema, projectKey, identity }) {
  const fs = require('fs');
  const path = require('path');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.schema !== schema || !Array.isArray(v.decisions)) return null;
    if (v.project_key !== projectKey || v.repo_identity !== identity) return null;
    if (scopeKeyOf(projectKey, v.root_run_id || null) !== path.basename(file, '.json')) return null;
    return { value: v, raw };
  } catch (_error) {
    return null;
  }
}

// Card status (BL cardtrail). A card entry is kept after `open-decision.js close`: `status` is 'open' (or absent on cards written before this
// field), 'awaiting_operator_action' (answered, but the operator must still do one step; shown on the panel, differently from a question),
// 'pending_dispatch' (answered with an executor: close printed the dispatch JSON, nobody has confirmed the dispatch yet; `close --dispatched <task_id>`
// ends it) or 'closed' (kept with closed_at + answer). "The entry is in the file" never means "the card is open": every reader that lists cards asks this.
// Only 'open' is a pending question (待決). awaiting_operator_action and pending_dispatch are LIVE (still shown, still need someone) but never counted
// as a question. cardState() is the one place that maps a stored status to a state (absent or unknown = open, the pre-field behaviour).
// operator_steps, last_answer and reask_at are optional entry fields. cardState does not read them. No status value was added for them.
const CARD_STATUS = ['open', 'awaiting_operator_action', 'pending_dispatch', 'closed'];
function cardState(e) {
  return e && typeof e === 'object' && CARD_STATUS.includes(e.status) ? e.status : 'open';
}
function isOpenEntry(e) {
  return cardState(e) === 'open';
}
function isPendingDispatchEntry(e) {
  return cardState(e) === 'pending_dispatch';
}
function isClosedEntry(e) {
  return !!e && typeof e === 'object' && e.status === 'closed';
}
function isAwaitingEntry(e) {
  return !!e && typeof e === 'object' && e.status === 'awaiting_operator_action';
}

// Dated cards (`open-decision.js open --due`, PM 01M78866 item c): `due_at` is an ISO UTC instant. dueState() is the ONE place that says
// whether it has come; `show`, the job-page reader (decision-input.js), due-sweep, and the pane badge / float-up all ask it, never Date.parse themselves.
//   'none'    no due_at (or one that is not a date): an ordinary card, nothing changes
//   'not_due' due_at still in the future: listed LAST, marked "due <local time>", NOT counted as pending
//   'due'     due_at reached: listed FIRST, marked "due now", counted
// `now` is epoch ms or a Date; an unusable `now` reads as 'due' (fail visible: a clock problem never hides a card). Pure: reads nothing else.
function dueState(card, now) {
  const at = card && typeof card === 'object' && typeof card.due_at === 'string' ? Date.parse(card.due_at) : NaN;
  if (!Number.isFinite(at)) return 'none';
  const n = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(n)) return 'due';
  return at <= n ? 'due' : 'not_due';
}
// List order key from dueState: due first (0), ordinary cards (1), not yet due last (2). A closed card is a record: 1.
function dueRank(card, now) {
  if (isClosedEntry(card)) return 1;
  const s = dueState(card, now);
  return s === 'due' ? 0 : s === 'not_due' ? 2 : 1;
}

// True when the scope file holds at least one entry that is not closed (it needs a string id and question like every reader requires).
function scopeFileHasLive(file) {
  const fs = require('fs');
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !!v && Array.isArray(v.decisions) && v.decisions.some((e) => e && typeof e.id === 'string' && e.id && typeof e.question === 'string' && e.question && !isClosedEntry(e));
  } catch (_error) {
    return false;
  }
}

// One card id, one state. Among the records sharing an id (the same card kept in several scope files) the most advanced state wins
// (closed > awaiting_operator_action / pending_dispatch > open); equal rank: the newest stamp (answered_at / pending_dispatch_at / closed_at
// for an answered card, opened_at for an open one), then the first file in the (sorted) scope-file order. `items` = [{ file, e }] in that
// file order; returns the winners, one per id (entries with no string id pass through). Tie rule chosen so the outcome never depends on read order.
const cardRank = (e) => (isClosedEntry(e) ? 3 : cardState(e) === 'open' ? 1 : 2);
function cardStamp(e) {
  const t = cardState(e) === 'open' ? [e.opened_at] : [e.answered_at, e.pending_dispatch_at, e.closed_at];
  return Math.max(0, ...t.map((v) => Date.parse(v)).filter(Number.isFinite));
}
function pickCards(items) {
  const best = new Map();
  const out = [];
  for (const it of items) {
    const id = it.e && typeof it.e.id === 'string' && it.e.id ? it.e.id : null;
    if (!id) { out.push(it); continue; }
    const cur = best.get(id);
    if (!cur) { best.set(id, it); out.push(it); continue; }
    const better = cardRank(it.e) > cardRank(cur.e) || (cardRank(it.e) === cardRank(cur.e) && cardStamp(it.e) > cardStamp(cur.e));
    if (better) { out[out.indexOf(cur)] = it; best.set(id, it); }
  }
  return out;
}

module.exports = { cardRank, pickCards, safeSegment, scopeKeyOf, commonDirOf, listScopeFiles, readScopeFile, CARD_STATUS, cardState, isOpenEntry, isClosedEntry, isAwaitingEntry, isPendingDispatchEntry, scopeFileHasLive, dueState, dueRank };
