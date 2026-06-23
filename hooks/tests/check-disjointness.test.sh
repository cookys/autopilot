#!/usr/bin/env bash
# check-disjointness.sh integration test — exercises the result-validating
# allowlist enforcer against REAL throwaway git commits (artifacts, never
# self-report). Covers the S1 acceptance criterion:
#   * a unit whose actual commit touches a file OUTSIDE its declared allowlist
#     → `validate` exits NON-ZERO (proven from git diff artifacts).
#   * the clean case (touches ⊆ allowlist) → exit 0.
#   * the width-1 path (a single declared unit owning everything) is unaffected.
# Plus: denylist (lockfile/build-only), root commit, single-SHA, rename, binary,
# glob semantics (`*` no-cross-slash vs `**` any-depth vs bare-dir subtree),
# propose advisory mode, and usage/precondition errors.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-disjointness.sh"

# --- sandbox git repo (never touch the real repo) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b main
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t

# helper: commit current tree with a message, echo the new HEAD sha
commit_head() { git -C "$SBX" add -A; git -C "$SBX" commit -q -m "$1"; git -C "$SBX" rev-parse HEAD; }

mkdir -p "$SBX/src/ui" "$SBX/src/api" "$SBX/src/sub"
echo a > "$SBX/src/ui/a.ts"
echo b > "$SBX/src/api/b.ts"
echo s > "$SBX/src/sub/s.ts"
BASE="$(commit_head base)"

# 1. --help exits 0 and documents the files-only scope + denylist limit
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "FILES ONLY" "--help states the files-only scope"
assert_contains "$HELP_OUT" "lockfiles" "--help documents the regex-ownable denylist limit"

# 2. CLEAN CASE — actual touches ⊆ declared allowlist → exit 0, disjoint:true
echo "ui edit" >> "$SBX/src/ui/a.ts"
H1="$(commit_head 'ui unit')"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/ui/**" --range "$BASE..$H1")"; EXIT=$?
assert_eq "0" "$EXIT" "clean case exit 0"
assert_contains "$OUT" '"disjoint": true' "clean case disjoint:true"
assert_contains "$OUT" '"undeclared_touches": []' "clean case no undeclared touches"
assert_contains "$OUT" '"src/ui/a.ts"' "clean case reports actual touched file from git"

# 3. ACCEPTANCE — actual commit touches a file OUTSIDE the declared allowlist
#    → exit NON-ZERO, the offending file named in undeclared_touches.
#    Verified from the REAL git diff of the commit, NOT any self-report.
echo "ui again" >> "$SBX/src/ui/a.ts"
echo "sneaky api edit" >> "$SBX/src/api/b.ts"
H2="$(commit_head 'ui unit but also touched api')"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/ui/**" --range "$H1..$H2")"; EXIT=$?
assert_neq "0" "$EXIT" "ACCEPTANCE: undeclared touch exits non-zero"
assert_eq "1" "$EXIT" "ACCEPTANCE: undeclared touch exit code is 1 (fail-closed)"
assert_contains "$OUT" '"disjoint": false' "ACCEPTANCE: disjoint:false on undeclared touch"
assert_contains "$OUT" '"undeclared_touches": ["src/api/b.ts"]' "ACCEPTANCE: the out-of-allowlist file is named"

# 4. WIDTH-1 PATH UNAFFECTED — one declared unit owning the whole tree; a commit
#    touching multiple dirs is still clean because the single allowlist covers
#    them all (the fixed-cap-3 width-1 default path must keep passing).
echo "broad" >> "$SBX/src/ui/a.ts"
echo "broad" >> "$SBX/src/api/b.ts"
echo "broad" >> "$SBX/src/sub/s.ts"
H3="$(commit_head 'width-1 single unit touches everything')"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/**" --range "$H2..$H3")"; EXIT=$?
assert_eq "0" "$EXIT" "width-1 single-unit-owns-all exit 0"
assert_contains "$OUT" '"disjoint": true' "width-1 path unaffected (disjoint:true)"

# 5. DENYLIST — touching a lockfile/build file fails even when it is DECLARED
#    in the allowlist (denylist wins; this is the never-widen rail).
echo '{}' > "$SBX/package.json"
H4="$(commit_head 'touch package.json')"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "package.json" --range "$H3..$H4")"; EXIT=$?
assert_eq "1" "$EXIT" "denylist hit exits 1 even when declared"
assert_contains "$OUT" '"denylist_hits": ["package.json"]' "denylist_hits names the lockfile/build file"
# --no-default-deny lets the same declared touch pass (limit is opt-out-able)
OUT2="$("$SCRIPT" validate --repo "$SBX" --allow "package.json" --range "$H3..$H4" --no-default-deny)"; EXIT2=$?
assert_eq "0" "$EXIT2" "--no-default-deny lets a declared package.json touch pass"

# 6. ROOT COMMIT (no parent) — single-SHA mode must diff vs the empty tree, not
#    crash on the missing parent.
RBX="$TEST_TMP/rootrepo"
mkdir -p "$RBX/lib"
git -C "$RBX" init -q -b main
git -C "$RBX" config user.email t@t; git -C "$RBX" config user.name t
echo x > "$RBX/lib/x.ts"
git -C "$RBX" add -A; git -C "$RBX" commit -q -m root
ROOT="$(git -C "$RBX" rev-parse HEAD)"
OUT="$("$SCRIPT" validate --repo "$RBX" --allow "lib/**" --range "$ROOT")"; EXIT=$?
assert_eq "0" "$EXIT" "root commit (no parent) handled, clean"
assert_contains "$OUT" '"lib/x.ts"' "root commit reports the full initial set"

# 7. SINGLE SHA with a parent → diffs its own change only
echo more >> "$RBX/lib/x.ts"
git -C "$RBX" add -A; git -C "$RBX" commit -q -m edit
E="$(git -C "$RBX" rev-parse HEAD)"
OUT="$("$SCRIPT" validate --repo "$RBX" --allow "lib/x.ts" --range "$E")"; EXIT=$?
assert_eq "0" "$EXIT" "single-SHA own-diff clean"

# 8. RENAME collapses to the new path (still inside allowlist → clean)
git -C "$SBX" mv "src/ui/a.ts" "src/ui/renamed.ts"
git -C "$SBX" commit -q -m rename
HR="$(git -C "$SBX" rev-parse HEAD)"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/ui/**" --range "$H4..$HR")"; EXIT=$?
assert_eq "0" "$EXIT" "rename handled (collapses to new path, inside allowlist)"

# 9. BINARY file (numstat '-') handled by --name-only without crashing
printf '\x00\x01\x02bin' > "$SBX/src/ui/img.bin"
HB="$(commit_head 'add binary')"
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/ui/**" --range "$HR..$HB")"; EXIT=$?
assert_eq "0" "$EXIT" "binary file handled"
assert_contains "$OUT" '"src/ui/img.bin"' "binary file is reported"

# 10. GLOB SEMANTICS — `*` must NOT cross '/'; `**` and bare-dir must.
echo q >> "$SBX/src/sub/s.ts"
HG="$(commit_head 'edit sub')"
# `src/*` (single segment) must REJECT src/sub/s.ts
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/*" --range "$HB..$HG")"; EXIT=$?
assert_eq "1" "$EXIT" "single-* does NOT cross slash (rejects src/sub/s.ts)"
# `src/**` must ACCEPT it
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src/**" --range "$HB..$HG")"; EXIT=$?
assert_eq "0" "$EXIT" "double-** matches any depth"
# bare dir `src` owns its subtree
OUT="$("$SCRIPT" validate --repo "$SBX" --allow "src" --range "$HB..$HG")"; EXIT=$?
assert_eq "0" "$EXIT" "bare-dir allowlist owns its subtree"

# 11. PROPOSE (advisory) — disjoint proposal → exit 0
OUT="$("$SCRIPT" propose --unit "ui=src/ui/**" --unit "api=src/api/**")"; EXIT=$?
assert_eq "0" "$EXIT" "propose disjoint exit 0"
assert_contains "$OUT" '"disjoint": true' "propose disjoint:true"
# overlapping proposal → exit 1 + the overlap reported
OUT="$("$SCRIPT" propose --unit "ui=src/ui/**" --unit "api=src/ui/x.ts,src/api/**")"; EXIT=$?
assert_eq "1" "$EXIT" "propose overlap exit 1 (advisory)"
assert_contains "$OUT" '"disjoint": false' "propose overlap disjoint:false"
assert_contains "$OUT" '"a": "ui"' "propose names the overlapping unit pair"
# denylisted glob in a unit → advisory hit
OUT="$("$SCRIPT" propose --unit "ui=src/ui/**,package.json")"; EXIT=$?
assert_eq "1" "$EXIT" "propose denylist hit exit 1"
assert_contains "$OUT" 'package.json' "propose reports the denylisted glob"

# 12. USAGE / PRECONDITION errors (exit 2, nothing checked)
OUT="$("$SCRIPT" validate --allow "src/**" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "validate without --range → exit 2"
OUT="$("$SCRIPT" validate --range "$BASE..$H1" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "validate without --allow → exit 2"
OUT="$("$SCRIPT" bogus-mode 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown mode → exit 2"
OUT="$("$SCRIPT" validate --repo "$TEST_TMP/not-a-repo" --allow "x" --range abc 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "non-git repo → exit 2"

finalize_test
