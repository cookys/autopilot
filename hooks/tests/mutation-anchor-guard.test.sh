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
finalize_test
