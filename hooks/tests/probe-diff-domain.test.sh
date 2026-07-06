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

# 11. round-2 reviewer 🔴 REGRESSION — rename whose NEW path itself looks like a
#     numstat counts record ("1<tab>2<tab>x"). A heuristic boundary parser
#     reinterprets that NUL path field as a phantom "1 added, 2 deleted" record and
#     inflates/desyncs; the deterministic parser must treat it purely as a path.
git -C "$SBX" commit -q --allow-empty -m mark-rename-lookalike
printf 'fn z(){}\n' > "$SBX/lookalike.rs"
R9="$(commit_head add-lookalike-src)"
git -C "$SBX" mv "lookalike.rs" "$(printf '1\t2\tmoved.rs')"
R10="$(commit_head rename-to-counts-lookalike)"
OUT="$(run_probe range "$R9..$R10")"
assert_eq "$(json_num "$OUT" weight_classified)" "0" "pure rename to a tab-counts-lookalike path adds ZERO weight (no phantom record)"
assert_eq "$(json_str "$OUT" work_domain)" "mixed" "zero-weight rename is mixed, not inflated"

# 12. rename to a tab-bearing NEW path WITH a content delta classifies by the new
#     path (NUL path field with embedded tabs parsed whole, not split on the tab).
git -C "$SBX" mv "$(printf '1\t2\tmoved.rs')" "$(printf 'a\tb.py')"
printf 'def y(): pass\nextra\n' >> "$SBX/$(printf 'a\tb.py')"
R11="$(commit_head rename-tabpath-with-delta)"
OUT="$(run_probe range "$R10..$R11")"
assert_eq "$(json_str "$OUT" work_domain)" "backend-cli" "tab-bearing new path .py classifies backend-cli by NEW path"

# 13. round-2 reviewer 🟡 — COPY record parse lock via WEIGHT CONSERVATION. `-M -C`
#     may emit a copy record (counts + old + NEW NUL fields — same wire shape as a
#     rename) for an identical-content new file when the source is touched in the same
#     commit; the destination carries a tab to also exercise NUL-path parsing on the
#     copy path. git's copy-vs-add choice (and a pure copy's 0/0 counts) is not
#     portable, so we assert the DETERMINISTIC invariant that holds either way: the
#     probe's total accounted weight equals an INDEPENDENT git numstat sum — catching
#     both the round-1 phantom-inflation 🔴 and any dropped record, for whatever git emits.
printf 'def shared():\n    return 1\n    # padding\n    # padding\n' > "$SBX/shared.py"
R12="$(commit_head add-copy-source)"
cp "$SBX/shared.py" "$SBX/$(printf 'cp\tied.rs')"     # identical-content copy to a tab-bearing .rs path
printf '    # touch source\n' >> "$SBX/shared.py"      # touch source so -C can attribute the copy
R13="$(commit_head copy-to-tab-rs)"
OUT="$(run_probe range "$R12..$R13")"
GIT_TOTAL="$(cd "$SBX" && git diff --numstat -M -C "$R12..$R13" | awk -F'\t' '{a=($1=="-")?0:$1; d=($2=="-")?0:$2; s+=a+d} END{print s+0}')"
PROBE_TOTAL=$(( $(json_num "$OUT" weight_classified) + $(json_num "$OUT" weight_excluded) + $(json_num "$OUT" weight_unclassified) ))
assert_eq "$PROBE_TOTAL" "$GIT_TOTAL" "copy/rename record parse conserves total weight (no phantom inflation, no dropped record)"

finalize_test
