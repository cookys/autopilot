'use strict';

// src/status/project-key.js — project_key = sha256(repo_identity)[0:16] (mods plan §2.8).
// Computed ONLY here (CLI side); the mod and renderer read it, never derive it.
// repo_identity itself comes from task-runtime.js:repoIdentity() — no git logic is duplicated.

const crypto = require('crypto');
const { repoIdentity } = require('./task-runtime');

function projectKey(identity) {
  if (typeof identity !== 'string' || identity === '') {
    throw new TypeError('projectKey: repo_identity must be a non-empty string');
  }
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

// cwd -> { repo_identity, project_key }; nulls (never throws) when cwd is not in a git repo.
function scopeFromCwd(cwd) {
  let identity = null;
  try {
    identity = repoIdentity(cwd);
  } catch (_error) {
    identity = null;
  }
  return {
    repo_identity: identity,
    project_key: identity ? projectKey(identity) : null,
  };
}

module.exports = { projectKey, scopeFromCwd };
