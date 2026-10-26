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

# --- 5b. node script run by absolute path with the cwd outside (the hub case): exe is the system node, the
# script was read and closed, so only /proc/<pid>/cmdline names the worktree ---
new_case node
printf 'setTimeout(()=>{}, 300000)\n' > "$WT/x.js"; printf 'x.js\n' >> "$REPO/.git/info/exclude"
(cd "$TEST_TMP" && exec node "$WT/x.js") & PIDS+=($!)
sleep 0.5
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "node abs: class busy with cwd outside"
assert_contains "$(wt_row "$S" "$WT")" "cmdline" "node abs: reason names cmdline"
reap_one >/dev/null
[ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "node abs: manual reap must keep the directory"

# relative argument resolved against the process's cwd, through a symlink
new_case noderel
printf 'setTimeout(()=>{}, 300000)\n' > "$WT/x.js"; printf 'x.js\n' >> "$REPO/.git/info/exclude"
ln -s "$WT" "$TEST_TMP/link-noderel"
(cd "$TEST_TMP" && exec node "link-noderel/x.js") & PIDS+=($!)
sleep 0.5
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "node rel+symlink: class busy"
assert_contains "$(wt_row "$S" "$WT")" "cmdline" "node rel+symlink: reason names cmdline"

# a file held open (fd) with cwd, exe and arguments all outside
new_case fd
printf 'data\n' > "$WT/held.txt"; printf 'held.txt\n' >> "$REPO/.git/info/exclude"
(cd "$TEST_TMP" && exec 3< "$WT/held.txt" && exec sleep 300) & PIDS+=($!)
sleep 0.3
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "fd: class busy"
assert_contains "$(wt_row "$S" "$WT")" "fd" "fd: reason names fd"

# --- 5c. unknown semantics: ONE readable item anywhere means the table is readable ---
new_case unk
FP="$TEST_TMP/fakeproc"; mkdir -p "$FP/4242"
export AUTOPILOT_RESIDUE_PROC_ROOT="$FP"
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "unknown: a pid dir with nothing readable -> unknown -> busy"
ln -s /bin/true "$FP/4242/exe"            # exe readable, no cwd, no maps, no cmdline
S="$(scan)"
assert_eq "$(class_of "$S")" "clean-integrated" "unknown: only exe readable is NOT unknown (idle worktree stays clean-integrated)"
printf 'node\0%s/x.js\0' "$WT" > "$FP/4242/cmdline"   # now a readable cmdline names the worktree
S="$(scan)"
assert_eq "$(class_of "$S")" "busy" "unknown: cmdline-only evidence still marks it busy"
unset AUTOPILOT_RESIDUE_PROC_ROOT

# --- 5d. auto reap: branch + valid schema=2 marker + expired lease; control reaps, then in use by cwd/exe/maps/node-arg keeps ---
auto_case() { # <name> <starter fn>
  new_case "$1"
  git -C "$REPO" worktree remove --force "$WT"; git -C "$REPO" worktree add -q -b "br-$1" "$WT" HEAD
  WT="$(cd "$WT" && pwd -P)"
  printf 'mysleep\nlibz.so.1\nx.js\n.autopilot-worktree\n.autopilot-worktree.lock\n' >> "$REPO/.git/info/exclude"
  local base; base="$(git -C "$REPO" rev-parse HEAD)"
  printf 'created_at=%s\nbranch=br-%s\nbase_sha=%s\nrun_id=run-%s\nroot_run_id=root-%s\nloop_id=run-%s\nschema=2\n' "$(( $(date +%s) - 360000 ))" "$1" "$base" "$1" "$1" "$1" > "$WT/.autopilot-worktree"
  [ -n "${2:-}" ] && "$2"
  sleep 0.4
  (cd "$TEST_TMP" && node "$SCRIPT" reap --repo "$REPO" --auto --yes --integration-ref develop 2>&1)
}
st_cwd() { (cd "$WT" && exec sleep 300 >/dev/null 2>&1) & PIDS+=($!); }
st_exe() { cp "$(command -v sleep)" "$WT/mysleep"; (cd "$TEST_TMP" && exec "$WT/mysleep" 300 >/dev/null 2>&1) & PIDS+=($!); }
st_maps() { cp "$LIB" "$WT/libz.so.1"; (cd "$TEST_TMP" && LD_PRELOAD="$WT/libz.so.1" exec sleep 300 >/dev/null 2>&1) & PIDS+=($!); }
st_node() { printf 'setTimeout(()=>{}, 300000)\n' > "$WT/x.js"; (cd "$TEST_TMP" && exec node "$WT/x.js" >/dev/null 2>&1) & PIDS+=($!); }
OUT="$(auto_case actl "")"; WT="$TEST_TMP/wt-actl"
[ -d "$WT" ] && fail "auto control: an idle expired-lease integrated marker worktree must be removed ($OUT)" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
for kind in cwd exe maps node; do
  OUT="$(auto_case "a$kind" "st_$kind")"; WT="$TEST_TMP/wt-a$kind"
  [ -d "$WT" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "auto $kind: directory must be kept"
  assert_contains "$OUT" "process_" "auto $kind: reported kept with a process_* reason"
done
cleanup_pids; PIDS=()

# --- 6. once the process is gone the worktree is clean-integrated again and can be reaped ---
new_case gone
(cd "$WT" && exec sleep 300 >/dev/null 2>&1) & PIDS+=($!)
sleep 0.3
assert_eq "$(class_of "$(scan)")" "busy" "gone: busy while the process lives"
cleanup_pids; PIDS=(); sleep 0.3
S="$(scan)"
assert_eq "$(class_of "$S")" "clean-integrated" "after exit: clean-integrated again"
reap_one >/dev/null
[ -d "$WT" ] && fail "after exit: reap must remove it" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

finalize_test
