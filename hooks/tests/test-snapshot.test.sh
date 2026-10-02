#!/usr/bin/env bash
# P2: lib/test-snapshot.sh guard + baseline (G6, G7). Snapshot still off.
#
# RED at c6755303: bash: hooks/tests/lib/test-snapshot.sh: No such file or directory
. "$(dirname "$0")/lib.sh"

SNAP_LIB="$(cd "$(dirname "$0")" && pwd)/lib/test-snapshot.sh"
# shellcheck disable=SC1090
. "$SNAP_LIB"

make_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config --local user.name "Fixture User"
  git -C "$dir" config --local user.email "fixture@example.invalid"
}

# --- RED1: core.foo added by child is restored; key named; value absent from output ---
{
  fx="$TEST_TMP/red1"
  make_fixture "$fx"
  st="$TEST_TMP/red1-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" config --local core.foo SECRETVALUE
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_exit_code "$rc" 1 "RED1 after returns non-zero"
  assert_contains "$out" "core.foo" "RED1 names core.foo"
  assert_not_contains "$out" "SECRETVALUE" "RED1 does not leak SECRETVALUE"
  if git -C "$fx" config --local --get core.foo >/dev/null 2>&1; then
    fail "RED1 core.foo should be absent after restore"
  else
    assert_eq 0 0 "RED1 core.foo absent after restore"
  fi
}

# --- RED2: changed pre-existing key restored; neither old nor new value in output ---
{
  fx="$TEST_TMP/red2"
  make_fixture "$fx"
  orig="$(git -C "$fx" config --local --get user.name)"
  st="$TEST_TMP/red2-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" config --local user.name "NEWSECRETNAME"
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_exit_code "$rc" 1 "RED2 after returns non-zero"
  assert_contains "$out" "user.name" "RED2 names user.name"
  assert_not_contains "$out" "$orig" "RED2 does not leak original value"
  assert_not_contains "$out" "NEWSECRETNAME" "RED2 does not leak new value"
  now="$(git -C "$fx" config --local --get user.name)"
  assert_eq "$now" "$orig" "RED2 restored original user.name"
}

# --- RED3: baseline user.email t@t refuses; names key; two unset commands; no edit ---
{
  fx="$TEST_TMP/red3"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "t@t"
  before="$(git -C "$fx" config --local --get user.email)"
  out=""
  rc=0
  out="$(ts_baseline_check "$fx" 2>&1)" || rc=$?
  assert_exit_code "$rc" 1 "RED3 baseline returns non-zero"
  assert_contains "$out" "user.email" "RED3 names user.email"
  assert_contains "$out" "git -C $fx config --local --unset user.name" "RED3 unset user.name"
  assert_contains "$out" "git -C $fx config --local --unset user.email" "RED3 unset user.email"
  after="$(git -C "$fx" config --local --get user.email)"
  assert_eq "$after" "$before" "RED3 config unchanged"
}

# --- NC1: branch.x.remote ignored ---
{
  fx="$TEST_TMP/nc1"
  make_fixture "$fx"
  st="$TEST_TMP/nc1-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" config --local branch.x.remote origin
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "NC1 after returns 0"
  assert_eq "$out" "" "NC1 empty output"
  got="$(git -C "$fx" config --local --get branch.x.remote)"
  assert_eq "$got" "origin" "NC1 branch.x.remote left in place"
}

# --- NC2: owner control address is a clean baseline ---
{
  fx="$TEST_TMP/nc2"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  out=""
  rc=0
  out="$(ts_baseline_check "$fx" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "NC2 baseline returns 0"
  assert_eq "$out" "" "NC2 empty output"
}

# --- NC3: no changes ---
{
  fx="$TEST_TMP/nc3"
  make_fixture "$fx"
  st="$TEST_TMP/nc3-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "NC3 after returns 0"
  assert_eq "$out" "" "NC3 empty output"
}

# --- refs-only: added ref warns, return 0 ---
{
  fx="$TEST_TMP/refs"
  make_fixture "$fx"
  git -C "$fx" commit --allow-empty -q -m init
  st="$TEST_TMP/refs-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" update-ref refs/heads/extra HEAD
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "refs-only after returns 0"
  assert_contains "$out" "WARNING" "refs-only warns"
  assert_contains "$out" "refs/heads/extra" "refs-only names extra ref"
}

# --- refs-move: existing branch tip moves; WARNING names the ref; rc 0 ---
{
  fx="$TEST_TMP/refs-move"
  make_fixture "$fx"
  git -C "$fx" commit --allow-empty -q -m init
  branch="$(git -C "$fx" symbolic-ref --short HEAD)"
  st="$TEST_TMP/refs-move-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" commit --allow-empty -q -m second
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "refs-move after returns 0"
  assert_contains "$out" "WARNING" "refs-move warns"
  assert_contains "$out" "refs/heads/$branch" "refs-move names current branch"
}

# --- slash-key drift: child sets url.https://example.invalid/.insteadOf ---
{
  fx="$TEST_TMP/slash-drift"
  make_fixture "$fx"
  st="$TEST_TMP/slash-drift-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  git -C "$fx" config --local 'url.https://example.invalid/.insteadOf' x
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_exit_code "$rc" 1 "slash-drift after returns non-zero"
  assert_contains "$out" "url.https://example.invalid/.insteadof" "slash-drift names slash key"
  assert_eq "$out" "test-guard: REAL-REPO CONFIG DRIFT url.https://example.invalid/.insteadof" "slash-drift output is key name only"
  if git -C "$fx" config --local --get 'url.https://example.invalid/.insteadOf' >/dev/null 2>&1; then
    fail "slash-drift slash key should be absent after restore"
  else
    assert_eq 0 0 "slash-drift slash key absent after restore"
  fi
}

# --- slash-key baseline unchanged: guard returns 0, empty output ---
{
  fx="$TEST_TMP/slash-nc"
  make_fixture "$fx"
  git -C "$fx" config --local 'url.https://example.invalid/.insteadOf' x
  st="$TEST_TMP/slash-nc-state"
  mkdir -p "$st"
  ts_guard_before "$fx" "$st"
  out=""
  rc=0
  out="$(ts_guard_after "$fx" "$st" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "slash-nc after returns 0"
  assert_eq "$out" "" "slash-nc empty output"
}

finalize_test
