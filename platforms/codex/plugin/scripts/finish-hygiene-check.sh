#!/usr/bin/env bash
# finish-hygiene-check.sh <repo>
# Print local branches other than the trunk (develop, else main) and linked
# worktrees other than the main checkout. Exit 0 when both lists are empty.
set -euo pipefail

repo="${1:?usage: finish-hygiene-check.sh <repo>}"
git -C "$repo" rev-parse --is-inside-work-tree >/dev/null

trunk=""
if git -C "$repo" show-ref --verify --quiet refs/heads/develop; then
  trunk=develop
elif git -C "$repo" show-ref --verify --quiet refs/heads/main; then
  trunk=main
else
  echo "no trunk (develop or main)" >&2
  exit 1
fi

dirty=0
while IFS= read -r branch; do
  [ -z "$branch" ] && continue
  [ "$branch" = "$trunk" ] && continue
  printf 'branch %s\n' "$branch"
  dirty=1
done < <(git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads)

main_wt="$(git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')"
while IFS= read -r wt; do
  [ -z "$wt" ] && continue
  [ "$wt" = "$main_wt" ] && continue
  printf 'worktree %s\n' "$wt"
  dirty=1
done < <(git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')

exit "$dirty"
