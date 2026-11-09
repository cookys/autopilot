'use strict';
// Test-only. Loading this module drops the repo-selecting GIT_* variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
// GIT_COMMON_DIR, ...) from this process's environment, so a fixture's `git init` / `git commit` in a scratch dir
// cannot be redirected into the repo that launched the test (git bisect run, a git hook, a linked worktree).
// Incident: dispatch-hetero-account.test.js under `git bisect run` committed `base` into the bisect worktree.
// Tests that need a specific GIT_DIR set it explicitly on the child env after loading this.
// It also points GIT_CONFIG_GLOBAL at scripts/lib/test-gitconfig (a fixed identity, nothing else) and sets GIT_CONFIG_NOSYSTEM=1, so the running
// account's global/system git config (core.hooksPath hooks such as the lab hook, templateDir, filters) never runs inside a fixture repo.
// A test that exercises a global config sets its own GIT_CONFIG_GLOBAL after loading this.
const path = require('path');
const { REPO_SELECTING } = require('../../src/status/git-env');

function scrubGitEnv(env = process.env) {
  for (const name of REPO_SELECTING) delete env[name];
  env.GIT_CONFIG_GLOBAL = path.join(__dirname, 'test-gitconfig');
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

scrubGitEnv();

module.exports = { scrubGitEnv };
