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

// Every scope file of one project in a decisions dir: the unbound `<key>.json` and each `<key>--<root>.json`.
// Returns [{ file, root }] (root = the safeSegment text of the name, null for unbound). A root that swaps mid-session
// (compaction, /reload-plugins) leaves cards in several files; readers take them all. A foreign project whose key starts
// with `<key>--` also matches by name: callers must still check project_key / repo_identity inside the file.
function listScopeFiles(dir, projectKey) {
  const fs = require('fs');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_error) { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json')) continue;
    const base = n.slice(0, -5);
    if (base === projectKey) out.push({ file: require('path').join(dir, n), root: null });
    else if (base.startsWith(`${projectKey}--`) && base.length > projectKey.length + 2) out.push({ file: require('path').join(dir, n), root: base.slice(projectKey.length + 2) });
  }
  return out;
}

module.exports = { safeSegment, scopeKeyOf, commonDirOf, listScopeFiles };
