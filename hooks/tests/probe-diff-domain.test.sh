#!/usr/bin/env bash
# probe-diff-domain.sh integration test — weighted domain probing from robust git numstat.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/probe-diff-domain.sh"

json_value() {
  local json="$1" key="$2"
  node -e 'const fs=require("fs");const key=process.argv[1];const data=fs.readFileSync(0,"utf8").trim();if(!data){process.exit(0);}const obj=JSON.parse(data);process.stdout.write(obj[key] === undefined ? "" : String(obj[key]));' "$key" <<< "$json"
}
json_str() {
  json_value "$1" "$2"
}
json_num() {
  json_value "$1" "$2"
}
json_float() {
  json_value "$1" "$2"
}

run_probe() {
  (cd "$SBX" && bash "$SCRIPT" "$@")
}

# 1. --help
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "$HELP_EXIT" "0" "--help exits 0"
assert_contains "$HELP_OUT" "probe-diff-domain.sh" "--help explains the script"

# 2. invalid --domain
ERR_OUT="$(bash "$SCRIPT" --domain nope 2>&1)"; ERR_EXIT=$?
assert_eq "$ERR_EXIT" "2" "--domain invalid returns usage exit 2"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b main
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t

commit_head() {
  local label="$1"
  git -C "$SBX" add -A
  git -C "$SBX" commit -q -m "$label"
  git -C "$SBX" rev-parse HEAD
}

echo "seed for rename test" > "$SBX/Makefile"
BASE="$(commit_head base)"

# 3. -z parser + rename-by-new-path classification:
#    old file has no extension (unclassified), new path is .rs (must be rust).
mv "$SBX/Makefile" "$SBX/renamed.rs"
printf "added line after rename\n" >> "$SBX/renamed.rs"
R1="$(commit_head rename-to-rust)"
OUT="$(run_probe range "$BASE..$R1")"
assert_eq "$(json_str "$OUT" work_domain)" "rust" "rename is classified by the new path"
assert_eq "$(json_num "$OUT" weight_classified)" "2" "classed rename counts by classifier-aware parse"

# 4. tab and newline paths in NUL-delimited parse:
TAB_PATH=$'tab\tname.rs'
NL_PATH=$'nl\nline.ts'
printf "tab-path body\n" > "$SBX/$TAB_PATH"
printf "newline-path body\n" > "$SBX/$NL_PATH"
R2="$(commit_head tab-newline-nul-paths)"
OUT="$(run_probe range "$R1..$R2")"
assert_eq "$(json_num "$OUT" weight_classified)" "2" "tab/newline filenames are still parsed and counted"
assert_eq "$(json_str "$OUT" work_domain)" "mixed" "backend+frontend at 50/50 is mixed"
assert_eq "$(json_float "$OUT" dominant_share)" "0.5" "exact 50/50 gives 0.5"

# 5. binary row semantics and deletions included:
printf "first\ntwo\n" > "$SBX/drop-doc.md"
printf '\x00\x01\x02\x03' > "$SBX/bin.bin"
R3="$(commit_head binary-and-doc-delete)"
rm "$SBX/drop-doc.md"
R4="$(commit_head delete-doc)"
OUT="$(run_probe range "$R3..$R4")"
assert_eq "$(json_str "$OUT" work_domain)" "docs" "deletions remain classified and included"
assert_eq "$(json_num "$OUT" weight_classified)" "2" "deleted docs are counted in classified weight"

# 6. excludes are honored and CHANGELOG* is NOT excluded:
mkdir -p "$SBX/dist" "$SBX/src/dist" "$SBX/build" "$SBX/src/build" "$SBX/vendor" "$SBX/src/vendor" "$SBX/node_modules" "$SBX/src/node_modules"
printf "a\n" > "$SBX/CHANGELOG.md"
printf "a\n" > "$SBX/CHANGELOG.txt"
printf "b\n" > "$SBX/dist/bundle.js"
printf "c\n" > "$SBX/src/dist/widget.js"
printf "d\n" > "$SBX/build/script.js"
printf "e\n" > "$SBX/src/build/script.js"
printf "f\n" > "$SBX/vendor/lib.js"
printf "g\n" > "$SBX/src/vendor/lib.js"
printf "h\n" > "$SBX/node_modules/lib.js"
printf "i\n" > "$SBX/src/node_modules/lib.js"
printf "j\n" > "$SBX/package-lock.json"
printf "k\n" > "$SBX/foo.min.js"
printf "l\n" > "$SBX/foo.min.css"
printf "m\n" > "$SBX/pnpm-lock.yaml"
printf "n\n" > "$SBX/Cargo.lock"
printf "o\n" > "$SBX/go.sum"
printf "p\n" > "$SBX/temp.generated.txt"
printf "q\n" > "$SBX/model.pb.go"
printf "r\n" > "$SBX/model_pb2.py"
R5="$(commit_head exclude-and-changelog)"
OUT="$(run_probe range "$R4..$R5")"
assert_eq "$(json_num "$OUT" weight_classified)" "2" "CHANGELOG.md/CHANGELOG.txt remain classified docs"
assert_eq "$(json_str "$OUT" work_domain)" "docs" "CHANGELOG changes make docs dominant"
assert_eq "$(json_str "$OUT" confidence)" "low" "exclude-heavy signal lowers confidence"

# 7. tie / dominance / vendored-bundle dominated => mixed + low-confidence:
printf "line\nline\nline\nline\n" > "$SBX/src/main.rs"
printf "line\nline\nline\nline\n" > "$SBX/src/main.ts"
{ for _ in 1 2 3 4 5 6 7 8 9 10; do echo "bundle-$_"; done; } > "$SBX/dist/large.js"
{ for _ in 1 2 3 4 5 6 7 8 9 10; do echo "bundle-$_"; done; } >> "$SBX/dist/large.js"
{ for _ in 1 2 3 4 5 6 7 8 9 10; do echo "bundle-$_"; done; } >> "$SBX/dist/large.js"
{ for _ in 1 2 3 4 5 6 7 8 9 10; do echo "bundle-$_"; done; } >> "$SBX/dist/large.js"
{ for _ in 1 2 3 4 5 6 7 8 9 10; do echo "bundle-$_"; done; } >> "$SBX/dist/large.js"
R6="$(commit_head ties-and-vendored-dominance)"
OUT="$(run_probe range "$R5..$R6")"
assert_eq "$(json_str "$OUT" work_domain)" "mixed" "exact 50/50 backend/ frontend is mixed"
assert_eq "$(json_float "$OUT" dominant_share)" "0.5" "dominant share is exact 0.5"
assert_eq "$(json_str "$OUT" confidence)" "low" "excluded dominates => low confidence"

# 8. unclassified (no extension) is unclassified and lowers confidence:
printf "A\nA\nA\n" > "$SBX/Dockerfile"
printf "docs\n" > "$SBX/doc.txt"
R7="$(commit_head unclassified-matches)"
OUT="$(run_probe range "$R6..$R7")"
assert_eq "$(json_num "$OUT" weight_unclassified)" "3" "no-extension file is unclassified"
assert_eq "$(json_str "$OUT" confidence)" "low" "unclassified + docs -> low confidence"
assert_eq "$(json_str "$OUT" work_domain)" "docs" "one docs line still keeps docs dominant"

# 9. classified weight zero (non-empty excluded-only change) -> mixed, dominant_share 0
printf "append\n" >> "$SBX/dist/large.js"
R8="$(commit_head excluded-only)"
OUT="$(run_probe range "$R7..$R8")"
assert_eq "$(json_num "$OUT" weight_classified)" "0" "excluded-only change keeps weight_classified 0"
assert_eq "$(json_str "$OUT" work_domain)" "mixed" "zero classified-weight is mixed"
assert_eq "$(json_num "$OUT" dominant_share)" "0" "dominant_share is 0 with no classified signal"

# 10. empty diff (explicit same SHA):
EMPTY_OUT="$(run_probe range "$R8..$R8")"
assert_eq "$(json_str "$EMPTY_OUT" work_domain)" "mixed" "empty diff is mixed"
assert_eq "$(json_num "$EMPTY_OUT" weight_classified)" "0" "empty diff gives no classified weight"
assert_eq "$(json_num "$EMPTY_OUT" dominant_share)" "0" "empty diff gives dominant_share 0"

finalize_test
