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

# ---------------------------------------------------------------- argv hygiene
node "$SCRIPT" reap --repo "$SBX" >/dev/null 2>&1; assert_eq "$?" "2" "reap without --yes → 2"
node "$SCRIPT" preserve --repo "$SBX" >/dev/null 2>&1; assert_eq "$?" "2" "preserve without --out → 2"
node "$SCRIPT" scan >/dev/null 2>&1; assert_eq "$?" "2" "no --repo → 2"
node "$SCRIPT" scan --repo "$TEST_TMP" >/dev/null 2>&1; assert_eq "$?" "2" "non-repo → 2"

exec 9>&-
finalize_test
