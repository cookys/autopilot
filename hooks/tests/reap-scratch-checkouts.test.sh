#!/usr/bin/env bash
# Fixture coverage for scripts/reap-scratch-checkouts.js and scripts/scratch-closeout.sh.
. "$(dirname "$0")/lib.sh"

REAPER="$REPO_ROOT/scripts/reap-scratch-checkouts.js"
CLOSEOUT="$REPO_ROOT/scripts/scratch-closeout.sh"

new_fixture() { # <dir>: main repo with worktrees in <dir>/scratch
  local d="$1" orphan
  mkdir -p "$d/scratch"
  git init -q -b develop "$d/main"
  git -C "$d/main" config user.email test@example.com
  git -C "$d/main" config user.name "Test User"
  printf '__pycache__/\n' > "$d/main/.gitignore"
  printf 'a\n' > "$d/main/f.txt"
  git -C "$d/main" add -A
  git -C "$d/main" commit -q -m base
  git -C "$d/main" worktree add -q -b lane/merged "$d/scratch/merged" develop
  git -C "$d/main" worktree add -q --detach "$d/scratch/dirty" develop
  printf 'changed\n' >> "$d/scratch/dirty/f.txt"
  git -C "$d/main" worktree add -q --detach "$d/scratch/untracked" develop
  printf 'x\n' > "$d/scratch/untracked/new.txt"
  orphan=$(printf 'orphan\n' | git -C "$d/main" commit-tree 'develop^{tree}' -p develop)
  git -C "$d/main" worktree add -q --detach "$d/scratch/unreach" "$orphan"
  git -C "$d/main" worktree add -q --detach "$d/scratch/kept" develop
  git -C "$d/main" worktree add -q --detach "$d/scratch/ignored" develop
  mkdir -p "$d/scratch/ignored/__pycache__"; printf 'x\n' > "$d/scratch/ignored/__pycache__/m.pyc"
  git clone -q "$d/main" "$d/scratch/aclone"
  mkdir -p "$d/scratch/plain"; printf 'x\n' > "$d/scratch/plain/f"
}
class_of() { printf '%s\n' "$1" | awk -F'\t' -v n="$2" '$4==n {print $1}'; }

T="$TEST_TMP/fx1"; new_fixture "$T"
OUT=$(node "$REAPER" --root "$T/scratch" --repo "$T/main" --keep kept < /dev/null)
assert_eq "$(class_of "$OUT" merged)" REAP "clean merged worktree is REAP"
assert_eq "$(class_of "$OUT" ignored)" REAP "ignored-only files do not block REAP"
assert_eq "$(class_of "$OUT" dirty)" KEEP "dirty tracked file is kept"
assert_eq "$(class_of "$OUT" untracked)" KEEP "untracked file is kept"
assert_eq "$(class_of "$OUT" unreach)" KEEP "unreachable detached HEAD is kept"
assert_eq "$(class_of "$OUT" kept)" KEEP "--keep entry is kept"
assert_eq "$(class_of "$OUT" aclone)" SKIP "clone is reported only"
assert_eq "$(class_of "$OUT" plain)" SKIP "plain dir is reported only"
assert_contains "$OUT" "unreachable commit" "reason names the unreachable commit"
assert_file_exists "$T/scratch/merged/f.txt" "dry-run removes nothing"

node "$REAPER" --root "$T/scratch" --repo "$T/main" --keep kept --apply < /dev/null > /dev/null
assert_file_absent "$T/scratch/merged" "--apply removed the REAP worktree"
assert_file_absent "$T/scratch/ignored" "--apply removed the ignored-only worktree"
for n in dirty untracked unreach kept aclone plain; do assert_file_exists "$T/scratch/$n" "--apply left $n"; done
git -C "$T/main" rev-parse -q --verify refs/heads/lane/merged > /dev/null
assert_eq "$?" 0 "branch ref remains after the worktree is removed"

# live process cwd
T2="$TEST_TMP/fx2"; new_fixture "$T2"
( cd "$T2/scratch/merged" && exec sleep 30 ) < /dev/null > /dev/null 2>&1 &
SLP=$!
sleep 0.5
OUT=$(node "$REAPER" --root "$T2/scratch" --repo "$T2/main" < /dev/null)
assert_eq "$(class_of "$OUT" merged)" KEEP "worktree with a live process cwd is not reaped"
assert_contains "$OUT" "live process" "reason names the live process"
kill "$SLP" 2> /dev/null; wait "$SLP" 2> /dev/null

# --warn-gb
T3="$TEST_TMP/fx3"; new_fixture "$T3"
OUT=$(node "$REAPER" --root "$T3/scratch" --repo "$T3/main" --warn-gb 0 < /dev/null)
assert_contains "$OUT" "WARNING" "warning above the cap"
OUT=$(node "$REAPER" --root "$T3/scratch" --repo "$T3/main" --warn-gb 1000 < /dev/null)
assert_not_contains "$OUT" "WARNING" "no warning below the cap"

# closeout helper: calls the reaper with --apply; a dirty worktree survives
T4="$TEST_TMP/fx4"; new_fixture "$T4"
OUT=$(bash "$CLOSEOUT" --root "$T4/scratch" --repo "$T4/main" --keep kept < /dev/null)
assert_file_absent "$T4/scratch/merged" "closeout helper applied the reap"
assert_file_exists "$T4/scratch/dirty" "dirty worktree survives the closeout helper"
assert_file_exists "$T4/scratch/kept" "--keep lane survives the closeout helper"
assert_contains "$(cat "$T4/scratch/dirty/f.txt")" changed "dirty tree content intact"
assert_contains "$OUT" "REMOVED" "closeout output shows the removal"
assert_contains "$(cat "$CLOSEOUT")" "--apply" "closeout helper source passes --apply"
assert_contains "$(cat "$REPO_ROOT/.githooks/post-merge")" "reap-scratch-checkouts.js" "post-merge advisory names the reaper"
assert_not_contains "$(cat "$REPO_ROOT/.githooks/post-merge")" "--apply" "post-merge hook never applies"
assert_contains "$(cat "$REPO_ROOT/skills/finish-flow/SKILL.md")" "scratch-closeout.sh" "finish-flow row calls the closeout helper"

# negative control: break the reachability check -> unreachable worktree is reaped -> assertion goes red
MUT="$TEST_TMP/mutant.js"
sed 's/!reachable(head)/false/' "$REAPER" > "$MUT"
T5="$TEST_TMP/fx5"; new_fixture "$T5"
node "$MUT" --root "$T5/scratch" --repo "$T5/main" --apply < /dev/null > /dev/null
if [ -d "$T5/scratch/unreach" ]; then fail "negative control: mutant did not reap the unreachable worktree (test cannot detect the break)"
else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
T6="$TEST_TMP/fx6"; new_fixture "$T6"
node "$REAPER" --root "$T6/scratch" --repo "$T6/main" --apply < /dev/null > /dev/null
assert_file_exists "$T6/scratch/unreach" "real script keeps the unreachable worktree (green side of the control)"

# g2: live cwds are re-read before each removal (a process that enters a candidate after classification keeps it)
T7="$TEST_TMP/fx7"; new_fixture "$T7"; mkdir -p "$T7/proc"
cat > "$T7/hook.sh" <<HOOK
mkdir -p "$T7/proc/4242"
ln -s "$T7/scratch/merged" "$T7/proc/4242/cwd"
HOOK
REAP_SCRATCH_PROC="$T7/proc" REAP_SCRATCH_HOOK_AFTER_CLASSIFY="$T7/hook.sh" node "$REAPER" --root "$T7/scratch" --repo "$T7/main" --apply < /dev/null > /dev/null
assert_file_exists "$T7/scratch/merged" "worktree entered after classification survives --apply"
assert_file_absent "$T7/scratch/ignored" "other REAP candidates are still removed"

# g2: unreadable cwd is an inspection failure, not "no process"
T8="$TEST_TMP/fx8"; new_fixture "$T8"; mkdir -p "$T8/proc/77" "$T8/proc/78"
printf 'EACCES\n' > "$T8/proc/77/cwd.err"
printf 'ENOENT\n' > "$T8/proc/78/cwd.err"
OUT=$(REAP_SCRATCH_ASSUME_NO_PRIVATE_ANCESTOR=1 REAP_SCRATCH_PROC="$T8/proc" node "$REAPER" --root "$T8/scratch" --repo "$T8/main" --apply 2>&1 < /dev/null)
REAP_SCRATCH_ASSUME_NO_PRIVATE_ANCESTOR=1 REAP_SCRATCH_PROC="$T8/proc" node "$REAPER" --root "$T8/scratch" --repo "$T8/main" --apply > /dev/null 2>&1 < /dev/null
RC=$?
assert_eq "$([ "$RC" -ne 0 ] && echo refused)" refused "unreadable cwd without a 0700 ancestor refuses --apply"
assert_file_exists "$T8/scratch/merged" "refused apply removed nothing"
assert_contains "$OUT" "no ancestor of root is mode 0700" "refusal says why"
T9="$TEST_TMP/fx9"; new_fixture "$T9"; mkdir -p "$T9/proc/77"; printf 'EPERM\n' > "$T9/proc/77/cwd.err"
chmod 700 "$T9"
OUT=$(REAP_SCRATCH_PROC="$T9/proc" node "$REAPER" --root "$T9/scratch" --repo "$T9/main" --apply < /dev/null)
assert_file_absent "$T9/scratch/merged" "0700 ancestor owned by the caller lets --apply proceed"
assert_contains "$OUT" "is mode 0700 owned by the caller" "output reports the rule that applied"

# negative control: re-read removed -> the late-entering process no longer protects the worktree
MUT2="$TEST_TMP/mutant2.js"
sed 's/const now = readLive();.*/const now = { failures: [], names: live };/' "$REAPER" > "$MUT2"
T10="$TEST_TMP/fx10"; new_fixture "$T10"; mkdir -p "$T10/proc"
printf 'mkdir -p "%s/proc/4242"\nln -s "%s/scratch/merged" "%s/proc/4242/cwd"\n' "$T10" "$T10" "$T10" > "$T10/hook.sh"
REAP_SCRATCH_PROC="$T10/proc" REAP_SCRATCH_HOOK_AFTER_CLASSIFY="$T10/hook.sh" node "$MUT2" --root "$T10/scratch" --repo "$T10/main" --apply < /dev/null > /dev/null
if [ -d "$T10/scratch/merged" ]; then fail "negative control: stale-snapshot mutant kept the worktree (test cannot detect the break)"
else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi

finalize_test
