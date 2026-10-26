#!/usr/bin/env bash
# repo-residue-busy.test.sh — a worktree a process is using (cwd, exe or a mapped file inside it;
# /proc unreadable counts as in use) is class `busy`: never listed as removable, kept by manual and
# auto reap, re-checked right before the deletion. Incident: the fleet hub's detached worktree was
# offered for removal while its node process ran from it.
# All deletions happen on mktemp repos; test processes are started here and killed by recorded pid.
# RED at 102c3c6be (no busy class, no in-use check on reap): busy_cwd class expected busy got clean-integrated; needs_human listed the path; manual reap removed the directory (reap_cwd); exe/maps/unreadable-/proc cases likewise removed. Fixed: all assertions green.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.autopilot"
export AUTOPILOT_RESIDUE_RECENT_HOURS=0
unset AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_RESIDUE_LEASE_HOURS AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS AUTOPILOT_RESIDUE_PROC_ROOT

PIDS=()
cleanup_pids() { local p; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap 'cleanup_pids' EXIT

jx() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);let v;try{v=eval(process.argv[1]);}catch(e){v=undefined;}process.stdout.write(v===undefined?"<undef>":(typeof v==="string"?v:JSON.stringify(v)));})' "$2"; }

# <name> — repo with one integrated commit and a clean detached worktree at HEAD. Sets REPO and WT.
new_case() {
  REPO="$TEST_TMP/repo-$1"; WT="$TEST_TMP/wt-$1"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b develop
  git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
  printf 'x\n' > "$REPO/a.txt"; git -C "$REPO" add a.txt; git -C "$REPO" commit -q -m base
  git -C "$REPO" worktree add -q --detach "$WT" HEAD
  printf 'mysleep\nlibz.so.1\n' >> "$REPO/.git/info/exclude"
  WT="$(cd "$WT" && pwd -P)"
}
wt_row() { jx "$1" "JSON.stringify(j.worktrees.find(w=>w.path.endsWith('/$(basename "$WT")')))"; }
scan() { (cd "$TEST_TMP" && node "$SCRIPT" scan --repo "$REPO" --integration-ref develop); }
reap_one() { (cd "$TEST_TMP" && node "$SCRIPT" reap --repo "$REPO" --yes --json --integration-ref develop --worktree "$WT" 2>/dev/null); }
listed() { jx "$1" "j.needs_human.some(e=>e.path&&e.path.endsWith('/$(basename "$WT")'))"; }
class_of() { jx "$1" "j.worktrees.find(w=>w.path.endsWith('/'+'$(basename "$WT")')).class"; }

# --- 0. control: no process inside -> clean-integrated, listed, and reaped ---
new_case ctl
S="$(scan)"
assert_eq "$(class_of "$S")" "clean-integrated" "control: idle worktree is clean-integrated"
assert_eq "$(listed "$S" "$WT")" "true" "control: idle worktree is listed as removable"
R="$(reap_one)"
[ -d "$WT" ] && fail "control: idle worktree must be removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# --- 1. cwd inside ---
new_case cwd
(cd "$WT" && exec sleep 300) & PIDS+=($!)
sleep 0.3
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "cwd: class busy"
assert_eq "$(listed "$S" "$WT")" "false" "cwd: not in needs_human"
assert_contains "$(wt_row "$S" "$WT")" "cwd" "cwd: reason names the cwd hit"
assert_contains "$(wt_row "$S" "$WT")" "${PIDS[-1]}" "cwd: reason names the pid"
R="$(reap_one)"
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "cwd: manual reap must keep the directory"
assert_eq "$(jx "$R" 'j.actions.worktrees_kept[0].class')" "busy" "cwd: reap reports kept busy"
assert_eq "$(jx "$R" 'j.actions.worktrees_kept[0].kept')" "true" "cwd: kept flag"

# --- 2. exe inside, cwd outside ---
new_case exe
cp "$(command -v sleep)" "$WT/mysleep"
(cd "$TEST_TMP" && exec "$WT/mysleep" 300) & PIDS+=($!)
sleep 0.3
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "exe: class busy with cwd outside"
assert_contains "$(wt_row "$S" "$WT")" "exe" "exe: reason names exe"
reap_one >/dev/null
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "exe: manual reap must keep the directory"

# --- 3. mapped file inside (LD_PRELOAD of a copied library), cwd and exe outside ---
new_case maps
LIB="$(ldconfig -p 2>/dev/null | awk '/libz\.so\.1 /{print $NF; exit}')"
[ -n "$LIB" ] || LIB="$(ls /lib/x86_64-linux-gnu/libz.so.1 /usr/lib/*/libz.so.1 2>/dev/null | head -1)"
if [ -n "$LIB" ] && [ -f "$LIB" ]; then
  cp "$LIB" "$WT/libz.so.1"
  (cd "$TEST_TMP" && LD_PRELOAD="$WT/libz.so.1" exec sleep 300) & PIDS+=($!)
  sleep 0.3
  S="$(scan)"
  assert_eq "$(class_of "$S")" "busy" "maps: class busy with cwd and exe outside"
  assert_contains "$(wt_row "$S" "$WT")" "maps" "maps: reason names maps"
  reap_one >/dev/null
  [ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "maps: manual reap must keep the directory"
else
  fail "maps: no libz.so.1 found to preload"
fi

# --- 4. /proc unreadable (injected root) -> unknown -> busy ---
new_case noproc
export AUTOPILOT_RESIDUE_PROC_ROOT="$TEST_TMP/no-such-proc"
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "noproc: unreadable /proc is busy"
assert_eq "$(listed "$S" "$WT")" "false" "noproc: not listed"
reap_one >/dev/null
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "noproc: manual reap must keep the directory"
unset AUTOPILOT_RESIDUE_PROC_ROOT

# --- 5. process starts AFTER the scan: reap re-checks before deleting ---
new_case late
S="$(scan)"
assert_eq "$(listed "$S" "$WT")" "true" "late: listed at scan time"
(cd "$WT" && exec sleep 300) & PIDS+=($!)
sleep 0.3
reap_one >/dev/null
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "late: reap must re-check and keep the directory"

# --- 6. once the process is gone the worktree is clean-integrated again and can be reaped ---
cleanup_pids; PIDS=(); sleep 0.3
S="$(scan)"
assert_eq "$(class_of "$S")" "clean-integrated" "after exit: clean-integrated again"
reap_one >/dev/null
[ -d "$WT" ] && fail "after exit: reap must remove it" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

finalize_test
