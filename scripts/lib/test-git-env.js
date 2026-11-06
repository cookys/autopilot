'use strict';
// Test-only. Loading this module drops the repo-selecting GIT_* variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
// GIT_COMMON_DIR, ...) from this process's environment, so a fixture's `git init` / `git commit` in a scratch dir
// cannot be redirected into the repo that launched the test (git bisect run, a git hook, a linked worktree).
// Incident: dispatch-hetero-account.test.js under `git bisect run` committed `base` into the bisect worktree.
// Tests that need a specific GIT_DIR set it explicitly on the child env after loading this.
const { REPO_SELECTING } = require('../../src/status/git-env');

function scrubGitEnv(env = process.env) {
  for (const name of REPO_SELECTING) delete env[name];
  return env;
}

scrubGitEnv();

module.exports = { scrubGitEnv };
