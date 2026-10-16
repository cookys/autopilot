#!/usr/bin/env bash
# close-session-main-behind-hint.test.sh — BL-0006: close-session --yes prints the owner's pull line
# when the main checkout lags its upstream, and prints nothing extra when it is current.
# Negative control: remove the hint call in repo-residue-sweep.js and the "lagging" row goes red.
. "$(dirname "$0")/lib.sh"
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
G() { git -C "$1" "${@:2}" >/dev/null 2>&1; }
ORIGIN="$TEST_TMP/origin"; mkdir -p "$ORIGIN"; G "$ORIGIN" init -q -b develop; G "$ORIGIN" commit -q --allow-empty -m init
MAIN="$(cd "$TEST_TMP" && pwd -P)/main"; git clone -q "$ORIGIN" "$MAIN" 2>/dev/null
WT="$TEST_TMP/wt"; G "$MAIN" worktree add -q -b feat/x "$WT"
S="$REPO_ROOT/scripts/repo-residue-sweep.js"
run() { node "$S" close-session --session sid1 --yes --repo "$WT" 2>&1 >/dev/null; }

assert_not_contains "$(run)" "behind origin" "current main checkout: no hint"
G "$ORIGIN" commit -q --allow-empty -m c1; G "$ORIGIN" commit -q --allow-empty -m c2; G "$MAIN" fetch -q origin
OUT="$(run)"
assert_contains "$OUT" "main checkout is 2 commits behind origin" "lagging main checkout: hint with the count"
assert_contains "$OUT" "git -C $MAIN pull --ff-only" "lagging main checkout: hint carries the pull line"
OUT_DRY="$(node "$S" close-session --session sid1 --repo "$WT" 2>&1 >/dev/null)"
assert_not_contains "$OUT_DRY" "behind origin" "dry run stays silent"
finalize_test
