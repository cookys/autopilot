#!/usr/bin/env bash
# repo-residue-patch-id.test.sh — cherry-picked dispatch branches are integrated
# only when every non-merge commit in integration..ref has a stable patch-id
# match (git cherry all '-'). Partial adoption stays unintegrated.
# RED at 500aa187f9b47fa9e11468b81d65c50961fe6bf1: positive cases failed on the ancestor-only judge (hands/both class unintegrated, integrated_by <undef>, apply left the branch; worktree class clean-unintegrated). Ancestor deletion still passed; integrated_by ancestor was <undef>. Negatives (altered hunk, one-of-two) stayed unintegrated and were not deleted. 11 passed, 10 failed, exit 1.
# RED at bc34e359f: add/delete/re-add (A adds x, B deletes x, C adds x again; develop cherry-picked only A and B) was judged integrated by patch_id and apply deleted the branch. abc: class expected unintegrated got integrated; integrated expected false got true; integrated_by expected <undef> got patch_id; branch was deleted. develop did not contain x. 22 passed, 4 failed, exit 1.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.autopilot"
export AUTOPILOT_RESIDUE_RECENT_HOURS=0
unset AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_RESIDUE_LEASE_HOURS AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS

jx() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);let v;try{v=eval(process.argv[1]);}catch(e){v=undefined;}process.stdout.write(v===undefined?"<undef>":(typeof v==="string"?v:JSON.stringify(v)));})' "$2"; }

# Fresh repo under TEST_TMP. Echoes the repo path. Integration branch: develop.
new_repo() {
  local sbx="$TEST_TMP/repo-$1"
  mkdir -p "$sbx"
  git -C "$sbx" init -q -b develop
  git -C "$sbx" config user.email t@t
  git -C "$sbx" config user.name t
  git -C "$sbx" config core.logAllRefUpdates true
  printf '%s\n' "$sbx"
}

# <repo> <message> <path> <content> — commit dated 5 days ago; prints new HEAD.
old_commit_file() {
  local sbx="$1" msg="$2" rel="$3" body="$4"
  local now d
  now="$(date +%s)"
  d="$(date -d "@$((now - 5 * 86400))" -R)"
  printf '%s\n' "$body" > "$sbx/$rel"
  git -C "$sbx" add -- "$rel"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$sbx" -c user.email=t@t -c user.name=t commit -q -m "$msg"
  git -C "$sbx" rev-parse HEAD
}

# Point refs/heads/<name> at <sha> with no reflog (idle == committer date).
no_reflog_branch() {
  git -C "$1" -c core.logAllRefUpdates=false update-ref "refs/heads/$2" "$3"
}

# Build two unique commits on top of a side commit so cherry-pick cannot fast-forward.
# Prints: branch_tip pick1 pick2  (pick* empty when $4 is "none")
# $4 = both | alter | one
seed_two() {
  local sbx="$1" name="$2" mode="$3"
  local base a b
  old_commit_file "$sbx" base a.txt base >/dev/null
  git -C "$sbx" checkout -q --detach
  a="$(old_commit_file "$sbx" one f.txt one)"
  b="$(old_commit_file "$sbx" two g.txt two)"
  git -C "$sbx" checkout -q develop
  old_commit_file "$sbx" side z.txt side >/dev/null
  if [ "$mode" = both ]; then
    git -C "$sbx" -c user.email=t@t -c user.name=t cherry-pick "$a" "$b" >/dev/null
  elif [ "$mode" = alter ]; then
    git -C "$sbx" -c user.email=t@t -c user.name=t cherry-pick "$a" >/dev/null
    git -C "$sbx" -c user.email=t@t -c user.name=t cherry-pick -n "$b" >/dev/null
    printf 'two-altered\n' > "$sbx/g.txt"
    git -C "$sbx" add -- g.txt
    git -C "$sbx" -c user.email=t@t -c user.name=t commit -q -m 'two-altered'
  elif [ "$mode" = one ]; then
    git -C "$sbx" -c user.email=t@t -c user.name=t cherry-pick "$a" >/dev/null
  fi
  no_reflog_branch "$sbx" "$name" "$b"
  printf '%s %s %s\n' "$b" "$(git -C "$sbx" rev-parse HEAD~1)" "$(git -C "$sbx" rev-parse HEAD)"
}

branch_row() { jx "$2" "j.branches.find(b=>b.branch==='$1')"; }

# --- 1. both commits cherry-picked: integrated by patch_id, apply deletes ---
SBX="$(new_repo both)"
read -r TIP P1 P2 < <(seed_two "$SBX" hands/both both)
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
ROW="$(branch_row hands/both "$SCAN")"
assert_eq "$(jx "$ROW" 'j.class')" "integrated" "both: class integrated"
assert_eq "$(jx "$ROW" 'j.integrated')" "true" "both: integrated true"
assert_eq "$(jx "$ROW" 'j.integrated_by')" "patch_id" "both: integrated_by patch_id"
# Cherry lists the parent commit then the tip. Integration picks were applied in that order,
# so HEAD~1 is the pick of the parent and HEAD is the pick of the tip.
B1="$(git -C "$SBX" rev-parse "$TIP^")"
B2="$TIP"
assert_eq "$(jx "$ROW" 'j.patch_id_matches.map(m=>m.branch+"->"+m.target).join(",")')" "$B1->$P1,$B2->$P2" "both: each branch commit names its cherry-pick"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --auto --yes --integration-ref develop)"
assert_eq "$?" "0" "both: apply exit 0"
git -C "$SBX" rev-parse --verify -q refs/heads/hands/both >/dev/null && fail "both: apply should delete hands/both" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_eq "$(jx "$OUT" 'j.removed.some(r=>r.kind==="branch"&&r.branch==="hands/both"&&r.reason==="integrated")')" "true" "both: removed as integrated"

# --- 2. one hunk altered: unintegrated, kept ---
SBX="$(new_repo alter)"
read -r TIP P1 P2 < <(seed_two "$SBX" hands/alter alter)
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
ROW="$(branch_row hands/alter "$SCAN")"
assert_eq "$(jx "$ROW" 'j.class')" "unintegrated" "alter: class unintegrated"
assert_eq "$(jx "$ROW" 'j.integrated')" "false" "alter: integrated false"
assert_eq "$(jx "$ROW" 'j.integrated_by')" "<undef>" "alter: no integrated_by"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --integration-ref develop >/dev/null
git -C "$SBX" rev-parse --verify -q refs/heads/hands/alter >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "alter: must not be deleted"

# --- 3. only one of two commits adopted ---
SBX="$(new_repo one)"
read -r TIP P1 P2 < <(seed_two "$SBX" hands/one one)
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
ROW="$(branch_row hands/one "$SCAN")"
assert_eq "$(jx "$ROW" 'j.class')" "unintegrated" "one: class unintegrated"
assert_eq "$(jx "$ROW" 'j.integrated')" "false" "one: integrated false"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --integration-ref develop >/dev/null
git -C "$SBX" rev-parse --verify -q refs/heads/hands/one >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "one: must not be deleted"

# --- 4. ancestor: integrated_by ancestor, still deleted ---
SBX="$(new_repo anc)"
BASE="$(old_commit_file "$SBX" base a.txt base)"
no_reflog_branch "$SBX" hands/anc "$BASE"
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
ROW="$(branch_row hands/anc "$SCAN")"
assert_eq "$(jx "$ROW" 'j.class')" "integrated" "ancestor: class integrated"
assert_eq "$(jx "$ROW" 'j.integrated_by')" "ancestor" "ancestor: integrated_by ancestor"
assert_eq "$(jx "$ROW" 'j.patch_id_matches')" "<undef>" "ancestor: no patch_id_matches"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --integration-ref develop >/dev/null
git -C "$SBX" rev-parse --verify -q refs/heads/hands/anc >/dev/null && fail "ancestor: should still be deleted" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# --- 5. clean worktree whose HEAD was cherry-picked ---
SBX="$(new_repo wt)"
read -r TIP P1 P2 < <(seed_two "$SBX" hands/wt-src both)
git -C "$SBX" worktree add -q "$TEST_TMP/wt-picked" "$TIP"
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
assert_eq "$(jx "$SCAN" 'j.worktrees.find(w=>w.path.endsWith("/wt-picked")).class')" "clean-integrated" "worktree: clean-integrated"
assert_eq "$(jx "$SCAN" 'j.worktrees.find(w=>w.path.endsWith("/wt-picked")).integrated_by')" "patch_id" "worktree: integrated_by patch_id"
assert_eq "$(jx "$SCAN" 'j.worktrees.find(w=>w.path.endsWith("/wt-picked")).patch_id_matches.length')" "2" "worktree: two patch-id matches"

# <repo> <message> <path> — delete a tracked file, dated 5 days ago; prints new HEAD.
old_rm_file() {
  local sbx="$1" msg="$2" rel="$3"
  local now d
  now="$(date +%s)"
  d="$(date -d "@$((now - 5 * 86400))" -R)"
  git -C "$sbx" rm -q -- "$rel"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git -C "$sbx" -c user.email=t@t -c user.name=t commit -q -m "$msg"
  git -C "$sbx" rev-parse HEAD
}

# --- 6. add / delete / re-add: same patch-id must not be spent twice ---
# A adds x, B deletes x, C adds x again. develop gets an unrelated commit, then only A and B
# are cherry-picked. git cherry is a set check, so all three lines are '-', and C's patch-id
# equals the pick of A. The branch tip still contains x; develop does not. Not integrated.
SBX="$(new_repo abc)"
old_commit_file "$SBX" base a.txt base >/dev/null
git -C "$SBX" checkout -q --detach
A="$(old_commit_file "$SBX" A x.txt X)"
B="$(old_rm_file "$SBX" B x.txt)"
C="$(old_commit_file "$SBX" C x.txt X)"
git -C "$SBX" checkout -q develop
old_commit_file "$SBX" side z.txt side >/dev/null
git -C "$SBX" -c user.email=t@t -c user.name=t cherry-pick "$A" "$B" >/dev/null
no_reflog_branch "$SBX" hands/abc "$C"
SCAN="$(node "$SCRIPT" scan --repo "$SBX" --integration-ref develop)"
ROW="$(branch_row hands/abc "$SCAN")"
assert_eq "$(jx "$ROW" 'j.class')" "unintegrated" "abc: class unintegrated"
assert_eq "$(jx "$ROW" 'j.integrated')" "false" "abc: integrated false"
assert_eq "$(jx "$ROW" 'j.integrated_by')" "<undef>" "abc: no integrated_by"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --integration-ref develop >/dev/null
git -C "$SBX" rev-parse --verify -q refs/heads/hands/abc >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "abc: must not be deleted"
git -C "$SBX" cat-file -e develop:x.txt >/dev/null 2>&1 && fail "abc: develop must not contain x" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

finalize_test
