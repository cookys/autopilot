#!/usr/bin/env bash
# git-env-hygiene.test.sh — the suite must not leak repo-local git env (GIT_DIR)
# into tests, or a scratch `git init && git config user.name` rewrites the REAL
# repo's shared config (linked-worktree pre/post-commit hooks export GIT_DIR).
# Everything here happens in a scratch "real" repo under TEST_TMP; the actual
# autopilot repo is never referenced.
. "$(dirname "$0")/lib.sh"

REAL="$TEST_TMP/real"
WT="$TEST_TMP/wt"
SCRATCH="$TEST_TMP/scratch"
mkdir -p "$REAL" "$SCRATCH"
git -C "$REAL" init -q
git -C "$REAL" -c user.name=seed -c user.email=seed@example.invalid commit -q --allow-empty -m seed
git -C "$REAL" worktree add -q "$WT" -b wt-branch
WT_GITDIR="$(git -C "$WT" rev-parse --absolute-git-dir)"

# lib.sh's unset line, same in effect.
apply_unset() {
  local vars
  vars="$(git rev-parse --local-env-vars 2>/dev/null)" || vars=""
  [ -n "$vars" ] || vars="GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_PREFIX GIT_NAMESPACE GIT_SHALLOW_FILE GIT_GRAFT_FILE GIT_IMPLICIT_WORK_TREE GIT_INTERNAL_SUPER_PREFIX GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE"
  # shellcheck disable=SC2086
  unset $vars
}

real_name() { git -C "$REAL" config --local --get user.name 2>/dev/null || true; }

assert_eq "$(real_name)" "" "precondition: scratch real repo has no local user.name"

# Negative control: WITHOUT the unset, the offending snippet leaks.
( export GIT_DIR="$WT_GITDIR"; cd "$SCRATCH" && git init -q && git config user.name "Test User" ) >/dev/null 2>&1
assert_eq "$(real_name)" "Test User" "negative control: without unset, GIT_DIR leak writes Test User into the real repo"
git -C "$REAL" config --local --unset-all user.name
assert_eq "$(real_name)" "" "negative control cleanup: real repo identity cleared"

# Positive: WITH the unset applied, the same snippet cannot reach the real repo.
( export GIT_DIR="$WT_GITDIR"; apply_unset; cd "$SCRATCH" && git init -q && git config user.name "Test User" ) >/dev/null 2>&1
assert_eq "$(real_name)" "" "with unset: real repo still has no local user.name"
assert_eq "$(git -C "$SCRATCH" config --local --get user.name 2>/dev/null)" "Test User" "with unset: identity landed in the scratch repo instead"

# lib.sh itself must drop GIT_DIR when sourced with it exported.
out="$(GIT_DIR="$WT_GITDIR" bash -c '. "$1/hooks/tests/lib.sh"; printf "%s" "${GIT_DIR:-unset}"' _ "$REPO_ROOT" 2>/dev/null)"
assert_eq "$out" "unset" "lib.sh unsets an inherited GIT_DIR"

finalize_test
