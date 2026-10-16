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

module.exports = { safeSegment, scopeKeyOf, commonDirOf, listScopeFiles, readScopeFile };
