# Test-only. Source it at the top of a bash test that runs git in a scratch repo and does not source hooks/tests/lib.sh:
#   . "$(dirname "$0")/lib/test-git-env.sh"        (path relative to the test file)
# It unsets the repo-selecting GIT_* variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR, ...) so a fixture's
# `git init` / `git add -A` / `git commit` cannot be redirected into the repo that launched the test (git bisect run, a git hook,
# a linked worktree). It also points GIT_CONFIG_GLOBAL at scripts/lib/test-gitconfig (a fixed identity, nothing else) and sets
# GIT_CONFIG_NOSYSTEM=1, so the running account's global/system git config (core.hooksPath hooks such as the lab hook, templateDir,
# filters) never runs inside a fixture repo. A test that exercises a global config does so by exporting its own GIT_CONFIG_GLOBAL after
# sourcing this. The name list is src/status/git-env.js REPO_SELECTING, read at source time: no second copy lives here.
__tge_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
__tge_names="$(node -p "require('$__tge_root/src/status/git-env.js').REPO_SELECTING.join(' ')")" || { echo "test-git-env.sh: cannot read REPO_SELECTING" >&2; return 1 2>/dev/null || exit 1; }
# shellcheck disable=SC2086
unset $__tge_names
export GIT_CONFIG_GLOBAL="$__tge_root/scripts/lib/test-gitconfig" GIT_CONFIG_NOSYSTEM=1
unset __tge_root __tge_names
