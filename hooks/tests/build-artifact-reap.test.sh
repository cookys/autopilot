#!/usr/bin/env bash
# build-artifact-reap: scripts/lib/build-artifacts.js, scripts/reap-build-artifacts.js,
# scripts/lib/disk-guard.js, and the reap-dispatch-worktrees.sh hook.
. "$(dirname "$0")/lib.sh"

REAP="$REPO_ROOT/scripts/reap-build-artifacts.js"
GUARD="$REPO_ROOT/scripts/lib/disk-guard.js"
CONTROLLER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"
export XDG_STATE_HOME="$TEST_TMP/state"
AUDIT="$XDG_STATE_HOME/autopilot/build-artifact-reap.jsonl"

GIT=(git -c user.email=bar@test -c user.name=bar)
make_repo() { # dir
  mkdir -p "$1/.autopilot"
  git -C "$1" init -q -b develop
  printf '{"paths":["courier/target"]}\n' > "$1/.autopilot/build-artifacts.json"
  "${GIT[@]}" -C "$1" add .autopilot/build-artifacts.json
  "${GIT[@]}" -C "$1" commit -q -m base
  mkdir -p "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/info"
  printf '%s\n' ${2:-courier/target/} ".autopilot-worktree" ".autopilot-worktree.lock" \
    >> "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
}
build() { # worktree  (~5 MB of "build output")
  mkdir -p "$1/courier/target/debug"
  head -c 5242880 /dev/zero > "$1/courier/target/debug/artifact.bin"
}
size_of() { du -sb "$@" 2>/dev/null | awk '{n+=$1} END{print n+0}'; }

REPO="$TEST_TMP/repo"
make_repo "$REPO"

# ---- unit: path safety -------------------------------------------------------------------------
git -C "$REPO" worktree add -q -b esc "$TEST_TMP/esc" develop
OUTSIDE="$TEST_TMP/outside"; mkdir -p "$OUTSIDE"; echo keep > "$OUTSIDE/keep.txt"
ln -s "$OUTSIDE" "$TEST_TMP/esc/linkout"
printf '{"paths":["../outside","%s","linkout","courier/../../outside"]}\n' "$OUTSIDE" \
  > "$TEST_TMP/esc/.autopilot/build-artifacts.json"
node "$REAP" reap --worktree "$TEST_TMP/esc" --json > "$TEST_TMP/esc.json"
assert_file_exists "$OUTSIDE/keep.txt" "escaping paths never delete outside the worktree"
assert_eq "$(jq -r '.removed | length' < "$TEST_TMP/esc.json")" "0" "nothing removed for escaping paths"
assert_contains "$(jq -r '[.skipped[].reason] | join(",")' < "$TEST_TMP/esc.json")" "parent_segment" "dotdot refused"
assert_contains "$(jq -r '[.skipped[].reason] | join(",")' < "$TEST_TMP/esc.json")" "absolute_path" "absolute refused"
assert_contains "$(jq -r '[.skipped[].reason] | join(",")' < "$TEST_TMP/esc.json")" "symlink_refused" "symlink out refused"
assert_eq "$(readlink "$TEST_TMP/esc/linkout")" "$OUTSIDE" "symlink itself left in place"

# ---- unit: main checkout refusal ---------------------------------------------------------------
build "$REPO"
node "$REAP" reap --worktree "$REPO" --json > "$TEST_TMP/main.json"
assert_file_exists "$REPO/courier/target/debug/artifact.bin" "main checkout artifacts untouched"
assert_eq "$(jq -r '.skipped[0].reason' < "$TEST_TMP/main.json")" "main_checkout_refused" "main checkout refused with reason"

# ---- unit: missing declaration = no-op; dry-run deletes nothing --------------------------------
git -C "$REPO" worktree add -q -b nodecl "$TEST_TMP/nodecl" develop
rm -f "$TEST_TMP/nodecl/.autopilot/build-artifacts.json"
build "$TEST_TMP/nodecl"
node "$REAP" reap --worktree "$TEST_TMP/nodecl" --json > "$TEST_TMP/nodecl.json"
assert_file_exists "$TEST_TMP/nodecl/courier/target/debug/artifact.bin" "no declaration, nothing deleted"
assert_eq "$(jq -c '[.removed,.skipped]' < "$TEST_TMP/nodecl.json")" "[[],[]]" "no declaration is a quiet no-op"

git -C "$REPO" worktree add -q -b dry "$TEST_TMP/dry" develop
build "$TEST_TMP/dry"
node "$REAP" reap --worktree "$TEST_TMP/dry" --dry-run --json > "$TEST_TMP/dry.json"
assert_file_exists "$TEST_TMP/dry/courier/target/debug/artifact.bin" "dry-run deletes nothing"
assert_eq "$(jq -r '.removed[0].bytes' < "$TEST_TMP/dry.json")" "5242880" "dry-run reports bytes"
node "$REAP" reap --worktree "$TEST_TMP/dry" --json > /dev/null
assert_file_absent "$TEST_TMP/dry/courier/target" "real reap removes the declared dir"
assert_eq "$(tail -1 "$AUDIT" | jq -r '.cmd')" "reap" "audit line appended"
assert_eq "$(tail -1 "$AUDIT" | jq -r '.bytes')" "5242880" "audit line carries bytes"

# sweep skips a recently modified dir, then reaps it at idle-min 0
build "$TEST_TMP/dry"
node "$REAP" sweep --repo "$REPO" --json > "$TEST_TMP/sw.json"
assert_file_exists "$TEST_TMP/dry/courier/target/debug/artifact.bin" "sweep keeps recently modified artifacts"
assert_contains "$(jq -r '[.skipped[].reason] | join(",")' < "$TEST_TMP/sw.json")" "recently_modified" "recent reported"
assert_file_exists "$REPO/courier/target/debug/artifact.bin" "sweep never touches the main checkout"
# open file keeps it even at idle-min 0
exec {held}< "$TEST_TMP/dry/courier/target/debug/artifact.bin"
( exec sleep 30 ) < "$TEST_TMP/dry/courier/target/debug/artifact.bin" & HOLDER=$!
node "$REAP" sweep --repo "$REPO" --idle-min 0 --json > "$TEST_TMP/sw0.json"
if [ "$(uname)" = "Linux" ]; then
  assert_file_exists "$TEST_TMP/dry/courier/target/debug/artifact.bin" "open file by another process keeps artifacts"
  assert_contains "$(jq -r '[.skipped[].reason] | join(",")' < "$TEST_TMP/sw0.json")" "open_file" "open_file reported"
fi
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; exec {held}<&-
node "$REAP" sweep --repo "$REPO" --idle-min 0 --json > /dev/null
assert_file_absent "$TEST_TMP/dry/courier/target" "idle-min 0 sweep reaps once nothing holds it"
assert_file_exists "$REPO/courier/target/debug/artifact.bin" "main checkout still untouched"
rm -rf "$REPO/courier/target"

# ---- disk-guard (statfs injected) --------------------------------------------------------------
git -C "$REPO" worktree add -q -b dgw "$TEST_TMP/dgw" develop
fake() { printf '{"free_pct":%s}\n' "$1" > "$TEST_TMP/statfs.json"; }
guard() { AUTOPILOT_DISK_GUARD_FAKE_STATFS="$TEST_TMP/statfs.json" node "$GUARD" check --path "$TEST_TMP/dgw/new" --repo "$REPO" "$@"; }

fake 50; guard 2>/dev/null; assert_exit_code "$?" "0" "enough free space passes"
fake 5; build "$TEST_TMP/dgw"
guard 2> "$TEST_TMP/dg.err"; assert_exit_code "$?" "3" "low free space refuses with exit 3"
assert_contains "$(cat "$TEST_TMP/dg.err")" "free 5.0% < min 20%" "reason names free % and threshold"
assert_contains "$(cat "$TEST_TMP/dg.err")" "courier/target" "reason names the reclaimable artifact dir"
assert_file_exists "$TEST_TMP/dgw/courier/target/debug/artifact.bin" "recent artifact is not swept (nothing deleted on refusal)"
AUTOPILOT_DISK_GUARD_MIN_FREE_PCT=3 guard 2>/dev/null; assert_exit_code "$?" "0" "env threshold lowers the bar"
guard --min-free-pct 3 2>/dev/null; assert_exit_code "$?" "0" "flag threshold lowers the bar"
# sweep-then-recheck: idle artifacts are reaped and the second statfs reads healthy
printf '{"free_pct":[5,60]}\n' > "$TEST_TMP/statfs.json"
touch -d '2 hours ago' "$TEST_TMP/dgw/courier/target/debug/artifact.bin" "$TEST_TMP/dgw/courier/target/debug" "$TEST_TMP/dgw/courier/target"
guard 2>/dev/null; assert_exit_code "$?" "0" "guard sweeps idle artifacts then re-checks"
assert_file_absent "$TEST_TMP/dgw/courier/target" "guard's sweep reclaimed the idle artifact dir"

# ---- RED test: 3 parallel worktrees build, each finishes by reap / by sweep ---------------------
for mode in reap sweep; do
  P="$TEST_TMP/par-$mode"; make_repo "$P"
  for i in 1 2 3; do git -C "$P" worktree add -q -b "p$i" "$TEST_TMP/par-$mode-wt$i" develop; done
  START="$(size_of "$TEST_TMP"/par-$mode-wt*/courier/target)"
  for i in 1 2 3; do ( build "$TEST_TMP/par-$mode-wt$i" ) & done; wait
  BUILT="$(size_of "$TEST_TMP"/par-$mode-wt*/courier/target)"
  [ "$BUILT" -ge 15728640 ] || fail "$mode: build fixture too small ($BUILT)"
  if [ "$mode" = reap ]; then
    for i in 1 2 3; do ( node "$REAP" reap --worktree "$TEST_TMP/par-reap-wt$i" > /dev/null ) & done; wait
  else
    node "$REAP" sweep --repo "$P" --idle-min 0 > /dev/null
  fi
  END="$(size_of "$TEST_TMP"/par-$mode-wt*/courier/target)"
  assert_eq "$END" "0" "$mode: total courier/target size back to starting size (was $START)"
done

# ---- reap-dispatch-worktrees.sh reaps declared artifacts before removal -------------------------
# artifact dir is git-ignored (as in a real repo), so `git worktree remove` would delete it anyway;
# the observable proof the hook ran is its audit line.
DR="$TEST_TMP/dispatch-repo"; make_repo "$DR"
BASE="$(git -C "$DR" rev-parse HEAD)"
git -C "$DR" worktree add -q -b wlb/bar-clean "$TEST_TMP/dr-clean" develop
{
  printf 'created_at=%s\n' "$(date +%s)"; printf 'branch=%s\n' "wlb/bar-clean"
  printf 'base_sha=%s\n' "$BASE"; printf 'run_id=%s\n' "bar-clean"
  printf 'root_run_id=%s\n' "bar-root"; printf 'loop_id=%s\n' "bar-loop"; printf 'schema=%s\n' 2
} > "$TEST_TMP/dr-clean/.autopilot-worktree"
: > "$TEST_TMP/dr-clean/.autopilot-worktree.lock"
build "$TEST_TMP/dr-clean"
"$CONTROLLER" reap --repo "$DR" --root-run-id "bar-root" --yes > "$TEST_TMP/dr.json" 2>&1
assert_file_absent "$TEST_TMP/dr-clean" "dispatch reap removed the worktree holding build output"
assert_contains "$(grep -F "$TEST_TMP/dr-clean" "$AUDIT" | tail -1)" '"bytes":5242880' "dispatch reap ran the build-artifact reap first (audit line)"

finalize_test
