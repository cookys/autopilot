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

module.exports = { safeSegment, scopeKeyOf, commonDirOf };
