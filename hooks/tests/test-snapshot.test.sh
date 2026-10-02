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

# --- P4a fixtures ---
make_rich_fixture() {
  local dir="$1"
  make_fixture "$dir"
  printf 'tracked-v1\n' >"$dir/tracked.txt"
  printf 'untracked-v1\n' >"$dir/untracked.txt"
  printf 'ignored-v1\n' >"$dir/ignored.txt"
  printf 'ignored.txt\n' >"$dir/.gitignore"
  mkdir -p "$dir/nested"
  printf 'gitdir: /nonexistent\n' >"$dir/nested/.git"
  git -C "$dir" add tracked.txt .gitignore
  git -C "$dir" commit -q -m init
  printf 'tracked-unstaged\n' >>"$dir/tracked.txt"
}

copy_runner_into_fixture() {
  local dest="$1"
  mkdir -p "$dest/hooks/tests" "$dest/scripts"
  cp "$REPO_ROOT/hooks/tests/run.sh" "$dest/hooks/tests/run.sh"
  cp "$REPO_ROOT/hooks/tests/lib.sh" "$dest/hooks/tests/lib.sh"
  cp -a "$REPO_ROOT/hooks/tests/lib" "$dest/hooks/tests/lib"
  cp -a "$REPO_ROOT/scripts/lib" "$dest/scripts/lib"
  chmod +x "$dest/hooks/tests/run.sh"
}

# --- P4a KR1 + working-tree copy + origin + link count ---
{
  fx="$TEST_TMP/p4a-rich"
  make_rich_fixture "$fx"
  cfg_before="$(git -C "$fx" config --local --list)"
  tracked_before="$(cat "$fx/tracked.txt")"
  snap="$TEST_TMP/p4a-rich-snap"
  mkdir -p "$snap"
  out=""
  rc=0
  out="$(ts_snapshot_build "$fx" "$snap" 2>&1)" || rc=$?
  # RED at 414ef8ac: bash: line 226: ts_snapshot_build: command not found
  assert_exit_code "$rc" 0 "P4a build returns 0"
  assert_eq "$out" "" "P4a build silent on success"
  git -C "$snap/repo" config --local x.y 1
  printf 'child-edit\n' >>"$snap/repo/tracked.txt"
  cfg_after="$(git -C "$fx" config --local --list)"
  tracked_after="$(cat "$fx/tracked.txt")"
  assert_eq "$cfg_after" "$cfg_before" "P4a KR1 fixture config unchanged"
  assert_eq "$tracked_after" "$tracked_before" "P4a KR1 fixture tracked bytes unchanged"
  origin="$(git -C "$snap/repo" remote get-url origin)"
  assert_eq "$origin" "/nonexistent/autopilot-test-snapshot-origin" "P4a origin neutered"
  assert_file_exists "$snap/repo/untracked.txt" "P4a untracked copied"
  assert_file_exists "$snap/repo/ignored.txt" "P4a ignored copied"
  assert_eq "$(cat "$snap/repo/untracked.txt")" "$(cat "$fx/untracked.txt")" "P4a untracked bytes"
  assert_eq "$(cat "$snap/repo/ignored.txt")" "$(cat "$fx/ignored.txt")" "P4a ignored bytes"
  assert_eq "$(cat "$snap/repo/tracked.txt")" "tracked-v1"$'\n'"tracked-unstaged"$'\n'"child-edit" "P4a snapshot has unstaged plus child"
  assert_file_absent "$snap/repo/nested/.git" "P4a nested gitdir file not copied"
  nlink_bad=0
  while IFS= read -r -d '' f; do
    n="$(stat -c '%h' "$f")"
    if [ "$n" -gt 1 ]; then
      nlink_bad=1
      break
    fi
  done < <(find "$snap/repo" -type f -print0)
  assert_eq "$nlink_bad" 0 "P4a snapshot regular files link count 1"
  fx_inode="$(stat -c '%i' "$fx/tracked.txt")"
  snap_inode="$(stat -c '%i' "$snap/repo/tracked.txt")"
  assert_neq "$fx_inode" "$snap_inode" "P4a snapshot inode differs from fixture"
}

# --- P4a relative tracked write lands only in snapshot ---
{
  fx="$TEST_TMP/p4a-relwrite"
  make_rich_fixture "$fx"
  before="$(cat "$fx/tracked.txt")"
  snap="$TEST_TMP/p4a-relwrite-snap"
  mkdir -p "$snap"
  if ! ts_snapshot_build "$fx" "$snap"; then
    fail "P4a relative-write snapshot build failed"
  fi
  # RED at 414ef8ac: bash: line 273: ts_snapshot_build: command not found
  if ! (
    cd "$snap/repo" || exit 1
    printf 'rel-child\n' >>tracked.txt
  ); then
    fail "P4a relative-write cd into snapshot failed"
  fi
  assert_eq "$(cat "$fx/tracked.txt")" "$before" "P4a relative write misses fixture"
  assert_contains "$(cat "$snap/repo/tracked.txt")" "rel-child" "P4a relative write in snapshot"
}

# --- P4a fail-closed: alternates ---
{
  fx="$TEST_TMP/p4a-alt-src"
  make_rich_fixture "$fx"
  wrap="$TEST_TMP/p4a-gitwrap"
  mkdir -p "$wrap"
  cat >"$wrap/git" <<'EOF'
#!/usr/bin/env bash
real=/usr/bin/git
"$real" "$@"
ec=$?
is_clone=0
for a in "$@"; do
  [ "$a" = clone ] && is_clone=1
done
if [ "$is_clone" -eq 1 ] && [ "$ec" -eq 0 ]; then
  dest="${@: -1}"
  mkdir -p "$dest/.git/objects/info"
  printf '/nonexistent/alternates-src\n' >"$dest/.git/objects/info/alternates"
fi
exit "$ec"
EOF
  chmod +x "$wrap/git"
  snap="$TEST_TMP/p4a-alt-snap"
  mkdir -p "$snap"
  out=""
  rc=0
  out="$(PATH="$wrap:$PATH" ts_snapshot_build "$fx" "$snap" 2>&1)" || rc=$?
  # RED at 414ef8ac: bash: line 305: ts_snapshot_build: command not found
  assert_exit_code "$rc" 1 "P4a alternates construction fails"
  assert_contains "$out" "alternates" "P4a alternates names the check"
}

# --- P4a fail-closed: absolute symlink into real root ---
{
  fx="$TEST_TMP/p4a-abslink"
  make_rich_fixture "$fx"
  ln -s "$fx/tracked.txt" "$fx/abs-into-real"
  snap="$TEST_TMP/p4a-abslink-snap"
  mkdir -p "$snap"
  out=""
  rc=0
  out="$(ts_snapshot_build "$fx" "$snap" 2>&1)" || rc=$?
  # RED at 414ef8ac: bash: line 320: ts_snapshot_build: command not found
  assert_exit_code "$rc" 1 "P4a abs symlink construction fails"
  assert_contains "$out" "symlink" "P4a abs symlink names the check"
}

# --- P4a ts_snapshot_remove worktree + idempotent ---
{
  fx="$TEST_TMP/p4a-rm"
  make_rich_fixture "$fx"
  snap="$TEST_TMP/p4a-rm-snap"
  mkdir -p "$snap"
  ts_snapshot_build "$fx" "$snap"
  # RED at 414ef8ac: bash: line 333: ts_snapshot_build: command not found
  git -C "$snap/repo" worktree add -q "$snap/extra-wt" -b extra-wt
  wt_before="$(git -C "$fx" worktree list --porcelain)"
  out=""
  rc=0
  out="$(ts_snapshot_remove "$snap" 2>&1)" || rc=$?
  assert_exit_code "$rc" 0 "P4a remove returns 0"
  assert_file_absent "$snap" "P4a container removed"
  wt_after="$(git -C "$fx" worktree list --porcelain)"
  assert_eq "$wt_after" "$wt_before" "P4a fixture worktree list unchanged"
  out2=""
  rc2=0
  out2="$(ts_snapshot_remove "$snap" 2>&1)" || rc2=$?
  assert_exit_code "$rc2" 0 "P4a remove twice succeeds"
}

# --- P4a real outer run.sh (success) ---
{
  fx="$TEST_TMP/p4a-outer"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "owner@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'SNAPSHOT_ROOT=%s\n' "$REPO_ROOT" >"${FIXTURE_MARKER}"
git -C "$REPO_ROOT" config --local zz.touched 1
printf 'mutated\n' >>"$REPO_ROOT/tracked.txt"
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4a-outer-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4a-outer.marker"
  cfg_before="$(git -C "$fx" config --local --list)"
  tracked_before="$(cat "$fx/tracked.txt")"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  # RED at 414ef8ac: outer run mutates fixture (no snapshot child)
  assert_exit_code "$rc" 0 "P4a outer real run exit 0"
  got_root="$(sed -n 's/^SNAPSHOT_ROOT=//p' "$marker")"
  assert_neq "$got_root" "$fx" "P4a outer child REPO_ROOT is not fixture"
  case "$got_root" in
    "$priv"/*) assert_eq 0 0 "P4a outer child under private TMPDIR" ;;
    *) fail "P4a outer child REPO_ROOT not under private TMPDIR: $got_root" ;;
  esac
  cfg_after="$(git -C "$fx" config --local --list)"
  tracked_after="$(cat "$fx/tracked.txt")"
  assert_eq "$cfg_after" "$cfg_before" "P4a outer fixture config unchanged"
  assert_eq "$tracked_after" "$tracked_before" "P4a outer fixture tracked unchanged"
  leftover=0
  shopt -s nullglob
  for d in "$priv"/autopilot-test-snapshot.*; do
    leftover=1
  done
  shopt -u nullglob
  assert_eq "$leftover" 0 "P4a outer no snapshot residue"
}

# --- P4a real outer run.sh (child non-zero) ---
{
  fx="$TEST_TMP/p4a-outer-fail"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "owner@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'SNAPSHOT_ROOT=%s\n' "$REPO_ROOT" >"${FIXTURE_MARKER}"
git -C "$REPO_ROOT" config --local zz.touched 1
exit 1
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4a-outer-fail-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4a-outer-fail.marker"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  # RED at 414ef8ac: fixture run still in-place; residue/exit contract unsatisfied until outer snapshot
  assert_neq "$rc" 0 "P4a outer nonzero child => outer nonzero"
  leftover=0
  shopt -s nullglob
  for d in "$priv"/autopilot-test-snapshot.*; do
    leftover=1
  done
  shopt -u nullglob
  assert_eq "$leftover" 0 "P4a outer nonzero no snapshot residue"
}

# --- P4a NC: AUTOPILOT_TEST_SNAPSHOT=0 in place ---
{
  fx="$TEST_TMP/p4a-nc"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "owner@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'SNAPSHOT_ROOT=%s\n' "$REPO_ROOT" >"${FIXTURE_MARKER}"
git -C "$REPO_ROOT" config --local zz.touched 1
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4a-nc-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4a-nc.marker"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT \
    AUTOPILOT_TEST_SNAPSHOT=0 TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  # RED at 414ef8ac: missing "test-snapshot: disabled" line (opt-out not wired)
  assert_neq "$rc" 0 "P4a NC disabled run fails after guard"
  assert_contains "$out" "test-snapshot: disabled" "P4a NC disabled stderr prefix"
  assert_contains "$out" "zz.touched" "P4a NC names drifted key"
  got_root="$(sed -n 's/^SNAPSHOT_ROOT=//p' "$marker")"
  assert_eq "$got_root" "$fx" "P4a NC runs in fixture root"
  if git -C "$fx" config --local --get zz.touched >/dev/null 2>&1; then
    fail "P4a NC zz.touched should be restored/absent"
  else
    assert_eq 0 0 "P4a NC zz.touched absent after guard"
  fi
}

# --- P4 process group: inner PGID == inner PID != outer; group INT => 130 ---
{
  fx="$TEST_TMP/p4-pgid"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "owner@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'ready\n' >"${FIXTURE_MARKER}"
sleep 30
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4-pgid-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4-pgid.marker"
  set -m
  env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 &
  outer=$!
  set +m
  inner=""
  for _i in $(seq 1 100); do
    inner="$(ps -o pid= --ppid "$outer" 2>/dev/null | awk 'NF{print $1; exit}')"
    if [ -n "$inner" ] && [ -f "$marker" ]; then
      break
    fi
    sleep 0.1
  done
  if [ -z "$inner" ]; then
    kill "$outer" 2>/dev/null || true
    wait "$outer" 2>/dev/null || true
    fail "P4 pgid: no inner child of outer"
  fi
  inner_pgid="$(ps -o pgid= -p "$inner" 2>/dev/null | tr -d '[:space:]')"
  outer_pgid="$(ps -o pgid= -p "$outer" 2>/dev/null | tr -d '[:space:]')"
  inner="$(printf '%s' "$inner" | tr -d '[:space:]')"
  assert_eq "$inner_pgid" "$inner" "P4 pgid: inner PGID equals inner PID"
  assert_neq "$inner_pgid" "$outer_pgid" "P4 pgid: inner PGID differs from outer"
  kill -s INT -- "-$inner_pgid" >/dev/null 2>&1 || true
  rc=0
  wait "$outer" || rc=$?
  assert_exit_code "$rc" 130 "P4 pgid: SIGINT to inner group is trapped (130)"
}

# --- P4 --parallel one-file filter still uses snapshot ---
{
  fx="$TEST_TMP/p4-par"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "owner@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'SNAPSHOT_ROOT=%s\n' "$REPO_ROOT" >"${FIXTURE_MARKER}"
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4-par-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4-par.marker"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" --parallel 2 zz-fixture-one </dev/null 2>&1)" || rc=$?
  assert_exit_code "$rc" 0 "P4 parallel filtered outer exit 0"
  got_root="$(sed -n 's/^SNAPSHOT_ROOT=//p' "$marker")"
  assert_neq "$got_root" "$fx" "P4 parallel child REPO_ROOT is not fixture"
  case "$got_root" in
    "$priv"/*) assert_eq 0 0 "P4 parallel child under private TMPDIR" ;;
    *) fail "P4 parallel child REPO_ROOT not under private TMPDIR: $got_root" ;;
  esac
}

finalize_test
