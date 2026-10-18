#!/usr/bin/env bash
# RED at 39cb6835f5d1b06abb4568dab9d9aae40a961601: FAIL [test-tmp-guard] 12 passed, 1 failed — real directory under TEST_TMP: exit 0: expected '127', got '0' (require_under_test_tmp: command not found)
# require_under_test_tmp must stop an empty `git -C` path from resetting
# whatever directory the suite happens to be in. The dangerous case below
# reproduces that fall-through only inside a throwaway repo under TEST_TMP.
. "$(dirname "$0")/lib.sh"
trap cleanup_test_tmp EXIT

TW="$TEST_TMP/throwaway"
mkdir -p "$TW"
git -C "$TW" init -q -b main
git -C "$TW" config user.email t@t
git -C "$TW" config user.name t
git -C "$TW" commit -q --allow-empty -m first
HEAD_FIRST="$(git -C "$TW" rev-parse HEAD)"
git -C "$TW" commit -q --allow-empty -m second
HEAD_SECOND="$(git -C "$TW" rev-parse HEAD)"
cd "$TW" || exit 1

# CASE dangerous-empty-repo — documents the unguarded behaviour. Runs only in $TW.
(
  REPO=""
  git -C "$REPO" reset -q --hard HEAD~1
)
assert_eq "$HEAD_FIRST" "$(git rev-parse HEAD)" "dangerous empty REPO: reset fell through and moved HEAD"
git reset -q --hard "$HEAD_SECOND"

expect_reject() { # <label> <path>
  local before rc
  before="$(git rev-parse HEAD)"
  rc=0
  ( require_under_test_tmp "$2" ) || rc=$?
  assert_neq "0" "$rc" "$1: require_under_test_tmp exits non-zero"
  assert_eq "$before" "$(git rev-parse HEAD)" "$1: HEAD unchanged"
}

expect_reject "empty path" ""
expect_reject "nonexistent path" "$TEST_TMP/does-not-exist"
expect_reject "outside TEST_TMP" "$(dirname "$TEST_TMP")"
expect_reject "filesystem root" "/"
mkdir -p "$TEST_TMP/links"
ln -s / "$TEST_TMP/links/escape"
expect_reject "symlink under TEST_TMP pointing outside" "$TEST_TMP/links/escape"

before="$(git rev-parse HEAD)"
rc=0
( require_under_test_tmp "$TW" ) || rc=$?
assert_eq "0" "$rc" "real directory under TEST_TMP: exit 0"
assert_eq "$before" "$(git rev-parse HEAD)" "real directory under TEST_TMP: HEAD unchanged"

finalize_test
