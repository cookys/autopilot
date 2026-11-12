#!/usr/bin/env bash
# BL-0416 plus fleet 01M788GD: the round fingerprint watches the main checkout's HEAD (sha and
# symbolic target), the branch that checkout is on, this round's --base when it names a ref, and
# the working tree / index / hooks, and config except another branch's branch.<name>.* tracking
# keys. This round's own --branch is exempt (the round creates and moves it). Another
# refs/heads/* being created, moved or deleted, and another worktree being added, is not a
# mutation, including when git writes or deletes that other branch's tracking keys. A rejection
# still names the refs that did move. Two-level branch.<var> and every other config section still
# reject.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
for _git_cfg_i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  unset "GIT_CONFIG_KEY_${_git_cfg_i}" "GIT_CONFIG_VALUE_${_git_cfg_i}"
done
unset _git_cfg_i

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
BASE_FULL="$(git -C "$SBX" rev-parse HEAD)"
# origin/develop is a remote-tracking ref, so branch.autoSetupMerge (default true) writes
# branch.<name>.remote / branch.<name>.merge when a branch is created from it, and deletes
# those keys when that branch is deleted.
git init -q --bare -b develop "$TEST_TMP/origin.git"
git -C "$SBX" remote add origin "$TEST_TMP/origin.git"
git -C "$SBX" update-ref refs/remotes/origin/develop "$BASE_FULL"
printf 'node_modules/\ncl/\n' >> "$SBX/.git/info/exclude"; mkdir -p "$SBX/node_modules"; echo x > "$SBX/node_modules/keep.txt"
PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOS'
#!/usr/bin/env bash
RESPONSE="${1:-self-report: DONE}" node -e '
  process.stdout.write(JSON.stringify({conversation_id:"fixture",duration_seconds:1,num_turns:1,
    response:process.env.RESPONSE,status:"SUCCESS",
    usage:{cache_read_tokens:7,input_tokens:101,output_tokens:23,thinking_tokens:11,total_tokens:142}}));'
EOS
chmod +x "$AGY_FIXTURE_HELPER"; export AGY_FIXTURE_HELPER

# The stub commits on the dispatch branch; MUTATE selects what else it touches in the main checkout.
STUB="$TEST_TMP/agy-fp"
cat > "$STUB" <<'EOS'
#!/usr/bin/env bash
echo ok > ok.txt; git add ok.txt; git -c user.email=t@t -c user.name=t commit -q -m "hands"
case "${MUTATE:-none}" in
  develop) git -C "$MAIN_SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "main moved" ;;
  symlink) mkdir -p cl; ln -s "$MAIN_SBX/node_modules" cl/node_modules
           mkdir -p cl/node_modules/.vite-temp; echo cfg > cl/node_modules/.vite-temp/vitest.config.js ;;
  insidelink) mkdir -p cl/node_modules; ln -s ../ok.txt cl/inside-link ;;
  other) git -C "$MAIN_SBX" branch unrelated-branch "$(git rev-parse HEAD)"
         git -C "$MAIN_SBX" branch -f pre-existing "$(git -C "$MAIN_SBX" commit-tree "HEAD^{tree}" -m move)"
         git -C "$MAIN_SBX" branch -D doomed ;;
  track) git -C "$MAIN_SBX" branch -f other origin/develop ;;
  deltrack) git -C "$MAIN_SBX" branch -D tracked ;;
  corecfg) git -C "$MAIN_SBX" config core.something fixture ;;
  worktree) git -C "$MAIN_SBX" worktree add -q -b other-wt-branch "$OTHER_WT" HEAD ;;
  switch) git -C "$MAIN_SBX" checkout -q side-branch ;;
esac
"$AGY_FIXTURE_HELPER" "self-report: DONE"
EOS
chmod +x "$STUB"; make_agy_stub_versioned "$STUB"

run() {
  # (env DISPATCH_QUIET is inherited) # branch mutate [extra args]
  local br="$1" mu="$2"; shift 2
  (cd "$SBX" && env MAIN_SBX="$SBX" MUTATE="$mu" OTHER_WT="$TEST_TMP/other-wt" "$SCRIPT" --base "${BASE_FULL:0:9}" --branch "$br" --prompt-file "$PROMPT" --agy-bin "$STUB" "$@" 2>&1)
}

git -C "$SBX" branch pre-existing
git -C "$SBX" branch doomed
git -C "$SBX" branch side-branch
git -C "$SBX" branch tracked origin/develop >/dev/null

OUT="$(run hetero/day-look/c none)"
assert_contains "$OUT" '"status": "committed"' "own --branch ref moving alone is not a main-checkout mutation"
assert_not_contains "$OUT" 'main_checkout_mutated' "…no boundary_code"

PRE_EXISTING_BEFORE="$(git -C "$SBX" rev-parse refs/heads/pre-existing)"
OUT="$(run hetero/day-look/d other)"
assert_contains "$OUT" '"status": "committed"' "(1) another branch created, moved and deleted during the round is not a mutation"
assert_not_contains "$OUT" 'main_checkout_mutated' "(1) …no boundary_code"
assert_eq "0" "$(git -C "$SBX" rev-parse --verify --quiet refs/heads/unrelated-branch >/dev/null; echo $?)" "(1) fixture: the other branch was created"
assert_neq "$PRE_EXISTING_BEFORE" "$(git -C "$SBX" rev-parse refs/heads/pre-existing)" "(1) fixture: the other branch was force-moved"
assert_eq "1" "$(git -C "$SBX" rev-parse --verify --quiet refs/heads/doomed >/dev/null; echo $?)" "(1) fixture: the other branch was deleted"

OUT="$(run hetero/day-look/t track)"
assert_contains "$OUT" '"status": "committed"' "(5) git branch -f other origin/develop is not a mutation"
assert_not_contains "$OUT" 'main_checkout_mutated' "(5) …no boundary_code"
assert_eq "origin" "$(git -C "$SBX" config --get branch.other.remote)" "(5) fixture: branch.other.remote was written"
assert_eq "refs/heads/develop" "$(git -C "$SBX" config --get branch.other.merge)" "(5) fixture: branch.other.merge was written"

OUT="$(run hetero/day-look/u deltrack)"
assert_contains "$OUT" '"status": "committed"' "(6) deleting a tracked branch is not a mutation"
assert_not_contains "$OUT" 'main_checkout_mutated' "(6) …no boundary_code"
assert_eq "1" "$(git -C "$SBX" rev-parse --verify --quiet refs/heads/tracked >/dev/null; echo $?)" "(6) fixture: the tracked branch was deleted"
assert_eq "1" "$(git -C "$SBX" config --get branch.tracked.remote >/dev/null 2>&1; echo $?)" "(6) fixture: branch.tracked.remote was removed"

OUT="$(run hetero/day-look/k corecfg)"
assert_contains "$OUT" '"boundary_code": "main_checkout_mutated"' "(7) an unrelated config key is still a mutation"
assert_contains "$OUT" 'component cfg changed' "(7) …and the delta names cfg"
git -C "$SBX" config --unset core.something

OUT="$(run hetero/day-look/w worktree)"
assert_contains "$OUT" '"status": "committed"' "(2) another worktree added during the round is not a mutation"
assert_not_contains "$OUT" 'main_checkout_mutated' "(2) …no boundary_code"
assert_file_exists "$TEST_TMP/other-wt" "(2) fixture: the other worktree exists"
git -C "$SBX" worktree remove --force "$TEST_TMP/other-wt" 2>/dev/null || true
git -C "$SBX" branch -D other-wt-branch >/dev/null 2>&1 || true

DEV_BEFORE="$(git -C "$SBX" rev-parse refs/heads/develop)"
OUT="$(run hetero/day-look/e develop)"
DEV_AFTER="$(git -C "$SBX" rev-parse refs/heads/develop)"
assert_contains "$OUT" '"boundary_code": "main_checkout_mutated"' "(3) the main checkout's branch advancing is still a mutation"
assert_contains "$OUT" "refs/heads/develop ${DEV_BEFORE:0:12} -> ${DEV_AFTER:0:12}" "(3) …and the rejection names refs/heads/develop with before and after sha"
assert_contains "$OUT" "HEAD ${DEV_BEFORE:0:12} -> ${DEV_AFTER:0:12}" "(3) …and HEAD with before and after sha"

OUT="$(run hetero/day-look/s switch)"
assert_contains "$OUT" '"boundary_code": "main_checkout_mutated"' "(4) switching the main checkout's HEAD is still a mutation"
assert_contains "$OUT" 'HEAD-symref' "(4) …and the delta names the symbolic HEAD target"
git -C "$SBX" checkout -q develop

# BL-0416 (revival.3d): a worktree symlink into the main checkout's node_modules; the runner (vitest/vite)
# writes node_modules/.vite-temp through it. The stat walk covers ignored files, so this is a mutation.
OUT="$(run hetero/day-look/g symlink)"
assert_contains "$OUT" '"boundary_code": "main_checkout_mutated"' "symlink write into main node_modules/.vite-temp is still a mutation"
assert_contains "$OUT" 'component walk changed' "…and the delta names the stat walk (an ignored/untracked file), no ref moved"
assert_contains "$OUT" 'Likely cause: the worktree holds symlink(s) into the main checkout (cl/node_modules -> ' "…and the message names the worktree symlink that points into the main checkout"
assert_file_exists "$SBX/node_modules/.vite-temp/vitest.config.js" "…the write really landed in the main checkout (not excused, not reverted)"
rm -f "$SBX/node_modules/.vite-temp/vitest.config.js"

OUT="$(run hetero/day-look/h insidelink)"
assert_contains "$OUT" '"status": "committed"' "neg control (c): a symlink that stays inside the worktree is no mutation and no leak"

OUT="$(run hetero/day-look/i develop)"
assert_not_contains "$OUT" 'Likely cause: the worktree holds symlink' "neg control (d): a plain develop move with no symlink gets no symlink attribution"

LEDGER="$TEST_TMP/ledger/ledger.jsonl"; mkdir -p "$TEST_TMP/ledger"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER" >/dev/null
OUT="$(DISPATCH_QUIET=1 run hetero/day-look/f none --ledger "$LEDGER" --run-id fp1 --stage implement)"
assert_contains "$OUT" 'committed' "detached run: own ref alone is fine too"
assert_not_contains "$OUT" 'main_checkout_mutated' "…detached, no mutation"
# BL-0416 explainer, direct unit cases for main_checkout_wt_symlink_leaks: path normalisation.
LIBSRC="$REPO_ROOT/scripts/lib/main-checkout-boundary.sh"
leaks() { # <lib> <main> <worktree arg>
  ( MAIN_CHECKOUT="$2"; . "$1" >/dev/null 2>&1; main_checkout_wt_symlink_leaks "$3" ) 2>&1
}
LK="$TEST_TMP/leaks"; mkdir -p "$LK/repo/node_modules" "$LK/repo-sibling/node_modules" "$LK/repo/wt/inner"
ln -s "$LK/repo-sibling/node_modules" "$LK/repo/wt/sib-link"
ln -s "$LK/repo/wt/inner" "$LK/repo/wt/self-link"
ln -s "$LK/repo/node_modules" "$LK/repo/wt/main-link"
OUT="$(leaks "$LIBSRC" "$LK/repo" "$LK/repo/wt")"
assert_not_contains "$OUT" 'sib-link' "sibling dir X/repo-sibling is not inside main checkout X/repo"
assert_contains "$OUT" 'main-link -> ' "…while a symlink into the real main checkout is still listed"
sed_mutant "$LIBSRC" "$TEST_TMP/mut-sibling.sh" 's|"$main"/\*|"$main"*|'
OUT="$(leaks "$TEST_TMP/mut-sibling.sh" "$LK/repo" "$LK/repo/wt")"
assert_contains "$OUT" 'sib-link' "neg control (sibling): prefix match without the slash lists the sibling"

OUT="$(leaks "$LIBSRC" "$LK/repo" "$LK/repo/wt/")"
assert_not_contains "$OUT" 'self-link' "trailing slash on the worktree arg: a symlink inside the worktree is no leak"
assert_contains "$OUT" 'main-link -> ' "…and a symlink into main is still listed"
sed_mutant "$LIBSRC" "$TEST_TMP/mut-slash.sh" '/^  wt="\$(readlink -m/d'
OUT="$(leaks "$TEST_TMP/mut-slash.sh" "$LK/repo" "$LK/repo/wt/")"
assert_contains "$OUT" 'self-link' "neg control (trailing slash): without normalisation the in-worktree symlink is wrongly listed"

# fleet 01M788GD negative control. The real round-scope digest ignores another branch and
# another worktree. sed 's/ = round/ = allrefs/g' restores the all-refs fingerprint (own
# branch still exempt). Those same two actions then change the digest, and that inequality
# is what the rail reports as main_checkout_mutated.
fp_digest() { fp_digest_base "$1" "${BASE_FULL:0:9}"; }
fp_digest_base() {
  (
    MAIN_CHECKOUT="$SBX"
    BRANCH="hetero/day-look/neg"
    BASE="$2"
    MAIN_CHECKOUT_FP_REF_SCOPE=round
    # shellcheck disable=SC1090
    . "$1"
    main_checkout_fingerprint
  )
}
D0="$(fp_digest "$LIBSRC")"
assert_eq "64" "${#D0}" "round-scope digest is a sha256"
git -C "$SBX" branch neg-other "$(git -C "$SBX" rev-parse HEAD)"
D1="$(fp_digest "$LIBSRC")"
assert_eq "$D0" "$D1" "round scope: creating another branch does not change the digest"
git -C "$SBX" branch -D neg-other >/dev/null
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" worktree add -q -b neg-wt "$TEST_TMP/neg-wt" HEAD
D1="$(fp_digest "$LIBSRC")"
assert_eq "$D0" "$D1" "round scope: adding another worktree does not change the digest"
git -C "$SBX" worktree remove --force "$TEST_TMP/neg-wt"
git -C "$SBX" branch -D neg-wt >/dev/null
# --base that names a ref is part of the round fingerprint; a third heads ref is not.
SIDE_BEFORE="$(git -C "$SBX" rev-parse refs/heads/side-branch)"
D0="$(fp_digest_base "$LIBSRC" side-branch)"
assert_eq "64" "${#D0}" "round-scope digest is a sha256 when --base names a ref"
git -C "$SBX" branch neg-unrelated "$(git -C "$SBX" rev-parse HEAD)"
D1="$(fp_digest_base "$LIBSRC" side-branch)"
assert_eq "$D0" "$D1" "round scope: an unrelated branch is not measured when --base names a different ref"
git -C "$SBX" branch -D neg-unrelated >/dev/null
git -C "$SBX" branch -f side-branch "$(git -C "$SBX" rev-parse refs/heads/develop)"
D1="$(fp_digest_base "$LIBSRC" side-branch)"
assert_neq "$D0" "$D1" "round scope: moving the --base ref changes the digest"
git -C "$SBX" branch -f side-branch "$SIDE_BEFORE"
sed_mutant "$LIBSRC" "$TEST_TMP/mut-allrefs.sh" 's/ = round/ = allrefs/g'
D0="$(fp_digest "$TEST_TMP/mut-allrefs.sh")"
assert_eq "64" "${#D0}" "all-refs mutant digest is a sha256"
git -C "$SBX" branch neg-other "$(git -C "$SBX" rev-parse HEAD)"
D1="$(fp_digest "$TEST_TMP/mut-allrefs.sh")"
assert_neq "$D0" "$D1" "neg control (all-refs): creating another branch changes the digest (would be main_checkout_mutated)"
git -C "$SBX" branch -D neg-other >/dev/null
D0="$(fp_digest "$TEST_TMP/mut-allrefs.sh")"
git -C "$SBX" worktree add -q -b neg-wt "$TEST_TMP/neg-wt" HEAD
D1="$(fp_digest "$TEST_TMP/mut-allrefs.sh")"
assert_neq "$D0" "$D1" "neg control (all-refs): adding another worktree changes the digest (would be main_checkout_mutated)"
git -C "$SBX" worktree remove --force "$TEST_TMP/neg-wt"
git -C "$SBX" branch -D neg-wt >/dev/null

# Tracking keys for a branch that is neither the checkout branch nor --base are not part of
# the round-scope config hash. Two-level branch.<var>, the checkout branch, the --base branch
# and every other section still are.
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" branch -f neg-track origin/develop >/dev/null
D1="$(fp_digest "$LIBSRC")"
assert_eq "$D0" "$D1" "round scope: git branch -f from origin/develop does not change the digest"
git -C "$SBX" branch -D neg-track >/dev/null
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" worktree add -q -b neg-wt-track "$TEST_TMP/neg-wt-track" origin/develop
D1="$(fp_digest "$LIBSRC")"
assert_eq "$D0" "$D1" "round scope: worktree add -b from origin/develop does not change the digest"
git -C "$SBX" worktree remove --force "$TEST_TMP/neg-wt-track"
git -C "$SBX" branch -D neg-wt-track >/dev/null
git -C "$SBX" branch neg-del origin/develop >/dev/null
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" branch -D neg-del >/dev/null
D1="$(fp_digest "$LIBSRC")"
assert_eq "$D0" "$D1" "round scope: deleting a tracked branch does not change the digest"
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" config core.fingerprintprobe 1
D1="$(fp_digest "$LIBSRC")"
assert_neq "$D0" "$D1" "round scope: an unrelated config section still changes the digest"
git -C "$SBX" config --unset core.fingerprintprobe
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" config branch.autosetupmerge false
D1="$(fp_digest "$LIBSRC")"
assert_neq "$D0" "$D1" "round scope: a two-level branch.<var> setting still changes the digest"
git -C "$SBX" config --unset branch.autosetupmerge
D0="$(fp_digest "$LIBSRC")"
git -C "$SBX" config branch.develop.description keep
D1="$(fp_digest "$LIBSRC")"
assert_neq "$D0" "$D1" "round scope: the checkout branch's branch.<name>.* still changes the digest"
git -C "$SBX" config --unset branch.develop.description
D0="$(fp_digest "$LIBSRC")"
D0b="$(fp_digest_base "$LIBSRC" side-branch)"
git -C "$SBX" config branch.side-branch.description side
D1="$(fp_digest "$LIBSRC")"
D1b="$(fp_digest_base "$LIBSRC" side-branch)"
assert_eq "$D0" "$D1" "round scope: branch.<other>.* is omitted when that branch is neither HEAD nor --base"
assert_neq "$D0b" "$D1b" "round scope: branch.<base>.* still changes the digest when --base names that branch"
git -C "$SBX" config --unset branch.side-branch.description

# Negative control for the config filter. sed 's/cfgfilter=round/cfgfilter=fullcfg/'
# restores the full config hash and leaves ref scope round. The origin/develop case
# above is then a digest change, which the rail reports as main_checkout_mutated.
sed_mutant "$LIBSRC" "$TEST_TMP/mut-fullcfg.sh" 's/cfgfilter=round/cfgfilter=fullcfg/'
D0="$(fp_digest "$TEST_TMP/mut-fullcfg.sh")"
assert_eq "64" "${#D0}" "full-config mutant digest is a sha256"
git -C "$SBX" branch -f neg-full origin/develop >/dev/null
D1="$(fp_digest "$TEST_TMP/mut-fullcfg.sh")"
assert_neq "$D0" "$D1" "neg control (full config): git branch -f from origin/develop changes the digest (would be main_checkout_mutated)"
git -C "$SBX" branch -D neg-full >/dev/null

finalize_test
