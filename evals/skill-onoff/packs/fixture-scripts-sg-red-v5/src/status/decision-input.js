'use strict';

// src/status/decision-input.js — the open owner question of a watcher scope (mods P1W W2a-m).
// File: <git-common-dir>/autopilot/decisions/<scope_key>.json, schema autopilot.decision/1 (written by
// scripts/open-decision.js). Present = an open question; answered / withdrawn = the helper removed the file.
// A file only counts for THIS scope when every binding matches: schema, string question, project_key, repo_identity,
// root_run_id (null for the unbound scope) and a parseable opened_at that is not from the future (beyond a small slack).
// Age never hides a question (expiry warns, never blocks): older than STALE_MS only sets `stale: true`; `age_s` is always given.
// Only `open-decision.js close` removes a question. Anything else is ignored.
// Returns { value, sha256, file } where value is shaped for the renderer (options -> [{label, consequence}]) or null.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scopeKeyOf } = require('./scope-key');

const STALE_MS = 7 * 86400 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

function decisionFile(commonDir, key, root) {
  return path.join(commonDir, 'autopilot', 'decisions', `${scopeKeyOf(key, root)}.json`);
}

function readDecision({ commonDir, key, root, identity, nowMs }) {
  try {
    if (!commonDir || !key) return null;
    const file = decisionFile(commonDir, key, root);
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || v.schema !== 'autopilot.decision/1') return null;
    if (typeof v.question !== 'string' || !v.question) return null;
    if (v.project_key !== key || v.repo_identity !== identity || (v.root_run_id || null) !== (root || null)) return null;
    const opened = Date.parse(v.opened_at);
    if (!Number.isFinite(opened) || opened - nowMs > FUTURE_SLACK_MS) return null;
    const options = Array.isArray(v.options) ? v.options.filter((o) => typeof o === 'string').map((label) => ({ label, consequence: '' })) : [];
    const value = { question: v.question, options, not_authorized: typeof v.not_authorized === 'string' && v.not_authorized ? v.not_authorized : null,
      stale: nowMs - opened > STALE_MS, age_s: Math.max(0, Math.floor((nowMs - opened) / 1000)) };
    return { value, sha256: crypto.createHash('sha256').update(raw).digest('hex'), file };
  } catch (_error) {
    return null;
  }
}

module.exports = { readDecision, decisionFile, STALE_MS };
