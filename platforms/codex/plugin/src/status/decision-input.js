'use strict';

// src/status/decision-input.js — the open owner questions of a watcher scope (mods P1W W2a-m).
// File: <git-common-dir>/autopilot/decisions/<scope_key>.json, schema autopilot.decision/2 (written by
// scripts/open-decision.js): one file per scope holding EVERY open question in `decisions`. Present = at least one open
// question; answered / withdrawn = the helper removed that entry (the file goes with the last one).
// Every scope file of the project counts (unbound + each root; see readDecision). A file counts only when every binding matches:
// schema, project_key, repo_identity and root_run_id agreeing with its own file name (null for the unbound file). Inside it an entry counts when it has a string id, a string question and a parseable opened_at that is
// not from the future (beyond a small slack); the others are ignored.
// Age never hides a question (expiry warns, never blocks): older than STALE_MS only sets `stale: true`; `age_s` is always given.
// Only `open-decision.js close --id` removes a question. Anything else is ignored.
// Orphan (BL-0163): a question the ask-decision hook opened (`origin: ask_user_question`, `turn_tracked: true` = the asker's turn file existed at open time;
// turn tracking has its own knob, so without the flag a missing file proves nothing) whose asking session left no turn file under
// <liveBase>/turn/ is `orphaned: true` — SessionEnd removes that file and answers close the entry, so an entry that outlived both
// was left by a session that died without a clean end (or by a wiped live dir). Derived from the session's own artefact, never from age.
// It only labels: the entry stays listed until `open-decision.js close --id`. Not judged (false) when no entry names a session, the entry is
// hand-opened (no origin), or the live dir itself is unavailable. A session killed hard with its live dir intact still has its turn file: not detected.
// Returns { value, sha256, file } where value is the list shaped for the renderer, oldest first:
//   [{ id, question, background, options: [{label, description}], recommendation, why, blocks, not_authorized, source, opened_at, stale, age_s, orphaned }]
// or null when no entry counts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scopeKeyOf, safeSegment, listScopeFiles } = require('./scope-key');

const STALE_MS = 7 * 86400 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

function decisionFile(commonDir, key, root) {
  return path.join(commonDir, 'autopilot', 'decisions', `${scopeKeyOf(key, root)}.json`);
}

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

const ASK_ORIGIN = 'ask_user_question';

// True when the hook-opened entry's asking session has no turn file under <liveBase>/turn (see header). Fail-safe: false when it cannot be judged.
function sessionGone(e, liveBase) {
  if (e.origin !== ASK_ORIGIN || e.turn_tracked !== true || typeof e.opened_by_session !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(e.opened_by_session)) return false;
  if (typeof liveBase !== 'string' || !liveBase) return false;
  try {
    if (!fs.statSync(liveBase).isDirectory()) return false;
    return !fs.existsSync(path.join(liveBase, 'turn', `${e.opened_by_session}.json`));
  } catch (_error) {
    return false;
  }
}

function viewOf(e, nowMs, liveBase) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || typeof e.question !== 'string' || !e.question) return null;
  const opened = Date.parse(e.opened_at);
  if (!Number.isFinite(opened) || opened - nowMs > FUTURE_SLACK_MS) return null;
  const options = (Array.isArray(e.options) ? e.options : []).filter((o) => o && typeof o === 'object' && typeof o.label === 'string' && o.label)
    .map((o) => ({ label: o.label, description: typeof o.description === 'string' ? o.description : '' }));
  return {
    id: e.id, question: e.question, background: str(e.background), options, recommendation: str(e.recommendation), why: str(e.why),
    blocks: str(e.blocks), not_authorized: str(e.not_authorized), source: str(e.source), opened_at: new Date(opened).toISOString(),
    stale: nowMs - opened > STALE_MS, age_s: Math.max(0, Math.floor((nowMs - opened) / 1000)),
    orphaned: sessionGone(e, liveBase), origin: str(e.origin),
  };
}

// Every scope file of the project counts (the unbound one and every root's), not only the watcher scope's own: a session whose root
// changed mid-way (compaction, /reload-plugins) leaves its cards in several files, and the owner must see all of them. Each file is
// still bound to itself (schema, project_key, repo_identity, and root_run_id agreeing with its own file name). The same card shown on
// the pages of several roots is merged by id in the pane. `root` only keeps the signature of the call; it no longer narrows the read.
function readDecision({ commonDir, key, identity, nowMs, liveBase }) {
  try {
    if (!commonDir || !key) return null;
    const dir = path.dirname(decisionFile(commonDir, key, null));
    const value = [];
    const hashes = [];
    let first = null;
    for (const { file, root: nameRoot } of listScopeFiles(dir, key)) {
      let raw;
      let v;
      try { raw = fs.readFileSync(file, 'utf8'); v = JSON.parse(raw); } catch (_error) { continue; }
      if (!v || typeof v !== 'object' || v.schema !== 'autopilot.decision/2' || !Array.isArray(v.decisions)) continue;
      if (v.project_key !== key || v.repo_identity !== identity) continue;
      const fileRoot = v.root_run_id || null;
      if ((fileRoot === null ? null : safeSegment(fileRoot)) !== nameRoot) continue;
      const views = v.decisions.map((e) => viewOf(e, nowMs, liveBase)).filter(Boolean);
      if (views.length === 0) continue;
      value.push(...views);
      hashes.push(crypto.createHash('sha256').update(raw).digest('hex'));
      if (!first) first = file;
    }
    if (value.length === 0) return null;
    value.sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at) || (a.id < b.id ? -1 : 1));
    return { value, sha256: hashes.length === 1 ? hashes[0] : crypto.createHash('sha256').update(hashes.join('\n')).digest('hex'), file: first };
  } catch (_error) {
    return null;
  }
}

module.exports = { readDecision, decisionFile, sessionGone, STALE_MS };
