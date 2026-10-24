#!/usr/bin/env bash
# Repo audit: every negative-control mutation of a product file in hooks/tests must fail loudly when its
# anchor stops matching (sed_mutate / sed_mutant, or a cmp/grep check right after; a python or node
# mutation must exit non-zero on a missing anchor). Born from BL-0293: an edit split the text a sed
# anchored on, the "mutant" was the unmodified rail, and the control passed for the wrong reason.
# Scope and blind spots are listed in hooks/tests/lib/mutation-anchor-scan.js.
. "$(dirname "$0")/lib.sh"
SCAN="$REPO_ROOT/hooks/tests/lib/mutation-anchor-scan.js"

# 1) the real tests directory is clean
OUT="$(node "$SCAN" "$REPO_ROOT/hooks/tests" 2>&1)"; RC=$?
assert_eq "0" "$RC" "no unguarded product mutation in hooks/tests (found: ${OUT:-none})"

# 2) NEGATIVE CONTROLS on a synthetic tests dir: each bare form must be flagged, each guarded form must not.
FX="$TEST_TMP/fx"; mkdir -p "$FX"
flagged() { # <label> <expect-count> <<< file body
  local body; body="$(cat)"
  rm -f "$FX"/*.test.sh; printf '%s\n' "$body" > "$FX/case.test.sh"
  local n; n="$(node "$SCAN" "$FX" 2>/dev/null | grep -c . )"
  assert_eq "$2" "$n" "$1"
}
flagged "bare sed -i on a product copy is flagged" 1 <<'EOF'
sed -i 's/a/b/' "$MUT/scripts/x.sh"
EOF
flagged "bare sed > mutant of a product file is flagged" 1 <<'EOF'
sed 's/a/b/' "$LIB" > "$TEST_TMP/mut.js"
EOF
flagged "perl -pi on a product copy is flagged" 1 <<'EOF'
perl -pi -e 's/a/b/' "$MUT/scripts/x.sh"
EOF
flagged "sed_mutate is accepted" 0 <<'EOF'
sed_mutate "$MUT/scripts/x.sh" 's/a/b/'
EOF
flagged "sed_mutant is accepted" 0 <<'EOF'
sed_mutant "$LIB" "$TEST_TMP/mut.js" 's/a/b/'
EOF
flagged "sed followed by a cmp check is accepted" 0 <<'EOF'
sed 's/a/b/' "$LIB" > "$TEST_TMP/mut.js"
cmp -s "$LIB" "$TEST_TMP/mut.js" && fail "mutation did not apply"
EOF
flagged "an intentional-miss baseline is accepted" 0 <<'EOF'
sed -i 's/@@NONE@@//' "$MUT/tmp-residue.js"   # mutation-anchor: intentional-miss
EOF
flagged "sed on fixture data (no product path) is not in scope" 0 <<'EOF'
sed -i 's/a/b/' "$TEST_TMP/data.log"
EOF
flagged "python .replace() that exits 0 on a missing anchor is flagged" 1 <<'EOF'
python3 - "$MUT/scripts/x.sh" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text()
if "old" not in t:
    sys.exit(0)
p.write_text(t.replace("old", "new", 1))
PY
EOF
flagged "python .replace() that exits non-zero on a missing anchor is accepted" 0 <<'EOF'
python3 - "$MUT/scripts/x.sh" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text()
if "old" not in t:
    sys.exit(3)
p.write_text(t.replace("old", "new", 1))
PY
EOF
flagged "node .replace() writing a product copy with no failure is flagged" 1 <<'EOF'
node - "$MUT/scripts/x.js" <<'JS'
const fs = require('fs'); const f = process.argv[2];
fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('old', 'new'));
JS
EOF

# 2b) scanner gaps closed in round 2: each must turn the audit red on its own.
flagged "a sed whose redirect sits on a backslash-continued second line is flagged" 1 <<'EOF'
sed -e 's/a/b/' \
  "$LIB" > "$TEST_TMP/mut.js"
EOF
flagged "the braced \${LIB} spelling is recognised as a product path" 1 <<'EOF'
sed 's/a/b/' "${LIB}" > "$TEST_TMP/mut.js"
EOF
flagged "a /re/d line-deletion mutation is flagged" 1 <<'EOF'
sed -i '/result === x/d' "$MUT/scripts/session-mode.js"
EOF
flagged "an i-command mutation is flagged" 1 <<'EOF'
sed -i '3i injected' "${GATE}"
EOF
flagged "a bare sed with several -e is flagged even when a cmp follows" 1 <<'EOF'
sed -i -e 's/a/b/' -e 's/c/d/' "$MUT/scripts/x.sh"
cmp -s "$GATE" "$MUT/scripts/x.sh" && fail "mutation did not apply"
EOF
flagged "a continued sed followed by an assert_neq content comparison is accepted" 0 <<'EOF'
sed 's/a/b/' \
  "$SCRIPT" > "$STALE"
assert_neq "$(cat "$STALE")" "$(cat "$SCRIPT")" "sed actually patched the scratch copy"
EOF

# 3) the helpers themselves: a miss fails (also from inside $( )), a hit passes.
T="$TEST_TMP/helper"; mkdir -p "$T"; printf 'alpha\n' > "$T/f"
( . "$REPO_ROOT/hooks/tests/lib.sh"; sed_mutate "$T/f" 's/alpha/beta/' ) >/dev/null 2>&1
assert_eq "0" "$?" "sed_mutate: a hit succeeds"
( . "$REPO_ROOT/hooks/tests/lib.sh"; sed_mutate "$T/f" 's/zzz/y/' ) >/dev/null 2>&1
assert_neq "0" "$?" "sed_mutate: a miss fails"
( . "$REPO_ROOT/hooks/tests/lib.sh"; sed_mutate "$T/nope" 's/a/b/' ) >/dev/null 2>&1
assert_neq "0" "$?" "sed_mutate: a missing file fails"
SUB="$TEST_TMP/subshell-suite.test.sh"
cat > "$SUB" <<EOS
. "$REPO_ROOT/hooks/tests/lib.sh"
printf 'alpha\n' > "\$TEST_TMP/g"
X="\$(sed_mutate "\$TEST_TMP/g" 's/zzz/y/')"
assert_eq 1 1 "unrelated passing assertion"
finalize_test
EOS
bash "$SUB" >/dev/null 2>&1
assert_neq "0" "$?" "a miss inside \$( ) still fails the suite via finalize_test"
# 4) helpers: ONE sed command per call, applied by the real sed. Anything that is not recognisably one command is
# refused (never guessed), a single command that does not change the file fails, sed failures fail.
H="$TEST_TMP/h2"; mkdir -p "$H"
printf 'alpha\nbeta\ngamma\n' > "$H/src"
runh() { ( . "$REPO_ROOT/hooks/tests/lib.sh"; "$@" ) >"$H/out" 2>&1; }
runh sed_mutant "$H/src" "$H/d1" 's/alpha/A/'
assert_eq "0" "$?" "sed_mutant: a single hitting command passes"
assert_eq "A
beta
gamma" "$(cat "$H/d1")" "sed_mutant: the real sed produced the destination"
runh sed_mutant "$H/src" "$H/d2" 's/nothere/B/'
assert_neq "0" "$?" "sed_mutant: a single command that misses fails"
runh sed_mutant "$H/src" "$H/d3" -e 's/alpha/A/' -e 's/beta/B/'
assert_neq "0" "$?" "sed_mutant: more than one -e is refused"
assert_contains "$(cat "$H/out")" "one sed command per call" "sed_mutant: the refusal says to split into separate calls"
runh sed_mutant "$H/src" "$H/d4" 's/alpha/A/; s/beta/B/'
assert_neq "0" "$?" "sed_mutant: ';'-chained commands are refused"
runh sed_mutant "$H/src" "$H/d5" 's/alpha/A/
s/beta/B/'
assert_neq "0" "$?" "sed_mutant: a newline-separated script is refused"
runh sed_mutant "$H/src" "$H/d6" '/beta/{s/beta/B/}'
assert_neq "0" "$?" "sed_mutant: a {...} block is refused"
runh sed_mutant "$H/src" "$H/d7" 's/a/b/s/b/c/'
assert_neq "0" "$?" "sed_mutant: an illegal s/a/b/s/b/c/ is refused, not read as two substitutions"
runh sed_mutant "$H/src" "$H/d8" '/beta/d;2i inserted'
assert_neq "0" "$?" "sed_mutant: '/beta/d;2i inserted' is refused (chained commands change meaning when split)"
runh sed_mutant "$H/src" "$H/d9" -f "$H/src"
assert_neq "0" "$?" "sed_mutant: -f is refused"
runh sed_mutant "$H/src" "$H/d10" '/beta/d'
assert_eq "0" "$?" "sed_mutant: a hitting /re/d passes"
runh sed_mutant "$H/src" "$H/d11" '/nomatch/d'
assert_neq "0" "$?" "sed_mutant: a /re/d that matches nothing fails"
runh sed_mutant "$H/src" "$H/d12" '2i inserted'
assert_eq "0" "$?" "sed_mutant: an i command passes"
runh sed_mutant "$H/src" "$H/d13" -E 's/(/x/'
assert_neq "0" "$?" "sed_mutant: a sed that exits non-zero fails"
runh sed_mutant "$H/nope" "$H/d14" 's/a/b/'
assert_neq "0" "$?" "sed_mutant: a missing source fails"
cp "$H/src" "$H/same"
runh sed_mutant "$H/same" "$H/same" 's/alpha/A/'
assert_neq "0" "$?" "sed_mutant: source and destination are the same path -> fails"
assert_eq "alpha
beta
gamma" "$(cat "$H/same")" "sed_mutant: the original file is intact after a same-path call"
ln -s "$H/same" "$H/same.lnk"
runh sed_mutant "$H/same" "$H/same.lnk" 's/alpha/A/'
assert_neq "0" "$?" "sed_mutant: a destination that is a symlink to the source -> fails"
assert_eq "alpha
beta
gamma" "$(cat "$H/same")" "sed_mutant: the original file is intact after a symlinked-destination call"
cp "$H/src" "$H/m1"
runh sed_mutate "$H/m1" 's/alpha/A/'
assert_eq "0" "$?" "sed_mutate: a hit passes"
runh sed_mutate "$H/m1" 's/zzz/y/'
assert_neq "0" "$?" "sed_mutate: a miss fails"
runh sed_mutate "$H/m1" -e 's/A/a/' -e 's/beta/B/'
assert_neq "0" "$?" "sed_mutate: more than one -e is refused"
runh sed_mutate "$H/m1" -E 's/(/x/'
assert_neq "0" "$?" "sed_mutate: a sed that exits non-zero fails"
runh sed_mutate "$H/m1" 's/a/b/s/b/c/'
assert_neq "0" "$?" "sed_mutate: an illegal s/a/b/s/b/c/ is refused"

finalize_test
