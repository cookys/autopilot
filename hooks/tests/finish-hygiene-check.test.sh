#!/usr/bin/env bash
# The finish-flow merge step's command block, copied from the skill markers,
# leaves no feature branch and no extra worktree. Skipping the delete lines does not.
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0

SKILL="$REPO_ROOT/skills/finish-flow/SKILL.md"
CHECK="$REPO_ROOT/scripts/finish-hygiene-check.sh"
assert_file_exists "$SKILL" "finish-flow skill"
assert_file_exists "$CHECK" "finish-hygiene-check.sh"

extract_commands() {
  awk '
    /<!-- finish-hygiene-commands -->/ { grab=1; next }
    /<!-- \/finish-hygiene-commands -->/ { grab=0 }
    grab && $0 !~ /^```/ && $0 !~ /^$/ { print }
  ' "$SKILL"
}

COMMANDS="$(extract_commands)"
assert_contains "$COMMANDS" "git branch -d <branch>" "skill block deletes the local branch"
assert_contains "$COMMANDS" "git push origin --delete <branch>" "skill block deletes the remote branch"
assert_contains "$COMMANDS" "git worktree remove <worktree>" "skill block removes the worktree"
assert_contains "$COMMANDS" "git worktree prune" "skill block prunes worktrees"

run_block() {
  local repo="$1" branch="$2" wt="$3" mode="$4"
  local line rendered
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$mode" = "skip-delete" ]; then
      case "$line" in
        "git branch -d <branch>"|"git push origin --delete <branch>") continue ;;
      esac
    fi
    rendered="${line//<branch>/$branch}"
    rendered="${rendered//<worktree>/$wt}"
    ( cd "$repo" && $rendered )
  done <<<"$COMMANDS"
}

make_case() {
  local label="$1"
  local bare="$TEST_TMP/${label}-origin.git"
  local work="$TEST_TMP/${label}-work"
  local wt="$TEST_TMP/${label}-wt"
  git init -q --bare "$bare"
  git -C "$bare" symbolic-ref HEAD refs/heads/develop
  git clone -q "$bare" "$work"
  git -C "$work" config user.name t
  git -C "$work" config user.email t@example.com
  git -C "$work" checkout -q -b develop
  echo base >"$work/README"
  git -C "$work" add README
  git -C "$work" commit -q -m "base"
  git -C "$work" push -q -u origin develop
  git -C "$work" branch feat/hygiene
  git -C "$work" worktree add -q "$wt" feat/hygiene
  echo feature >"$wt/FEATURE"
  git -C "$wt" add FEATURE
  git -C "$wt" commit -q -m "$(printf 'feat: hygiene\n\nFleet-Task: 01M7VARW6FZ9N05HS4ADGW5XTV')"
  git -C "$wt" push -q -u origin feat/hygiene
  git -C "$work" merge -q --no-ff feat/hygiene -m "merge feat/hygiene"
  CASE_WORK="$work"
  CASE_WT="$wt"
}

make_case positive
run_block "$CASE_WORK" feat/hygiene "$CASE_WT" all
set +e
positive_out="$(bash "$CHECK" "$CASE_WORK" 2>&1)"
positive_rc=$?
set -e
assert_eq "$positive_rc" "0" "check exits 0 after the skill commands"
assert_eq "$positive_out" "" "check prints nothing when clean"
remote_left="$(git -C "$CASE_WORK" ls-remote --heads origin feat/hygiene)"
assert_eq "$remote_left" "" "remote has no feature branch"

make_case negative
run_block "$CASE_WORK" feat/hygiene "$CASE_WT" skip-delete
set +e
negative_out="$(bash "$CHECK" "$CASE_WORK" 2>&1)"
negative_rc=$?
set -e
assert_eq "$negative_rc" "1" "skipping the delete step exits 1"
assert_contains "$negative_out" "branch feat/hygiene" "the leftover branch is printed"

finalize_test
