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
  git -C "$fx" config --local user.email "cookys@stranity.com"
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
  git -C "$fx" config --local user.email "cookys@stranity.com"
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
  git -C "$fx" config --local user.email "cookys@stranity.com"
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
  git -C "$fx" config --local user.email "cookys@stranity.com"
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
  if [ -z "$inner" ] || [ ! -f "$marker" ]; then
    kill "$outer" 2>/dev/null || true
    wait "$outer" 2>/dev/null || true
    fail "P4 pgid: readiness not reached (inner='${inner}', marker present=$([ -f "$marker" ] && echo yes || echo no))"
    inner=""
  fi
  if [ -n "$inner" ]; then
    inner_pgid="$(ps -o pgid= -p "$inner" 2>/dev/null | tr -d '[:space:]')"
    outer_pgid="$(ps -o pgid= -p "$outer" 2>/dev/null | tr -d '[:space:]')"
    inner="$(printf '%s' "$inner" | tr -d '[:space:]')"
    assert_eq "$inner_pgid" "$inner" "P4 pgid: inner PGID equals inner PID"
    assert_neq "$inner_pgid" "$outer_pgid" "P4 pgid: inner PGID differs from outer"
    kill -s INT -- "-$inner_pgid" >/dev/null 2>&1 || true
    rc=0
    wait "$outer" || rc=$?
    assert_exit_code "$rc" 130 "P4 pgid: SIGINT to inner group is trapped (130)"
  fi
}

# --- P4 inherited-ignored SIGINT: a runner started as an async/background job
# inherits SIGINT=SIG_IGN (non-interactive bash `&`, nohup-style launchers, the
# --parallel pool's own workers). Bash cannot trap or reset a signal that was
# ignored on entry, so the inner run.sh must be launched with default signal
# dispositions or a group INT is silently swallowed (outer exits 0, not 130).
# This was the intermittent "expected 130, got 0" in the case above, which only
# went red when the suite itself ran inside a --parallel worker.
# RED at 53ddc02f: expected exit 130, got 0
{
  fx="$TEST_TMP/p4-ign"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
printf 'ready\n' >"${FIXTURE_MARKER}"
sleep 3
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4-ign-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4-ign.marker"
  set -m
  (
    trap '' INT
    exec env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
      TMPDIR="$priv" FIXTURE_MARKER="$marker" \
      bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1
  ) &
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
  if [ -z "$inner" ] || [ ! -f "$marker" ]; then
    kill "$outer" 2>/dev/null || true
    wait "$outer" 2>/dev/null || true
    fail "P4 ign: readiness not reached (inner='${inner}', marker present=$([ -f "$marker" ] && echo yes || echo no))"
  else
    inner="$(printf '%s' "$inner" | tr -d '[:space:]')"
    inner_pgid="$(ps -o pgid= -p "$inner" 2>/dev/null | tr -d '[:space:]')"
    assert_eq "$inner_pgid" "$inner" "P4 ign: inner PGID equals inner PID"
    kill -s INT -- "-$inner_pgid" >/dev/null 2>&1 || true
    rc=0
    wait "$outer" || rc=$?
    assert_exit_code "$rc" 130 "P4 ign: group INT is trapped (130) although the runner started with SIGINT ignored"
  fi
}

# --- P4 --parallel one-file filter still uses snapshot ---
{
  fx="$TEST_TMP/p4-par"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
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

# --- P4b (append). RED at 5d5785fb: inner SIGPIPE inherited ignored; no G5
# group wait / construction-TERM cleanup; reaper glob swallowed live snapshots. ---

assert_no_snap_dirs() {
  local priv="$1" leftover=0
  shopt -s nullglob
  for _d in "$priv"/autopilot-test-snapshot.*; do
    leftover=1
  done
  shopt -u nullglob
  assert_eq "$leftover" 0 "no autopilot-test-snapshot.* under $priv"
}

p4b_outer_env() {
  env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT "$@"
}

# RED at 5d5785fb: PIPESTATUS writer is 1/EPIPE because SIGPIPE stays ignored
{
  fx="$TEST_TMP/p4b-sigpipe"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
set +o pipefail
yes P4B_SIGPIPE_WRITER 2>/dev/null | head -n 1 >/dev/null
printf '%s\n' "${PIPESTATUS[0]}" >"${FIXTURE_MARKER}"
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-sigpipe-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4b-sigpipe.marker"
  rc=0
  p4b_outer_env TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 || rc=$?
  assert_exit_code "$rc" 0 "P4b SIGPIPE outer exit 0"
  assert_eq "$(cat "$marker")" "141" "P4b inner writer status 141 (SIGPIPE default)"
  assert_no_snap_dirs "$priv"
}

# RED at 5d5785fb: INT leaves delayed descendant / snapshot container
{
  fx="$TEST_TMP/p4b-int"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
sleep 120 &
echo $! >"${DESCENDANT_PIDFILE}"
printf 'ready\n' >"${FIXTURE_MARKER}"
wait
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-int-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4b-int.marker"
  dpidf="$TEST_TMP/p4b-int.descendant"
  wt_before="$(git -C "$fx" worktree list --porcelain)"
  set -m
  (
    unset AUTOPILOT_SESSION_ID AUTOPILOT_TEST_SNAPSHOT_ROOT AUTOPILOT_TEST_SNAPSHOT
    export TMPDIR="$priv" FIXTURE_MARKER="$marker" DESCENDANT_PIDFILE="$dpidf"
    exec python3 -c 'import os, signal, sys
for name in ("SIGINT", "SIGTERM", "SIGQUIT", "SIGPIPE", "SIGXFSZ"):
    s = getattr(signal, name, None)
    if s is not None:
        signal.signal(s, signal.SIG_DFL)
os.execvp("bash", ["bash"] + sys.argv[1:])
' "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1
  ) &
  outer=$!
  set +m
  for _i in $(seq 1 100); do
    [ -s "$dpidf" ] && [ -f "$marker" ] && break
    sleep 0.1
  done
  kill -s INT "$outer" >/dev/null 2>&1 || true
  rc=0
  wait "$outer" || rc=$?
  assert_exit_code "$rc" 130 "P4b INT mid-run => 130"
  dpid="$(tr -d '[:space:]' <"$dpidf" 2>/dev/null || true)"
  if [ -n "$dpid" ] && kill -0 "$dpid" 2>/dev/null; then
    fail "P4b INT descendant $dpid still alive"
  else
    assert_eq 0 0 "P4b INT descendant gone"
  fi
  assert_no_snap_dirs "$priv"
  wt_after="$(git -C "$fx" worktree list --porcelain)"
  assert_eq "$wt_after" "$wt_before" "P4b INT fixture worktree list unchanged"
}

# RED at 5d5785fb: TERM mid-run leaves residue
{
  fx="$TEST_TMP/p4b-term"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
sleep 120 &
echo $! >"${DESCENDANT_PIDFILE}"
printf 'ready\n' >"${FIXTURE_MARKER}"
wait
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-term-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4b-term.marker"
  dpidf="$TEST_TMP/p4b-term.descendant"
  set -m
  (
    unset AUTOPILOT_SESSION_ID AUTOPILOT_TEST_SNAPSHOT_ROOT AUTOPILOT_TEST_SNAPSHOT
    export TMPDIR="$priv" FIXTURE_MARKER="$marker" DESCENDANT_PIDFILE="$dpidf"
    exec python3 -c 'import os, signal, sys
for name in ("SIGINT", "SIGTERM", "SIGQUIT", "SIGPIPE", "SIGXFSZ"):
    s = getattr(signal, name, None)
    if s is not None:
        signal.signal(s, signal.SIG_DFL)
os.execvp("bash", ["bash"] + sys.argv[1:])
' "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1
  ) &
  outer=$!
  set +m
  for _i in $(seq 1 100); do
    [ -s "$dpidf" ] && [ -f "$marker" ] && break
    sleep 0.1
  done
  kill -s TERM "$outer" >/dev/null 2>&1 || true
  rc=0
  wait "$outer" || rc=$?
  assert_exit_code "$rc" 143 "P4b TERM mid-run => 143"
  dpid="$(tr -d '[:space:]' <"$dpidf" 2>/dev/null || true)"
  if [ -n "$dpid" ] && kill -0 "$dpid" 2>/dev/null; then
    fail "P4b TERM descendant $dpid still alive"
  else
    assert_eq 0 0 "P4b TERM descendant gone"
  fi
  assert_no_snap_dirs "$priv"
}

# RED at 5d5785fb: TERM mid-construction leaves container
{
  fx="$TEST_TMP/p4b-term-ctor"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m init2
  wrap="$TEST_TMP/p4b-rsync-wrap"
  mkdir -p "$wrap"
  cat >"$wrap/rsync" <<'EOF'
#!/usr/bin/env bash
sleep 20
exec /usr/bin/rsync "$@"
EOF
  chmod +x "$wrap/rsync"
  priv="$TEST_TMP/p4b-term-ctor-tmp"
  mkdir -p "$priv"
  set -m
  (
    unset AUTOPILOT_SESSION_ID AUTOPILOT_TEST_SNAPSHOT_ROOT AUTOPILOT_TEST_SNAPSHOT
    export PATH="$wrap:$PATH" TMPDIR="$priv"
    exec python3 -c 'import os, signal, sys
for name in ("SIGINT", "SIGTERM", "SIGQUIT", "SIGPIPE", "SIGXFSZ"):
    s = getattr(signal, name, None)
    if s is not None:
        signal.signal(s, signal.SIG_DFL)
os.execvp("bash", ["bash"] + sys.argv[1:])
' "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1
  ) &
  outer=$!
  set +m
  for _i in $(seq 1 50); do
    shopt -s nullglob
    found=0
    for _d in "$priv"/autopilot-test-snapshot.*; do found=1; done
    shopt -u nullglob
    [ "$found" -eq 1 ] && break
    sleep 0.1
  done
  kill -s TERM "$outer" >/dev/null 2>&1 || true
  wait "$outer" 2>/dev/null || true
  assert_no_snap_dirs "$priv"
}

# RED at 5d5785fb: snapshot-registered worktree survives outer exit
{
  fx="$TEST_TMP/p4b-wt"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
git -C "$REPO_ROOT" worktree add -q "$REPO_ROOT/../extra-wt" -b p4b-extra
printf 'ok\n' >"${FIXTURE_MARKER}"
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-wt-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4b-wt.marker"
  wt_before="$(git -C "$fx" worktree list --porcelain)"
  rc=0
  p4b_outer_env TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 || rc=$?
  assert_exit_code "$rc" 0 "P4b worktree normal exit 0"
  assert_no_snap_dirs "$priv"
  wt_after="$(git -C "$fx" worktree list --porcelain)"
  assert_eq "$wt_after" "$wt_before" "P4b worktree fixture list unchanged after normal"
}

{
  fx="$TEST_TMP/p4b-wt-int"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
git -C "$REPO_ROOT" worktree add -q "$REPO_ROOT/../extra-wt" -b p4b-extra-int
printf 'ready\n' >"${FIXTURE_MARKER}"
sleep 30
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-wt-int-tmp"
  mkdir -p "$priv"
  marker="$TEST_TMP/p4b-wt-int.marker"
  wt_before="$(git -C "$fx" worktree list --porcelain)"
  set -m
  (
    unset AUTOPILOT_SESSION_ID AUTOPILOT_TEST_SNAPSHOT_ROOT AUTOPILOT_TEST_SNAPSHOT
    export TMPDIR="$priv" FIXTURE_MARKER="$marker"
    exec python3 -c 'import os, signal, sys
for name in ("SIGINT", "SIGTERM", "SIGQUIT", "SIGPIPE", "SIGXFSZ"):
    s = getattr(signal, name, None)
    if s is not None:
        signal.signal(s, signal.SIG_DFL)
os.execvp("bash", ["bash"] + sys.argv[1:])
' "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1
  ) &
  outer=$!
  set +m
  for _i in $(seq 1 100); do
    [ -f "$marker" ] && break
    sleep 0.1
  done
  kill -s INT "$outer" >/dev/null 2>&1 || true
  rc=0
  wait "$outer" || rc=$?
  assert_exit_code "$rc" 130 "P4b worktree INT => 130"
  assert_no_snap_dirs "$priv"
  wt_after="$(git -C "$fx" worktree list --porcelain)"
  assert_eq "$wt_after" "$wt_before" "P4b worktree fixture list unchanged after INT"
}

# RED at 5d5785fb: inversion (c) — guard in child misses absolute fixture write
{
  fx="$TEST_TMP/p4b-inv"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
git -C "$FIXTURE_REAL" config --local core.inv 1
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-inv-tmp"
  mkdir -p "$priv"
  out=""
  rc=0
  out="$(p4b_outer_env TMPDIR="$priv" FIXTURE_REAL="$fx" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  assert_neq "$rc" 0 "P4b inversion outer fails"
  assert_contains "$out" "core.inv" "P4b inversion names core.inv"
  if git -C "$fx" config --local --get core.inv >/dev/null 2>&1; then
    fail "P4b inversion core.inv should be restored"
  else
    assert_eq 0 0 "P4b inversion core.inv restored"
  fi
  assert_no_snap_dirs "$priv"
}

{
  fx="$TEST_TMP/p4b-inv-neg"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
git -C "$REPO_ROOT" config --local core.inv 1
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4b-inv-neg-tmp"
  mkdir -p "$priv"
  rc=0
  p4b_outer_env TMPDIR="$priv" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 || rc=$?
  assert_exit_code "$rc" 0 "P4b negative sentinel: snapshot-local config stays green"
  if git -C "$fx" config --local --get core.inv >/dev/null 2>&1; then
    fail "P4b negative fixture must not carry core.inv"
  else
    assert_eq 0 0 "P4b negative fixture config clean"
  fi
  assert_no_snap_dirs "$priv"
}

# Reaper cases — same functions as suite-residue-reaper.test.sh
# shellcheck source=../../scripts/lib/worktree-reap.sh
. "$REPO_ROOT/scripts/lib/worktree-reap.sh"
# shellcheck source=../../scripts/lib/prune-tmp-residue.sh
. "$REPO_ROOT/scripts/lib/prune-tmp-residue.sh"
# shellcheck source=lib/suite-residue-reap.sh
. "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"

extract_json_field() {
  printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | grep -o '[0-9]*$'
}

# RED at 5d5785fb: live snapshot container reaped by autopilot-test-* glob
{
  priv="$TEST_TMP/p4b-reap-live"
  mkdir -p "$priv"
  snap="$(mktemp -d "$priv/autopilot-test-snapshot.XXXXXX")"
  : >"$snap/.autopilot-live.lock"
  flock "$snap/.autopilot-live.lock" sleep 30 &
  holder=$!
  poll_until 5 bash -c "flock -n '$snap/.autopilot-live.lock' -c true 2>/dev/null; [ \$? -eq 1 ]" \
    || fail "P4b reaper live: lock never held"
  out=""
  out="$(TMPDIR="$priv" suite_residue_reap)"
  kill "$holder" >/dev/null 2>&1 || true
  wait "$holder" 2>/dev/null || true
  assert_file_exists "$snap/.autopilot-live.lock" "P4b reaper skips live container"
  sl="$(extract_json_field "$out" skipped_live)"
  [ "${sl:-0}" -ge 1 ] || fail "P4b reaper live skipped_live>=1 got $sl"
  assert_eq 0 0 "P4b reaper live skipped_live"
}

{
  priv="$TEST_TMP/p4b-reap-free"
  mkdir -p "$priv"
  snap="$(mktemp -d "$priv/autopilot-test-snapshot.XXXXXX")"
  make_fixture "$snap/repo"
  git -C "$snap/repo" commit --allow-empty -q -m init
  git -C "$snap/repo" worktree add -q "$snap/inner-wt" -b p4b-reap-wt
  : >"$snap/.autopilot-live.lock"
  touch -d '2 minutes ago' "$snap/.autopilot-live.lock"
  out=""
  out="$(TMPDIR="$priv" suite_residue_reap)"
  assert_file_absent "$snap" "P4b reaper reclaims free-lock container"
  assert_file_absent "$snap/inner-wt" "P4b reaper pruned inner worktree"
  assert_eq "$(extract_json_field "$out" reaped)" "1" "P4b reaper free reaped=1"
}

{
  priv="$TEST_TMP/p4b-reap-missing"
  mkdir -p "$priv"
  snap="$(mktemp -d "$priv/autopilot-test-snapshot.XXXXXX")"
  mkdir -p "$snap/repo"
  out=""
  out="$(TMPDIR="$priv" suite_residue_reap)"
  assert_file_exists "$snap" "P4b reaper missing lock fail-closed skip"
  sl="$(extract_json_field "$out" skipped_live)"
  [ "${sl:-0}" -ge 1 ] || fail "P4b missing-lock skipped_live>=1 got $sl"
  assert_eq 0 0 "P4b missing-lock counted live"
}

{
  priv="$TEST_TMP/p4b-reap-generic"
  mkdir -p "$priv"
  snap="$(mktemp -d "$priv/autopilot-test-snapshot.XXXXXX")"
  : >"$snap/.autopilot-live.lock"
  flock "$snap/.autopilot-live.lock" sleep 30 &
  holder=$!
  poll_until 5 bash -c "flock -n '$snap/.autopilot-live.lock' -c true 2>/dev/null; [ \$? -eq 1 ]" \
    || fail "P4b generic: lock never held"
  out=""
  out="$(TMPDIR="$priv" suite_residue_reap)"
  kill "$holder" >/dev/null 2>&1 || true
  wait "$holder" 2>/dev/null || true
  assert_file_exists "$snap" "P4b generic glob does not reap live snapshot"
}

# hide_flock_path <shim-dir> — PATH whose first dir has every needed tool except flock.
hide_flock_path() {
  local shim="$1" cmd src
  mkdir -p "$shim"
  for cmd in bash sh git rsync env mkdir mktemp rm cp mv chmod cat sed grep awk \
    ps kill pkill setsid python3 python true false date uname sleep touch ln ls \
    dirname basename realpath readlink head tr cut sort uniq tee xargs find stat \
    id timeout wc comm cmp diff which hostname getent stdbuf nice nohup expr \
    install od printf test getopt column jq perl awk gawk mawk busybox dash \
    logger tee; do
    src="$(command -v "$cmd" 2>/dev/null || true)"
    if [ -n "$src" ] && [ -x "$src" ]; then
      ln -sfn "$src" "$shim/$cmd"
    fi
  done
  printf '%s\n' "$shim"
}

# RED at 8b222da3: test-snapshot: construction failed: flock missing (exit 1)
{
  fx="$TEST_TMP/p4-noflock"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
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
  priv="$TEST_TMP/p4-noflock-tmp"
  mkdir -p "$priv"
  shim="$TEST_TMP/p4-noflock-bin"
  noflock_path="$(hide_flock_path "$shim")"
  marker="$TEST_TMP/p4-noflock.marker"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    PATH="$noflock_path" TMPDIR="$priv" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  assert_exit_code "$rc" 0 "P4 no-flock in-place exit 0"
  assert_contains "$out" "test-snapshot: disabled (flock missing)" "P4 no-flock disabled line"
  got_root="$(sed -n 's/^SNAPSHOT_ROOT=//p' "$marker")"
  assert_eq "$got_root" "$fx" "P4 no-flock marker is fixture ROOT"
}

{
  fx="$TEST_TMP/p4-noflock-guard"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  cat >"$fx/hooks/tests/zz-fixture-one.test.sh" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
git -C "$REPO_ROOT" config --local zz.touched 1
finalize_test
EOF
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  priv="$TEST_TMP/p4-noflock-guard-tmp"
  mkdir -p "$priv"
  shim="$TEST_TMP/p4-noflock-guard-bin"
  noflock_path="$(hide_flock_path "$shim")"
  out=""
  rc=0
  out="$(env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    PATH="$noflock_path" TMPDIR="$priv" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null 2>&1)" || rc=$?
  assert_neq "$rc" 0 "P4 no-flock guard fails"
  assert_contains "$out" "test-snapshot: disabled (flock missing)" "P4 no-flock guard disabled line"
  assert_contains "$out" "zz.touched" "P4 no-flock guard names zz.touched"
  if git -C "$fx" config --local --get zz.touched >/dev/null 2>&1; then
    fail "P4 no-flock zz.touched should be restored/absent"
  else
    assert_eq 0 0 "P4 no-flock zz.touched absent after guard"
  fi
}

{
  src="$REPO_ROOT/hooks/tests/run.sh"
  grep -q 'test-snapshot: disabled (suite-oracle-lock parent)' "$src" \
    || fail "oracle-lock parent branch must print G3 disabled line"
  assert_eq 0 0 "P4 oracle-lock parent disabled line in source"
}

{
  priv="$TEST_TMP/p4-reap-noflock"
  mkdir -p "$priv"
  snap="$(mktemp -d "$priv/autopilot-test-snapshot.XXXXXX")"
  : >"$snap/.autopilot-live.lock"
  touch -d '2 minutes ago' "$snap/.autopilot-live.lock"
  shim="$TEST_TMP/p4-reap-noflock-bin"
  noflock_path="$(hide_flock_path "$shim")"
  out=""
  out="$(PATH="$noflock_path" TMPDIR="$priv" suite_residue_reap)"
  assert_file_exists "$snap" "P4 reaper no-flock skips container"
  sl="$(extract_json_field "$out" skipped_live)"
  [ "${sl:-0}" -ge 1 ] || fail "P4 reaper no-flock skipped_live>=1 got $sl"
  assert_eq 0 0 "P4 reaper no-flock treated live"
}

# --- Landing round 1: outer shutdown on EVERY exit path ---
# RED at e0cf0511:
#   FAIL [test-snapshot] L1 normal exit: descendant still alive after outer returned
#   FAIL [test-snapshot] L1 HUP: descendant <pid> still alive
l1_fixture() {
  local name="$1" body="$2" fx
  fx="$TEST_TMP/$name"
  make_fixture "$fx"
  git -C "$fx" config --local user.email "cookys@stranity.com"
  printf 'base\n' >"$fx/tracked.txt"
  git -C "$fx" add tracked.txt
  git -C "$fx" commit -q -m init
  copy_runner_into_fixture "$fx"
  printf '%s\n' '#!/usr/bin/env bash' '. "$(dirname "$0")/lib.sh"' "$body" 'finalize_test' \
    >"$fx/hooks/tests/zz-fixture-one.test.sh"
  chmod +x "$fx/hooks/tests/zz-fixture-one.test.sh"
  git -C "$fx" add hooks scripts tracked.txt
  git -C "$fx" commit -q -m runner
  printf '%s' "$fx"
}

{
  fx="$(l1_fixture l1-normal 'sleep 120 </dev/null >/dev/null 2>&1 &
echo $! >"${DESCENDANT_PIDFILE}"')"
  priv="$TEST_TMP/l1-normal-tmp"
  mkdir -p "$priv"
  dpidf="$TEST_TMP/l1-normal.descendant"
  rc=0
  p4b_outer_env TMPDIR="$priv" DESCENDANT_PIDFILE="$dpidf" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 || rc=$?
  assert_exit_code "$rc" 0 "L1 normal exit rc 0"
  dpid="$(tr -d '[:space:]' <"$dpidf" 2>/dev/null || true)"
  if [ -z "$dpid" ]; then
    fail "L1 normal exit: descendant pid not recorded"
  elif kill -0 "$dpid" 2>/dev/null; then
    kill -s KILL "$dpid" >/dev/null 2>&1 || true
    fail "L1 normal exit: descendant still alive after outer returned"
  else
    assert_eq 0 0 "L1 normal exit: descendant gone"
  fi
  assert_no_snap_dirs "$priv"
}

{
  fx="$(l1_fixture l1-hup 'sleep 120 </dev/null >/dev/null 2>&1 &
echo $! >"${DESCENDANT_PIDFILE}"
printf "ready\n" >"${FIXTURE_MARKER}"
wait')"
  priv="$TEST_TMP/l1-hup-tmp"
  mkdir -p "$priv"
  dpidf="$TEST_TMP/l1-hup.descendant"
  marker="$TEST_TMP/l1-hup.marker"
  set -m
  # Direct env (not the p4b_outer_env function): $! must be the outer bash itself.
  env -u AUTOPILOT_SESSION_ID -u AUTOPILOT_TEST_SNAPSHOT_ROOT -u AUTOPILOT_TEST_SNAPSHOT \
    TMPDIR="$priv" DESCENDANT_PIDFILE="$dpidf" FIXTURE_MARKER="$marker" \
    bash "$fx/hooks/tests/run.sh" zz-fixture-one </dev/null >/dev/null 2>&1 &
  outer=$!
  set +m
  for _i in $(seq 1 150); do
    [ -s "$dpidf" ] && [ -f "$marker" ] && break
    sleep 0.1
  done
  if [ ! -f "$marker" ]; then
    kill -s KILL "$outer" >/dev/null 2>&1 || true
    wait "$outer" 2>/dev/null || true
    fail "L1 HUP: readiness marker never appeared"
  else
    kill -s HUP "$outer" >/dev/null 2>&1 || true
    rc=0
    wait "$outer" || rc=$?
    assert_exit_code "$rc" 129 "L1 HUP => 129"
    dpid="$(tr -d '[:space:]' <"$dpidf" 2>/dev/null || true)"
    if [ -n "$dpid" ] && kill -0 "$dpid" 2>/dev/null; then
      kill -s KILL "$dpid" >/dev/null 2>&1 || true
      fail "L1 HUP: descendant $dpid still alive"
    else
      assert_eq 0 0 "L1 HUP: descendant gone"
    fi
    assert_no_snap_dirs "$priv"
  fi
}

finalize_test
