#!/usr/bin/env bash
# repo-residue-sweep.test.sh — repo-wide residue: classification from git facts, preserve that
# verifies before it claims, reap that refuses everything it cannot prove safe.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
G() { git -C "$SBX" -c user.email=t@t -c user.name=t "$@"; }
G init -q -b develop; echo a > "$SBX/a.txt"; G add a.txt; G commit -q -m base
BASE="$(G rev-parse HEAD)"
field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);let v=j;for(const k of process.argv[1].split(".")){v=v==null?undefined:v[k];}process.stdout.write(v===undefined?"<undef>":(typeof v==="object"?JSON.stringify(v):String(v)));})' "$2"; }

# fixtures: five worktrees + branches
mk_wt() { G worktree add -q "$TEST_TMP/wt-$1" -b "$1" "$BASE" 2>/dev/null; }
mk_wt integrated-clean;   # branch tip == BASE → integrated
mk_wt unintegrated-clean; git -C "$TEST_TMP/wt-unintegrated-clean" -c user.email=t@t -c user.name=t commit -q --allow-empty -m ahead
mk_wt dirty-one; echo staged > "$TEST_TMP/wt-dirty-one/s.txt"; git -C "$TEST_TMP/wt-dirty-one" add s.txt; echo unstaged >> "$TEST_TMP/wt-dirty-one/a.txt"; echo untracked > "$TEST_TMP/wt-dirty-one/u.txt"
mk_wt live-one; exec 9>"$TEST_TMP/wt-live-one/.autopilot-worktree.lock"; flock -n 9
mk_wt gone-one; rm -rf "$TEST_TMP/wt-gone-one"
G branch merged-branch "$BASE"          # integrated, not checked out
G branch ahead-branch unintegrated-clean # unintegrated, not checked out

# ---------------------------------------------------------------- scan
OUT="$(node "$SCRIPT" scan --repo "$SBX")"; RC=$?
assert_eq "$RC" "0" "scan exit 0"
assert_eq "$(field "$OUT" summary.worktrees.clean-integrated)" "1" "scan: clean-integrated"
assert_eq "$(field "$OUT" summary.worktrees.clean-unintegrated)" "1" "scan: clean-unintegrated"
assert_eq "$(field "$OUT" summary.worktrees.dirty)" "1" "scan: dirty"
assert_eq "$(field "$OUT" summary.worktrees.live)" "1" "scan: live (lock held)"
assert_eq "$(field "$OUT" summary.worktrees.missing-dir)" "1" "scan: missing-dir"
assert_eq "$(field "$OUT" summary.branches.integrated)" "1" "scan: integrated branch (merged-branch)"
assert_eq "$(field "$OUT" summary.branches.unintegrated)" "1" "scan: unintegrated branch (ahead-branch)"
assert_eq "$(field "$OUT" summary.branches.checked-out)" "5" "scan: checked-out branches"
assert_contains "$OUT" '"dirty_lines":3' "scan: dirty inventory counts staged+unstaged+untracked"
# scan touched nothing
assert_eq "$(G worktree list | wc -l)" "6" "scan is read-only (worktrees)"

# ---------------------------------------------------------------- reap without preserve: dirty/live/unintegrated stay
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes)"; RC=$?
assert_eq "$RC" "0" "reap exit 0 (nothing it was asked to remove was left)"
[ -d "$TEST_TMP/wt-integrated-clean" ] && fail "reap: clean-integrated removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$TEST_TMP/wt-unintegrated-clean" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: clean-unintegrated kept"
[ -d "$TEST_TMP/wt-dirty-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: dirty kept without preserve record"
[ -d "$TEST_TMP/wt-live-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: live kept"
assert_contains "$OUT" '"why":"no verified preserve record under --preserve-dir"' "reap: dirty kept names the reason"
G rev-parse --verify --quiet refs/heads/merged-branch >/dev/null && fail "reap: integrated branch deleted" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
G rev-parse --verify --quiet refs/heads/ahead-branch >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: unintegrated branch kept"
G rev-parse --verify --quiet refs/heads/integrated-clean >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: branch of a removed worktree is only deleted when integrated AND not checked out — it IS integrated, so it goes on the next pass or now"
assert_contains "$(field "$OUT" actions.worktrees_removed)" 'wt-gone-one' "reap: missing-dir pruned"
assert_contains "$(field "$OUT" actions.branches_deleted)" 'merged-branch' "reap: branches_deleted lists merged-branch"

# ---------------------------------------------------------------- preserve dirty, verify, then reap it
PRES="$TEST_TMP/preserve"
OUT="$(node "$SCRIPT" preserve --repo "$SBX" --out "$PRES")"; RC=$?
assert_eq "$RC" "0" "preserve exit 0"
assert_eq "$(field "$OUT" preserved.0.preserved)" "true" "preserve: dirty worktree preserved"
PDIR="$(field "$OUT" preserved.0.dir)"
assert_file_exists "$PDIR/manifest.json" "preserve: manifest"
assert_file_exists "$PDIR/head-to-worktree.patch" "preserve: combined patch"
assert_file_exists "$PDIR/untracked.tar" "preserve: untracked archive"
assert_contains "$(cat "$PDIR/head-to-worktree.patch")" '+unstaged' "preserve: unstaged edit captured"
assert_contains "$(cat "$PDIR/staged.patch")" '+staged' "preserve: staged edit captured"
assert_contains "$(tar -tf "$PDIR/untracked.tar")" 'u.txt' "preserve: untracked file archived"
assert_eq "$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(m.parts["head-to-worktree.patch"].applies_to_head))' "$PDIR/manifest.json")" "true" "preserve: patch verified against HEAD"
[ -d "$TEST_TMP/wt-dirty-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "preserve does not remove"

# tamper: change the worktree after preserving → record invalid → kept
echo more >> "$TEST_TMP/wt-dirty-one/a.txt"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --preserve-dir "$PRES")"
[ -d "$TEST_TMP/wt-dirty-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: changed-since-preserve worktree kept"
assert_contains "$OUT" 'worktree changed since it was preserved' "reap: names the drift"
# a NEW untracked file after preserve (invisible to `git diff HEAD` and to the tar's sha256) → kept
node "$SCRIPT" preserve --repo "$SBX" --out "$PRES" >/dev/null
echo late > "$TEST_TMP/wt-dirty-one/late.txt"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --preserve-dir "$PRES")"
[ -d "$TEST_TMP/wt-dirty-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: new untracked file after preserve → kept"
assert_contains "$OUT" 'untracked files changed since it was preserved' "reap: names the untracked drift"
# an EDITED untracked file after preserve → kept
node "$SCRIPT" preserve --repo "$SBX" --out "$PRES" >/dev/null
echo edited > "$TEST_TMP/wt-dirty-one/late.txt"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --preserve-dir "$PRES")"
[ -d "$TEST_TMP/wt-dirty-one" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: edited untracked file after preserve → kept"
# re-preserve, then reap removes it
node "$SCRIPT" preserve --repo "$SBX" --out "$PRES" >/dev/null
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --preserve-dir "$PRES")"; RC=$?
[ -d "$TEST_TMP/wt-dirty-one" ] && fail "reap: preserved dirty worktree removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_contains "$(field "$OUT" actions.worktrees_removed)" '"preserve_record"' "reap: removal cites the preserve record"

# tampered preserve bytes → refused (fresh dirty worktree)
mk_wt dirty-two; echo x > "$TEST_TMP/wt-dirty-two/x.txt"
node "$SCRIPT" preserve --repo "$SBX" --out "$PRES" --worktree "$TEST_TMP/wt-dirty-two" >/dev/null
P2="$(ls -d "$PRES"/wt-dirty-two-* | head -1)"; echo corrupt >> "$P2/untracked.tar"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --preserve-dir "$PRES")"
[ -d "$TEST_TMP/wt-dirty-two" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: tampered preserve record refused"
assert_contains "$OUT" 'sha256 mismatch' "reap: names the tamper"

# ---------------------------------------------------------------- --older-than-days narrows
mk_wt young-clean
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --older-than-days 30)"
[ -d "$TEST_TMP/wt-young-clean" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "older-than: young clean-integrated kept"
assert_contains "$OUT" 'younger than 30 days' "older-than: reason named"

# ---------------------------------------------------------------- stale local develop: integration = newer of local and upstream
# Main checkout's local develop is BEHIND origin/develop (a HEAD merged+pushed elsewhere). A worktree whose
# HEAD is only on origin/develop is integrated; one on neither is not; a dirty one is never removed.
UP="$TEST_TMP/up"; mkdir -p "$UP"
U() { git -C "$UP" -c user.email=t@t -c user.name=t "$@"; }
ORIGIN="$TEST_TMP/origin.git"; git init -q --bare -b develop "$ORIGIN"
git clone -q "$ORIGIN" "$UP" 2>/dev/null; U checkout -q -b develop 2>/dev/null; echo a > "$UP/a.txt"; U add a.txt; U commit -q -m base; U push -q -u origin develop 2>/dev/null
echo b > "$UP/b.txt"; U add b.txt; U commit -q -m merged-elsewhere; PUSHED="$(U rev-parse HEAD)"; U push -q origin develop 2>/dev/null
U reset -q --hard HEAD~1                     # local develop behind origin/develop by one commit
U worktree add -q --detach "$TEST_TMP/up-wt-remote" "$PUSHED" 2>/dev/null          # HEAD only on origin/develop
U worktree add -q --detach "$TEST_TMP/up-wt-dirty" "$PUSHED" 2>/dev/null; echo x >> "$TEST_TMP/up-wt-dirty/a.txt"
U worktree add -q --detach "$TEST_TMP/up-wt-neither" "$PUSHED" 2>/dev/null; git -C "$TEST_TMP/up-wt-neither" -c user.email=t@t -c user.name=t commit -q --allow-empty -m unpushed
assert_eq "$(U merge-base --is-ancestor "$PUSHED" develop >/dev/null 2>&1; echo $?)" "1" "stale fixture: pushed HEAD is NOT on local develop"
assert_eq "$(U merge-base --is-ancestor "$PUSHED" origin/develop >/dev/null 2>&1; echo $?)" "0" "stale fixture: pushed HEAD is on origin/develop"
OUT="$(node "$SCRIPT" scan --repo "$UP")"
assert_eq "$(field "$OUT" summary.worktrees.clean-integrated)" "1" "stale develop: HEAD only on origin/develop is clean-integrated"
assert_eq "$(field "$OUT" integration_ref)" "origin/develop" "stale develop: widened baseline is reported as the upstream ref, not HEAD (BL-0127)"
assert_eq "$(field "$OUT" integration_sha)" "$PUSHED" "stale develop: integration_sha is the upstream tip"
assert_eq "$(field "$OUT" summary.worktrees.clean-unintegrated)" "1" "stale develop: HEAD on neither stays clean-unintegrated"
assert_eq "$(field "$OUT" summary.worktrees.dirty)" "1" "stale develop: dirty stays dirty"
OUT="$(node "$SCRIPT" scan --repo "$UP" --integration-ref develop)"
assert_eq "$(field "$OUT" summary.worktrees.clean-integrated)" "<undef>" "explicit --integration-ref develop is literal (stale, not widened)"
node "$SCRIPT" reap --repo "$UP" --yes >/dev/null
[ -d "$TEST_TMP/up-wt-remote" ] && fail "stale develop: origin-only integrated worktree removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$TEST_TMP/up-wt-dirty" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "stale develop: dirty worktree kept"
[ -d "$TEST_TMP/up-wt-neither" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "stale develop: unintegrated worktree kept"

# ---- diverged: local develop gains its own commit -> local stays the baseline, origin-only HEAD is NOT integrated
U commit -q --allow-empty -m local-only
U worktree add -q --detach "$TEST_TMP/up-wt-diverged" "$PUSHED" 2>/dev/null     # the earlier origin-only worktree was reaped
OUT="$(node "$SCRIPT" scan --repo "$UP")"
assert_eq "$(field "$OUT" summary.worktrees.clean-integrated)" "<undef>" "diverged develop: origin-only HEAD stays unintegrated (local baseline kept)"

# ---- local-branch upstream must not widen: develop tracks local hands/x, behind it
LP="$TEST_TMP/lp"; mkdir -p "$LP"
L() { git -C "$LP" -c user.email=t@t -c user.name=t "$@"; }
L init -q -b develop; echo a > "$LP/a.txt"; L add a.txt; L commit -q -m base
L checkout -q -b hands/x; L commit -q --allow-empty -m only-on-hands; L checkout -q develop
L branch --set-upstream-to=hands/x develop >/dev/null 2>&1
node "$SCRIPT" reap --repo "$LP" --yes >/dev/null
L rev-parse --verify --quiet refs/heads/hands/x >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "local-branch upstream: hands/x deleted"
OUT="$(node "$SCRIPT" scan --repo "$LP")"
assert_eq "$(field "$OUT" summary.branches.unintegrated)" "1" "local-branch upstream: hands/x stays unintegrated"

# ---------------------------------------------------------------- argv hygiene
node "$SCRIPT" reap --repo "$SBX" >/dev/null 2>&1; assert_eq "$?" "2" "reap without --yes → 2"
node "$SCRIPT" preserve --repo "$SBX" >/dev/null 2>&1; assert_eq "$?" "2" "preserve without --out → 2"
node "$SCRIPT" scan >/dev/null 2>&1; assert_eq "$?" "2" "no --repo → 2"
node "$SCRIPT" scan --repo "$TEST_TMP" >/dev/null 2>&1; assert_eq "$?" "2" "non-repo → 2"

exec 9>&-
finalize_test
