'use strict';

// src/status/decision-input.js — the open owner questions of a watcher scope (mods P1W W2a-m).
// File: <git-common-dir>/autopilot/decisions/<scope_key>.json, schema autopilot.decision/2 (written by
// scripts/open-decision.js): one file per scope holding EVERY open question in `decisions`. Present = at least one open
// question; answered / withdrawn = the helper removed that entry (the file goes with the last one).
// A file only counts for THIS scope when every binding matches: schema, project_key, repo_identity and root_run_id (null for
// the unbound scope). Inside it an entry counts when it has a string id, a string question and a parseable opened_at that is
// not from the future (beyond a small slack); the others are ignored.
// Age never hides a question (expiry warns, never blocks): older than STALE_MS only sets `stale: true`; `age_s` is always given.
// Only `open-decision.js close --id` removes a question. Anything else is ignored.
// Returns { value, sha256, file } where value is the list shaped for the renderer, oldest first:
//   [{ id, question, background, options: [{label, description}], recommendation, why, blocks, source, opened_at, stale, age_s }]
// or null when no entry counts.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scopeKeyOf } = require('./scope-key');

const STALE_MS = 7 * 86400 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

function decisionFile(commonDir, key, root) {
  return path.join(commonDir, 'autopilot', 'decisions', `${scopeKeyOf(key, root)}.json`);
}

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

function viewOf(e, nowMs) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || typeof e.question !== 'string' || !e.question) return null;
  const opened = Date.parse(e.opened_at);
  if (!Number.isFinite(opened) || opened - nowMs > FUTURE_SLACK_MS) return null;
  const options = (Array.isArray(e.options) ? e.options : []).filter((o) => o && typeof o === 'object' && typeof o.label === 'string' && o.label)
    .map((o) => ({ label: o.label, description: typeof o.description === 'string' ? o.description : '' }));
  return {
    id: e.id, question: e.question, background: str(e.background), options, recommendation: str(e.recommendation), why: str(e.why),
    blocks: str(e.blocks), source: str(e.source), opened_at: new Date(opened).toISOString(),
    stale: nowMs - opened > STALE_MS, age_s: Math.max(0, Math.floor((nowMs - opened) / 1000)),
  };
}

function readDecision({ commonDir, key, root, identity, nowMs }) {
  try {
    if (!commonDir || !key) return null;
    const file = decisionFile(commonDir, key, root);
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.schema !== 'autopilot.decision/2' || !Array.isArray(v.decisions)) return null;
    if (v.project_key !== key || v.repo_identity !== identity || (v.root_run_id || null) !== (root || null)) return null;
    const value = v.decisions.map((e) => viewOf(e, nowMs)).filter(Boolean)
      .sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at) || (a.id < b.id ? -1 : 1));
    if (value.length === 0) return null;
    return { value, sha256: crypto.createHash('sha256').update(raw).digest('hex'), file };
  } catch (_error) {
    return null;
  }
}

module.exports = { readDecision, decisionFile, STALE_MS };
