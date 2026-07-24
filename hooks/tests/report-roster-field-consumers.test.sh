#!/usr/bin/env bash
# report-roster-field-consumers.test.sh — oracle for the advisory roster-field report.
#
# Table-driven over a SYNTHETIC fixture repo, so nothing depends on the live tree's
# contents. The positive cases come first deliberately: a suite made only of negatives
# would be passed by an implementation that classified every occurrence as unmatched.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/report-roster-field-consumers.js"
assert_file_exists "$SCRIPT" "report script exists"

# --- fixture builder --------------------------------------------------------
# make_fixture <dir> <field>...  → a git repo with the seven scan roots and a schema
# whose `required` names exactly the given fields.
make_fixture() {
  local dir="$1"; shift
  mkdir -p "$dir"/{src,scripts,skills,hooks,references,bin,agents,schemas}
  local req="" f
  for f in "$@"; do req="${req:+$req, }\"$f\""; done
  printf '{ "required": [%s], "properties": {} }\n' "$req" > "$dir/schemas/review-loop-contract.schema.json"
  git -C "$dir" init -q 2>/dev/null
  git -C "$dir" config user.email t@t.invalid
  git -C "$dir" config user.name t
}

commit_fixture() {
  git -C "$1" add -A 2>/dev/null
  git -C "$1" -c core.hooksPath=/dev/null commit -qm f 2>/dev/null
}

# bucket_of <fixture> <field> → the reported bucket
bucket_of() {
  node "$SCRIPT" "$1" --json 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
        const o=JSON.parse(d);const s=o.summary.find(x=>x.field===process.argv[1]);
        console.log(s?s.bucket:"MISSING")})' "$2"
}

# ---------------------------------------------------------------------------
# 1. POSITIVE ORACLE — one case per access shape (the plan's §1a enumeration, ten).
#    Without these, a report that never matches anything passes the whole suite.
# ---------------------------------------------------------------------------
shape_case() { # <n> <line-content> <ext>
  local n="$1" content="$2" ext="$3"
  local d="$TEST_TMP/shape$n"
  make_fixture "$d" probe_field
  printf '%s\n' "$content" > "$d/scripts/consumer$ext"
  commit_fixture "$d"
  assert_eq "code-match" "$(bucket_of "$d" probe_field)" "access shape $n counts: $content"
}

shape_case 1  'const v = roster.probe_field;'                    .js
shape_case 2  'const v = roster["probe_field"];'                 .js
shape_case 3  'const key = "probe_field";'                       .js
shape_case 4  'echo "$PROBE_FIELD"'                              .sh
shape_case 5  'PROBE_FIELD=1'                                    .sh
shape_case 6  'probe_field=1'                                    .sh
shape_case 7  'echo "${probe_field}"'                            .sh
shape_case 8  'resolve-review-loop.sh --field probe_field'       .sh
shape_case 9  'v=$(read_review_loop_field probe_field)'          .sh
shape_case 10 '  probe_field) echo hit ;;'                       .sh

# ---------------------------------------------------------------------------
# 2. POSITIVE — every executable extension in the contract is honoured.
# ---------------------------------------------------------------------------
for ext in .js .mjs .cjs .ts .sh .bash .py; do
  d="$TEST_TMP/ext${ext//./_}"
  make_fixture "$d" probe_field
  printf 'x = obj.probe_field\n' > "$d/src/consumer$ext"
  commit_fixture "$d"
  assert_eq "code-match" "$(bucket_of "$d" probe_field)" "executable extension $ext is scanned"
done

# ---------------------------------------------------------------------------
# 3. POSITIVE — sites are reported, not merely counted.
# ---------------------------------------------------------------------------
d="$TEST_TMP/sites"; make_fixture "$d" probe_field
printf '\n\nconst v = roster.probe_field;\n' > "$d/bin/tool.js"
commit_fixture "$d"
sites=$(node "$SCRIPT" "$d" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
  console.log(JSON.parse(s).summary[0].access_sites.join(","))})')
assert_eq "bin/tool.js:3" "$sites" "reported site carries the exact file:line"

# ---------------------------------------------------------------------------
# 4. QUANTITATIVE — exact counts, not merely non-zero. A report that recorded 1
#    for every non-empty category would pass a presence-only suite.
# ---------------------------------------------------------------------------
d="$TEST_TMP/counts"; make_fixture "$d" probe_field
cat > "$d/scripts/mixed.js" <<'EOF'
const a = roster.probe_field;
const b = roster.probe_field;
// probe_field mentioned in a comment
const note = 'see probe_field docs';
EOF
printf 'Use `probe_field` when reviewing.\n' > "$d/skills/rule.md"
commit_fixture "$d"
read -r acc inc sk <<<"$(node "$SCRIPT" "$d" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
  const x=JSON.parse(s).summary[0];console.log(x.access_shaped,x.incidental,x.skills)})')"
assert_eq "2" "$acc" "exact access count: the two property reads only"
assert_eq "2" "$inc" "exact incidental count: the comment line AND the bare word inside a longer string"
assert_eq "1" "$sk"  "exact skills count"

# ---------------------------------------------------------------------------
# 5. NEGATIVE — a bare word in an executable file is incidental, not a match.
# ---------------------------------------------------------------------------
d="$TEST_TMP/bare"; make_fixture "$d" probe_field
printf 'console.log(1); // nothing\nlet t = probe_field_other;\nlet u = 1; /* probe_field */\n' > "$d/src/x.js"
printf 'the probe_field appears bare here\n' >> "$d/src/x.js"
commit_fixture "$d"
assert_eq "no-detected-modeled-match" "$(bucket_of "$d" probe_field)" "bare word in executable is not access-shaped"

# ---------------------------------------------------------------------------
# 6. NEGATIVE — comment-only executable match does not count.
# ---------------------------------------------------------------------------
d="$TEST_TMP/comment"; make_fixture "$d" probe_field
printf '// const v = roster.probe_field;\n#  roster.probe_field\n' > "$d/scripts/c.sh"
commit_fixture "$d"
assert_eq "no-detected-modeled-match" "$(bucket_of "$d" probe_field)" "comment-only match does not count"

# ---------------------------------------------------------------------------
# 7. EXCLUSIONS — only the families that can hold an otherwise-counting match are
#    testable. platforms/, docs/, evals/, CHANGELOG.md, CLAUDE.md and the config
#    template already sit outside the scan roots, so they cannot host one; those are
#    scan-boundary cases (case 8), not exclusion cases.
# ---------------------------------------------------------------------------
for excl in scripts/resolve-review-loop.sh src/engine/resolve-review-loop.js scripts/check-contract-schema.js hooks/tests/t.sh; do
  d="$TEST_TMP/excl$(echo "$excl" | tr '/.' '__')"
  make_fixture "$d" probe_field
  mkdir -p "$d/$(dirname "$excl")"
  printf 'const v = roster.probe_field;\n' > "$d/$excl"
  commit_fixture "$d"
  assert_eq "no-detected-modeled-match" "$(bucket_of "$d" probe_field)" "excluded path does not count: $excl"
done

# ---------------------------------------------------------------------------
# 8. SCAN-ROOT LIMIT — a would-otherwise-count match outside the seven roots.
# ---------------------------------------------------------------------------
d="$TEST_TMP/outside"; make_fixture "$d" probe_field
mkdir -p "$d/platforms/codex"
printf 'const v = roster.probe_field;\n' > "$d/platforms/codex/mirror.js"
printf 'const v = roster.probe_field;\n' > "$d/toplevel.js"
commit_fixture "$d"
assert_eq "no-detected-modeled-match" "$(bucket_of "$d" probe_field)" "match outside the seven scan roots does not count"

# ---------------------------------------------------------------------------
# 9. SKILLS BUCKET — a skills/** match with no executable match.
# ---------------------------------------------------------------------------
d="$TEST_TMP/skills"; make_fixture "$d" probe_field
printf 'When `probe_field` is on, do the thing.\n' > "$d/skills/rule.md"
commit_fixture "$d"
assert_eq "skills-match" "$(bucket_of "$d" probe_field)" "skills/** match lands in the skills bucket"

# ---------------------------------------------------------------------------
# 10. JSON shape — one entry per field in the fixture schema's required array.
# ---------------------------------------------------------------------------
d="$TEST_TMP/json"; make_fixture "$d" alpha_field beta_field gamma_field
printf 'const v = roster.alpha_field;\n' > "$d/src/a.js"
commit_fixture "$d"
n=$(node "$SCRIPT" "$d" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
  console.log(JSON.parse(s).summary.length)})')
assert_eq "3" "$n" "--json emits exactly one entry per required field"

# ---------------------------------------------------------------------------
# 11. ADVISORY, NOT GATE — non-zero findings still exit 0.
# ---------------------------------------------------------------------------
node "$SCRIPT" "$d" >/dev/null 2>&1
assert_exit_code 0 $? "exit stays 0 with a non-empty no-detected-match bucket"

# ---------------------------------------------------------------------------
# 12. REPORT HEALTH — a broken run must be loud, not a silent clean sheet.
# ---------------------------------------------------------------------------
d="$TEST_TMP/broken"; make_fixture "$d" probe_field
printf 'this is not json\n' > "$d/schemas/review-loop-contract.schema.json"
commit_fixture "$d"
out=$(node "$SCRIPT" "$d" 2>"$TEST_TMP/health.err"); rc=$?
assert_exit_code 2 $rc "unparseable schema exits 2"
assert_contains "$(cat "$TEST_TMP/health.err")" "REPORT-HEALTH: FAILED" "health failure is announced on stderr"
assert_eq "" "$out" "health failure emits no table on stdout"

d="$TEST_TMP/noschema"; mkdir -p "$d"; git -C "$d" init -q
out=$(node "$SCRIPT" "$d" 2>"$TEST_TMP/health2.err"); rc=$?
assert_exit_code 2 $rc "missing schema exits 2"
assert_contains "$(cat "$TEST_TMP/health2.err")" "REPORT-HEALTH: FAILED" "missing schema is announced"

# ---------------------------------------------------------------------------
# 13. REAL REPO — runs clean on the live tree.
# ---------------------------------------------------------------------------
node "$SCRIPT" "$REPO_ROOT" >/dev/null 2>&1
assert_exit_code 0 $? "report runs on the real repo and exits 0"

finalize_test
