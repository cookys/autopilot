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
# 4) helpers check EVERY command, report sed failures and bad destinations.
H="$TEST_TMP/h2"; mkdir -p "$H"
printf 'alpha\nbeta\ngamma\n' > "$H/src"
runh() { ( . "$REPO_ROOT/hooks/tests/lib.sh"; "$@" ) >"$H/out" 2>&1; }
runh sed_mutant "$H/src" "$H/d1" -e 's/alpha/A/' -e 's/beta/B/'
assert_eq "0" "$?" "sed_mutant: two -e that both hit pass"
runh sed_mutant "$H/src" "$H/d2" -e 's/alpha/A/' -e 's/nothere/B/'
assert_neq "0" "$?" "sed_mutant: a second -e that misses fails even though the first hit"
assert_contains "$(cat "$H/out")" "nothere" "sed_mutant: the failure names the expression that missed"
runh sed_mutant "$H/src" "$H/d3" 's/alpha/A/; s/nothere/B/'
assert_neq "0" "$?" "sed_mutant: a ';'-joined second command that misses fails"
runh sed_mutant "$H/src" "$H/d4" 's/alpha/A/
s/nothere/B/'
assert_neq "0" "$?" "sed_mutant: a newline-separated second command that misses fails"
runh sed_mutant "$H/src" "$H/d5" -e '/beta/d' -e '/nomatch/d'
assert_neq "0" "$?" "sed_mutant: a /re/d command that matches nothing fails"
runh sed_mutant "$H/src" "$H/d6" -e '/beta/d' -e '2i inserted'
assert_eq "0" "$?" "sed_mutant: d and i commands that both change the file pass"
runh sed_mutant "$H/src" "$H/d7" -E 's/(/x/'
assert_neq "0" "$?" "sed_mutant: a sed that exits non-zero fails (not read as 'changed')"
runh sed_mutant "$H/nope" "$H/d8" 's/a/b/'
assert_neq "0" "$?" "sed_mutant: a missing source fails"
runh sed_mutant "$H/src" "$H/d9" -e 's/alpha/X/' -e 's/X/alpha/'
assert_neq "0" "$?" "sed_mutant: commands that cancel out (dest identical to src) fail"
cp "$H/src" "$H/m1"
runh sed_mutate "$H/m1" -e 's/alpha/A/' -e 's/zzz/B/'
assert_neq "0" "$?" "sed_mutate: a later -e that misses fails"
cp "$H/src" "$H/m2"
runh sed_mutate "$H/m2" -E 's/(/x/'
assert_neq "0" "$?" "sed_mutate: a sed that exits non-zero fails"
cp "$H/src" "$H/m3"
runh sed_mutate "$H/m3" -e 's/alpha/A/;s/beta/B/' -e '$d'
assert_eq "0" "$?" "sed_mutate: all commands hit, including \$d"
assert_eq "A
B" "$(cat "$H/m3")" "sed_mutate: commands were applied in order"

finalize_test
