'use strict';

// Environment for the watcher's own git children. A detached watcher inherits the environment of the hook that started it, and a hook run
// from inside a git process (or a test harness) can carry repository-selecting variables that point git at another repository or at
// nothing: GIT_DIR=/nonexistent makes every `git worktree list` in the watcher fail with rc 128 whatever its cwd. The watcher selects its
// repository by cwd / `git -C`, so these are dropped. GIT_CEILING_DIRECTORIES and the config variables are kept on purpose.
const REPO_SELECTING = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX', 'GIT_NAMESPACE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INTERNAL_SUPER_PREFIX', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE',
];

function cleanGitEnv(env = process.env) {
  const out = { ...env };
  for (const name of REPO_SELECTING) delete out[name];
  return out;
}

module.exports = { cleanGitEnv, REPO_SELECTING };
