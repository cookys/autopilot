#!/usr/bin/env bash
# check-hands-commit.test.sh — the content gate for hands commits.
#
# The reproduced incident (308-db 2026-09-07, P6D 2026-08-21): a worktree carries a symlink
# named for a directory the repo ignores with a trailing slash. Git's `dir/` pattern is
# directory-only, so the SYMLINK is not ignored, `git add -A` sweeps it in, and integrating
# the commit replaces the real ignored directory with a link. Every path is in scope.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
G="$REPO_ROOT/scripts/check-hands-commit.js"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n     want: %s\n     got:  %s\n' "$1" "$2" "$3"; }
eq() { [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"; }
jf() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],j);process.stdout.write(Array.isArray(v)?String(v.length):String(v))' "$1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
R="$TMP/repo"; mkdir -p "$R"; git -C "$R" init -q; git -C "$R" config user.email t@t; git -C "$R" config user.name t
printf 'node_modules/\n.venv/\n*.log\n' > "$R/.gitignore"
mkdir -p "$R/src"; echo 'x' > "$R/src/a.txt"
git -C "$R" add -A; git -C "$R" commit -qm base; BASE="$(git -C "$R" rev-parse HEAD)"

# ---------- the incident, byte for byte ----------
# The real ignored dir exists and is untracked; hands adds a SYMLINK with the ignored name.
mkdir -p "$R/node_modules/pkg"; echo real > "$R/node_modules/pkg/index.js"
ln -s /tmp/somewhere "$R/.venv"                 # symlink named for an ignored dir
echo 'y' > "$R/src/b.txt"                        # a legitimate in-scope edit
git -C "$R" add -A                               # what the wrapper does
git -C "$R" commit -qm "hands"; HEAD="$(git -C "$R" rev-parse HEAD)"

# 0. Precondition: prove git really did sweep the symlink in. If this fails the fixture
#    does not reproduce the incident and nothing below means anything.
eq "fixture: git add -A committed the symlink despite '.venv/' being ignored" \
   "120000" "$(git -C "$R" ls-tree "$HEAD" .venv | awk '{print $1}')"
eq "fixture: the real node_modules/ dir was NOT committed (trailing-slash rule works on dirs)" \
   "" "$(git -C "$R" ls-tree "$HEAD" node_modules)"

# 1. The gate rejects it and names the path with both modes.
OUT="$(node "$G" --repo "$R" --base "$BASE" --head "$HEAD")"; RC=$?
eq "incident: exit 1" "1" "$RC"
eq "incident: one symlink named" "1" "$(printf '%s' "$OUT" | jf symlinks)"
eq "incident: the path is .venv" ".venv" "$(printf '%s' "$OUT" | jf symlinks.0.path)"
eq "incident: new_mode 120000" "120000" "$(printf '%s' "$OUT" | jf symlinks.0.new_mode)"
eq "incident: both checks ran" "true" "$(printf '%s' "$OUT" | jf checks_ran.ignore)"

# 2. THE scope gate is blind to this: every path is in scope, so check-disjointness
#    passes. This is the assertion that says why the new gate exists.
printf '.venv\nsrc/**\n' > "$TMP/allow"
( cd "$R" && "$REPO_ROOT/scripts/check-disjointness.sh" validate --range "$BASE..$HEAD" \
   --no-default-deny --allow-file "$TMP/allow" >/dev/null 2>&1 ); SRC=$?
eq "scope gate accepts the same commit (paths are in scope; it never looks at mode)" "0" "$SRC"

# 2b. The damage, reproduced: integrate that commit into a checkout that HAS the real
#     ignored directory. cherry-pick plants the symlink where the directory was. This is
#     308-db's 2026-09-07 incident end to end, not a description of it.
INT="$TMP/integration"; git clone -q "$R" "$INT" 2>/dev/null; git -C "$INT" checkout -q "$BASE"
git -C "$INT" config user.email t@t; git -C "$INT" config user.name t
mkdir -p "$INT/.venv/bin"; echo real-python > "$INT/.venv/bin/python"      # the real ignored dir
eq "integration fixture: .venv is a real directory before integration" "directory" "$( [ -d "$INT/.venv" ] && [ ! -L "$INT/.venv" ] && echo directory || echo other )"
git -C "$INT" cherry-pick "$HEAD" >/dev/null 2>"$TMP/cp.err" || { echo "cherry-pick rc=$? : $(cat "$TMP/cp.err")"; }
eq "AFTER cherry-pick: .venv is now a symlink — the real directory was replaced" "symlink" "$( [ -L "$INT/.venv" ] && echo symlink || echo not-symlink )"
eq "AFTER cherry-pick: the real python binary is gone from the tree" "gone" "$( [ -e "$INT/.venv/bin/python" ] && echo present || echo gone )"

# 3. A clean range is clean, and the checks are recorded as having run.
git -C "$R" rm -q --cached .venv; rm "$R/.venv"; git -C "$R" commit -qm "drop link"; CLEAN="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$HEAD" --head "$CLEAN")"; RC=$?
eq "clean range: exit 0" "0" "$RC"
eq "clean range: ok true" "true" "$(printf '%s' "$OUT" | jf ok)"

# 4. Range semantics: a symlink inherited from BASE is not hands' doing.
ln -s /tmp/x "$R/legacy-link"; git -C "$R" add legacy-link; git -C "$R" commit -qm "legacy link"; B2="$(git -C "$R" rev-parse HEAD)"
echo z > "$R/src/c.txt"; git -C "$R" add -A; git -C "$R" commit -qm "hands 2"; H2="$(git -C "$R" rev-parse HEAD)"
node "$G" --repo "$R" --base "$B2" --head "$H2" >/dev/null; eq "pre-existing symlink in base is not reported" "0" "$?"

# 5. A tracked-but-ignored file inherited from base is not reported either (308 measured
#    three false positives from a whole-tree check).
mkdir -p "$R/.claude/knowledge"; echo k > "$R/.claude/knowledge/a.md"
printf '.claude/knowledge/\n' >> "$R/.gitignore"; git -C "$R" add -f .claude/knowledge/a.md .gitignore; git -C "$R" commit -qm "force-added knowledge"; B3="$(git -C "$R" rev-parse HEAD)"
echo w > "$R/src/d.txt"; git -C "$R" add -A; git -C "$R" commit -qm "hands 3"; H3="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$B3" --head "$H3")"; eq "inherited force-added ignored file not reported (range, not tree)" "0" "$?"

# 6. But a force-added ignored path IN the range is.
echo n > "$R/debug.log"; git -C "$R" add -f debug.log; git -C "$R" commit -qm "hands 4"; H4="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$H3" --head "$H4")"; RC=$?
eq "force-added ignored path in range: exit 1" "1" "$RC"
eq "force-added ignored path named" "debug.log" "$(printf '%s' "$OUT" | jf ignored.0)"

# 6b. A force-added ignored path whose NAME contains a tab and a newline. Newline-delimited
#     parsing quotes it and the ignore check misses it; -z framing does not.
WEIRD="$(printf 'weird\tname\nline.log')"
printf 'w' > "$R/$WEIRD"; git -C "$R" add -f -- "$R/$WEIRD"; git -C "$R" commit -qm "weird name"; H4b="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$H4" --head "$H4b")"; RC=$?
eq "ignored path with tab+newline in its name: exit 1 (not evaded by quoting)" "1" "$RC"
eq "…and it is named in the receipt" "$WEIRD" "$(printf '%s' "$OUT" | jf ignored.0)"
H4="$H4b"

# 6c. A force-added ignored file whose name is INVALID UTF-8 (a lone 0xFF byte). UTF-8
#     decoding would replace the byte before check-ignore saw it, and a raw-byte ignore
#     rule would no longer match (review, 2026-09-13).
RAWNAME="$(printf 'raw\xff.log')"
printf 'r' > "$R/$RAWNAME"; git -C "$R" add -f -- "$R/$RAWNAME"; git -C "$R" commit -qm "raw-byte name"; H4c="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$H4" --head "$H4c")"; RC=$?
eq "invalid-UTF-8 ignored filename: exit 1 (bytes reached check-ignore intact)" "1" "$RC"
eq "…one ignored path reported" "1" "$(printf '%s' "$OUT" | jf ignored)"
H4="$H4c"

# 6d. A refs/replace entry that makes the unsafe head LOOK like a clean commit must not
#     fool the check (round 6, 2026-09-13).
git -C "$R" checkout -q -b decoy "$H4"; echo d > "$R/src/decoy.txt"; git -C "$R" add -A; git -C "$R" commit -qm decoy; DECOY="$(git -C "$R" rev-parse HEAD)"; git -C "$R" checkout -q -
git -C "$R" replace "$HEAD" "$DECOY"
eq "sanity: with replacement active, plain diff-tree no longer shows .venv" "" "$(git -C "$R" diff-tree -r --no-commit-id "$BASE" "$HEAD" | grep -F ".venv")"
node "$G" --repo "$R" --base "$BASE" --head "$HEAD" >/dev/null; eq "replaced unsafe head: still exit 1 (replacement ignored)" "1" "$?"
git -C "$R" replace -d "$HEAD"; git -C "$R" branch -D decoy >/dev/null

# 7. Modification-only range: zero added paths, check-ignore must NOT be called with empty
#    stdin (rc 128) and the ignore check still counts as run.
echo zz > "$R/src/a.txt"; git -C "$R" add -A; git -C "$R" commit -qm "mod only"; H5="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$H4" --head "$H5")"; RC=$?
eq "modify-only range: exit 0, not 3" "0" "$RC"
eq "modify-only range: ignore check recorded as run" "true" "$(printf '%s' "$OUT" | jf checks_ran.ignore)"

# 8. Gitlink added.
mkdir -p "$R/sub"; git -C "$R/sub" init -q; git -C "$R/sub" config user.email t@t; git -C "$R/sub" config user.name t
echo s > "$R/sub/f"; git -C "$R/sub" add -A; git -C "$R/sub" commit -qm s
git -C "$R" -c protocol.file.allow=always submodule add -q "$R/sub" vendored 2>/dev/null || git -C "$R" add vendored
git -C "$R" commit -qm "gitlink" 2>/dev/null; H6="$(git -C "$R" rev-parse HEAD)"
OUT="$(node "$G" --repo "$R" --base "$H5" --head "$H6")"; RC=$?
eq "gitlink added: exit 1" "1" "$RC"
eq "gitlink path named" "vendored" "$(printf '%s' "$OUT" | jf gitlinks.0.path)"

# 9. There is no allowlist: a symlink hands adds is rejected, full stop.
ln -s src "$R/alias"; git -C "$R" add alias; git -C "$R" commit -qm "link"; H7="$(git -C "$R" rev-parse HEAD)"
node "$G" --repo "$R" --base "$H6" --head "$H7" >/dev/null; eq "added symlink: exit 1" "1" "$?"
node "$G" --repo "$R" --base "$H6" --head "$H7" --allow-symlink alias >/dev/null 2>&1; eq "--allow-symlink is not a flag: usage 2" "2" "$?"

# 9a. Modifying a tracked-but-ignored file that BASE already carried is not "bringing it
#     in": only A entries reach the ignore check (review finding, 2026-09-13).
echo k2 > "$R/.claude/knowledge/a.md"; git -C "$R" add -f .claude/knowledge/a.md; git -C "$R" commit -qm "edit force-added"; H7b="$(git -C "$R" rev-parse HEAD)"
node "$G" --repo "$R" --base "$H7" --head "$H7b" >/dev/null; eq "modifying an inherited force-added ignored file is NOT rejected" "0" "$?"
H7="$H7b"

# 9b. Receipt carries FULL oids even when the caller abbreviated (308-db feedback).
OUT="$(node "$G" --repo "$R" --base "${H6:0:7}" --head "${H7:0:7}")"
eq "abbreviated --base is recorded as the full oid" "$H6" "$(printf '%s' "$OUT" | jf base)"
eq "abbreviated --head is recorded as the full oid" "$H7" "$(printf '%s' "$OUT" | jf head)"

# 10. Cannot-run is 3, never 0.
node "$G" --repo "$R" --base deadbeef --head "$H7" >/dev/null 2>&1; eq "bad base sha: exit 3 (not verified), not 0" "3" "$?"
node "$G" --repo "$R" --base "$H6" >/dev/null 2>&1; eq "missing --head: usage 2" "2" "$?"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
