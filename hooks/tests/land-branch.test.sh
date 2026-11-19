#!/usr/bin/env bash
# scripts/land-branch.js — one command merges a reviewed branch and prints one JSON line.
# Each case is a throwaway clone of a local bare remote. No real remote is contacted.
. "$(dirname "$0")/lib.sh"
# This sandbox exports an empty GIT_ALLOW_PROTOCOL plus protocol.allow=never. Fixture
# remotes are local bare repos; drop that lockdown so the fixture can fetch and push.
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0

SCRIPT="$REPO_ROOT/scripts/land-branch.js"
if [ ! -f "$SCRIPT" ]; then
  echo "FAIL [$TEST_NAME] scripts/land-branch.js does not exist" >&2
  exit 1
fi

FLEET_ID="01M7HT6Y73KP3QADS18HYCRMEK"
BODY="$TEST_TMP/body.txt"
printf '%s\n' 'land the reviewed branch' '' 'Second paragraph stays in the message.' > "$BODY"
OK_SUITE="$TEST_TMP/ok-suite.sh"
FAIL_SUITE="$TEST_TMP/fail-suite.sh"
OK_CHECK="$TEST_TMP/ok-check.sh"
FAIL_CHECK="$TEST_TMP/fail-check.sh"
printf '%s\n' '#!/bin/bash' 'printf "rc=0 ok.test.sh\n"' 'exit 0' > "$OK_SUITE"
printf '%s\n' '#!/bin/bash' 'printf "rc=1 x.test.sh\n"' 'exit 1' > "$FAIL_SUITE"
printf '%s\n' '#!/bin/bash' 'exit 0' > "$OK_CHECK"
printf '%s\n' '#!/bin/bash' 'echo check-boom >&2' 'exit 1' > "$FAIL_CHECK"
chmod +x "$OK_SUITE" "$FAIL_SUITE" "$OK_CHECK" "$FAIL_CHECK"

argv_json() { node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$@"; }
checks_json() { node -e 'process.stdout.write(JSON.stringify([process.argv.slice(1)]))' "$@"; }
OK_SUITES_JSON="$(argv_json "$OK_SUITE")"
FAIL_SUITES_JSON="$(argv_json "$FAIL_SUITE")"
OK_CHECKS_JSON="$(checks_json "$OK_CHECK")"
FAIL_CHECKS_JSON="$(checks_json "$FAIL_CHECK")"

reset_env() { unset LAND_SUITES_CMD LAND_CHECK_CMDS; }
write_review() { # $1 path $2 verdict
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({verdict:process.argv[2], model:"grok-4.7", runner:"test-runner"}));' "$1" "$2"
}

# make_repo <label> — bare remote + clone, develop pushed, feat/land one commit ahead, clone left on develop.
make_repo() {
  local label="$1"
  BARE="$TEST_TMP/$label.git"
  WORK="$TEST_TMP/$label"
  git init -q --bare "$BARE"
  git clone -q "$BARE" "$WORK" 2>/dev/null
  git -C "$WORK" checkout -q -b develop
  printf 'base\n' > "$WORK/a.txt"
  git -C "$WORK" add a.txt
  git -C "$WORK" commit -qm base
  git -C "$WORK" push -q -u origin develop
  git -C "$WORK" checkout -q -b feat/land
  printf 'feature\n' > "$WORK/b.txt"
  git -C "$WORK" add b.txt
  git -C "$WORK" commit -qm feature
  FEAT_SHA="$(git -C "$WORK" rev-parse HEAD)"
  git -C "$WORK" checkout -q develop
  BASE_SHA="$(git -C "$WORK" rev-parse HEAD)"
}

run_land() {
  local work="$1"
  shift
  local out="$TEST_TMP/land.out" err="$TEST_TMP/land.err"
  (
    cd "$work" || exit 99
    if [ -n "${LAND_SUITES_CMD+x}" ]; then export LAND_BRANCH_SUITES_CMD="$LAND_SUITES_CMD"; else unset LAND_BRANCH_SUITES_CMD; fi
    if [ -n "${LAND_CHECK_CMDS+x}" ]; then export LAND_BRANCH_CHECK_CMDS="$LAND_CHECK_CMDS"; else unset LAND_BRANCH_CHECK_CMDS; fi
    env -u AUTOPILOT_SESSION_ID node "$SCRIPT" "$@"
  ) >"$out" 2>"$err"
  LAND_RC=$?
  LAND_OUT="$(cat "$out")"
  LAND_ERR="$(cat "$err")"
}

jfield() { node -e 'const j=JSON.parse(process.argv[1]); const v=j[process.argv[2]]; process.stdout.write(v==null?"":(typeof v==="string"?v:JSON.stringify(v)))' "$LAND_OUT" "$1"; }

assert_one_json_line() {
  local n line
  n="$(printf '%s\n' "$LAND_OUT" | grep -c .)"
  assert_eq "$n" "1" "$1: exactly one stdout line"
  node -e 'JSON.parse(process.argv[1])' "$LAND_OUT" >/dev/null || fail "$1: stdout is not JSON"
  if [ -n "$LAND_ERR" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in
        reap:*) ;;
        stage-event:*) ;;
        *) fail "$1: unexpected stderr: $line" ;;
      esac
    done <<< "$LAND_ERR"
  fi
}

# has_branch <repo> <name> -> 0 when refs/heads/<name> exists
has_branch() { git -C "$1" show-ref --verify --quiet "refs/heads/$2"; }
# worktree_listed <repo> <path> -> 0 when git worktree list contains that path
worktree_listed() { git -C "$1" worktree list --porcelain | grep -qx "worktree $2"; }

assert_log() {
  local log
  log="$(jfield log)"
  assert_contains "$log" "${TMPDIR:-/tmp}/land-branch-" "$1: log path under TMPDIR with the land-branch prefix"
  assert_file_exists "$log" "$1: log file exists"
  if [ -s "$log" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$1: log is empty"
  fi
}

common_args() { # review file is $REVIEW
  printf '%s\n' --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1
}

# --- SHIP + green stubs + --push → landed, two parents, four trailers ---
reset_env
make_repo ship
REVIEW="$TEST_TMP/review-ship.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 2 --push
assert_one_json_line "ship"
assert_eq "$LAND_RC" "0" "ship exits 0"
assert_eq "$(jfield status)" "landed" "ship status landed"
assert_eq "$(jfield new_red)" "[]" "ship new_red empty"
assert_eq "$(jfield sha)" "$(git -C "$BARE" rev-parse develop)" "ship sha is remote develop"
assert_log "ship"
read -r _tip ship_p1 ship_p2 _extra <<<"$(git -C "$BARE" rev-list --parents -n 1 develop)"
assert_eq "${ship_p1:-}" "$BASE_SHA" "ship first parent is the pre-land develop"
assert_eq "${ship_p2:-}" "$FEAT_SHA" "ship second parent is the feature tip"
assert_eq "${_extra:-}" "" "ship merge commit has exactly two parents"
SUBJECT="$(git -C "$BARE" log -1 --format=%s develop)"
assert_eq "$SUBJECT" "Merge feat/land: land the reviewed branch" "ship subject"
BODY_MSG="$(git -C "$BARE" log -1 --format=%B develop)"
assert_contains "$BODY_MSG" "Second paragraph stays in the message." "ship keeps the body"
PARSED="$(printf '%s\n' "$BODY_MSG" | git interpret-trailers --parse)"
# The identity guard rejects a real address written in a test. Read the trailer
# the script stores; do not copy the address into this file.
COAUTHOR_LINE="$(grep -m 1 -o 'Co-Authored-By: [^"'"'"'`]*' "$SCRIPT")"
assert_neq "$COAUTHOR_LINE" "" "co-author trailer read from the script"
assert_eq "$PARSED" "$(printf '%s\n' "QC-Verdict: SHIP-AS-IS (grok-4.7)" "Review-Generation: 2" "Fleet-Task: $FLEET_ID" "$COAUTHOR_LINE")" "ship four trailers parse"

# --- NEEDS-WORK → review_not_ship, nothing merged ---
reset_env
make_repo needs
REVIEW="$TEST_TMP/review-needs.json"
write_review "$REVIEW" NEEDS-WORK
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "needs"
assert_neq "$LAND_RC" "0" "needs exits non-zero"
assert_eq "$(jfield status)" "review_not_ship" "needs status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "needs remote unchanged"
assert_eq "$(git -C "$WORK" rev-parse HEAD)" "$BEFORE" "needs local HEAD unchanged"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "needs work tree clean"

# --- conflict → conflict, work tree clean afterwards ---
reset_env
make_repo conflict
git -C "$WORK" checkout -q feat/land
printf 'branch-side\n' > "$WORK/a.txt"
git -C "$WORK" commit -qam 'branch edit'
git -C "$WORK" checkout -q develop
printf 'develop-side\n' > "$WORK/a.txt"
git -C "$WORK" commit -qam 'develop edit'
git -C "$WORK" push -q origin develop
REVIEW="$TEST_TMP/review-conflict.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "conflict"
assert_neq "$LAND_RC" "0" "conflict exits non-zero"
assert_eq "$(jfield status)" "conflict" "conflict status"
assert_eq "$(jfield conflicted)" '["a.txt"]' "conflict names a.txt"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "conflict work tree clean"
MERGE_HEAD="$(git -C "$WORK" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
assert_eq "$MERGE_HEAD" "" "conflict merge aborted"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "conflict remote unchanged"
assert_eq "$(cat "$WORK/a.txt")" "develop-side" "conflict restored develop side"

# --- failing suite → new_red; known-red listing it passes ---
reset_env
make_repo redsuite
REVIEW="$TEST_TMP/review-red.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$FAIL_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "new-red"
assert_neq "$LAND_RC" "0" "new-red exits non-zero"
assert_eq "$(jfield status)" "new_red" "new-red status"
assert_eq "$(jfield new_red)" '["x.test.sh"]' "new-red lists x.test.sh"
assert_eq "$(jfield checks)" '{}' "new-red stops before checks"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "new-red does not push"

reset_env
make_repo known
REVIEW="$TEST_TMP/review-known.json"
write_review "$REVIEW" SHIP-AS-IS
KNOWN="$TEST_TMP/known-red.txt"
printf '%s\n' 'x.test.sh' > "$KNOWN"
LAND_SUITES_CMD="$FAIL_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --known-red "$KNOWN" --push
assert_one_json_line "known-red"
assert_eq "$LAND_RC" "0" "known-red exits 0"
assert_eq "$(jfield status)" "landed" "known-red still lands"
assert_eq "$(jfield new_red)" "[]" "known-red is not new"
assert_eq "$(git -C "$BARE" rev-list --count --merges develop)" "1" "known-red pushed the merge"

# --- check stub exits 1 → check_failed, no push ---
reset_env
make_repo chk
REVIEW="$TEST_TMP/review-chk.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$FAIL_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "check"
assert_neq "$LAND_RC" "0" "check exits non-zero"
assert_eq "$(jfield status)" "check_failed" "check status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "check does not push"
assert_contains "$(jfield checks)" ':1' "check records rc 1"

# --- remote develop advanced after the merge → base_moved, no push of the merge ---
reset_env
make_repo moved
SIDE="$TEST_TMP/side-moved"
git clone -q "$BARE" "$SIDE"
git -C "$SIDE" checkout -q develop
ADVANCE="$TEST_TMP/advance.sh"
cat > "$ADVANCE" <<EOF
#!/bin/bash
git -C "$SIDE" commit --allow-empty -qm advance
git -C "$SIDE" push -q origin develop
EOF
chmod +x "$ADVANCE"
REVIEW="$TEST_TMP/review-moved.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$(checks_json "$ADVANCE")"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "moved"
assert_neq "$LAND_RC" "0" "moved exits non-zero"
assert_eq "$(jfield status)" "base_moved" "moved status"
assert_eq "$(git -C "$BARE" log -1 --format=%s develop)" "advance" "moved remote tip is the other commit"
assert_eq "$(git -C "$BARE" rev-list --parents -n 1 develop | wc -w | tr -d ' ')" "2" "moved remote tip is not a merge"
assert_neq "$(git -C "$BARE" rev-parse develop)" "$(jfield sha)" "moved did not push the merge sha"

# --- without --push → merged_not_pushed, remote unchanged ---
reset_env
make_repo npush
REVIEW="$TEST_TMP/review-npush.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1
assert_one_json_line "no-push"
assert_eq "$LAND_RC" "0" "no-push exits 0"
assert_eq "$(jfield status)" "merged_not_pushed" "no-push status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "no-push remote unchanged"
assert_eq "$(git -C "$WORK" rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')" "3" "no-push local HEAD is a merge"

# --- dirty work tree is refused before any merge ---
reset_env
make_repo dirty
printf 'dirty\n' >> "$WORK/a.txt"
REVIEW="$TEST_TMP/review-dirty.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "dirty"
assert_neq "$LAND_RC" "0" "dirty exits non-zero"
assert_eq "$(jfield status)" "dirty_worktree" "dirty status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "dirty remote unchanged"
assert_contains "$(git -C "$WORK" status --porcelain)" "a.txt" "dirty change still present"

# --- a clean merge that touches the hippo cache restores the base blob ---
reset_env
BARE="$TEST_TMP/hippo.git"
WORK="$TEST_TMP/hippo"
git init -q --bare "$BARE"
git clone -q "$BARE" "$WORK" 2>/dev/null
git -C "$WORK" checkout -q -b develop
printf 'base\n' > "$WORK/a.txt"
mkdir -p "$WORK/.hippo/.cache"
printf 'base-db' > "$WORK/.hippo/.cache/index.sqlite"
git -C "$WORK" add a.txt .hippo
git -C "$WORK" commit -qm base
git -C "$WORK" push -q -u origin develop
git -C "$WORK" checkout -q -b feat/land
printf 'branch-db' > "$WORK/.hippo/.cache/index.sqlite"
printf 'feature\n' > "$WORK/b.txt"
git -C "$WORK" add -A
git -C "$WORK" commit -qm feature
git -C "$WORK" checkout -q develop
REVIEW="$TEST_TMP/review-hippo.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "hippo"
assert_eq "$LAND_RC" "0" "hippo exits 0"
assert_eq "$(jfield status)" "landed" "hippo landed"
assert_eq "$(git -C "$BARE" show develop:.hippo/.cache/index.sqlite)" "base-db" "hippo cache restored from base"
assert_eq "$(git -C "$BARE" show develop:b.txt)" "feature" "hippo keeps the other feature file"

# --- both sides change the hippo cache with different binary bytes; nothing else conflicts ---
# The cache conflict is restored from the base ref and the land continues.
reset_env
BARE="$TEST_TMP/hippo-both.git"
WORK="$TEST_TMP/hippo-both"
git init -q --bare "$BARE"
git clone -q "$BARE" "$WORK" 2>/dev/null
git -C "$WORK" checkout -q -b develop
printf 'base\n' > "$WORK/a.txt"
mkdir -p "$WORK/.hippo/.cache"
printf 'anc\0v1' > "$WORK/.hippo/.cache/index.sqlite"
git -C "$WORK" add a.txt .hippo
git -C "$WORK" commit -qm base
git -C "$WORK" push -q -u origin develop
git -C "$WORK" checkout -q -b feat/land
printf 'branch\0v2' > "$WORK/.hippo/.cache/index.sqlite"
printf 'feature\n' > "$WORK/b.txt"
git -C "$WORK" add -A
git -C "$WORK" commit -qm feature
git -C "$WORK" checkout -q develop
printf 'base\0v3' > "$WORK/.hippo/.cache/index.sqlite"
git -C "$WORK" add -A
git -C "$WORK" commit -qm 'develop cache'
git -C "$WORK" push -q origin develop
BASE_BLOB="$(git -C "$WORK" rev-parse 'HEAD:.hippo/.cache/index.sqlite')"
BRANCH_BLOB="$(git -C "$WORK" rev-parse 'feat/land:.hippo/.cache/index.sqlite')"
assert_neq "$BRANCH_BLOB" "$BASE_BLOB" "hippo-both fixture blobs differ"
REVIEW="$TEST_TMP/review-hippo-both.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "hippo-both"
assert_eq "$LAND_RC" "0" "hippo-both exits 0"
assert_eq "$(jfield status)" "landed" "hippo-both landed"
assert_eq "$(git -C "$BARE" rev-parse 'develop:.hippo/.cache/index.sqlite')" "$BASE_BLOB" "hippo-both cache equals the base ref"
assert_eq "$(git -C "$BARE" show develop:b.txt)" "feature" "hippo-both keeps the feature file"

# --- the same binary cache conflict plus a real text conflict lists only the text file ---
reset_env
BARE="$TEST_TMP/hippo-text.git"
WORK="$TEST_TMP/hippo-text"
git init -q --bare "$BARE"
git clone -q "$BARE" "$WORK" 2>/dev/null
git -C "$WORK" checkout -q -b develop
printf 'base\n' > "$WORK/a.txt"
mkdir -p "$WORK/.hippo/.cache"
printf 'anc\0v1' > "$WORK/.hippo/.cache/index.sqlite"
git -C "$WORK" add a.txt .hippo
git -C "$WORK" commit -qm base
git -C "$WORK" push -q -u origin develop
git -C "$WORK" checkout -q -b feat/land
printf 'branch-side\n' > "$WORK/a.txt"
printf 'branch\0v2' > "$WORK/.hippo/.cache/index.sqlite"
printf 'feature\n' > "$WORK/b.txt"
git -C "$WORK" add -A
git -C "$WORK" commit -qm feature
git -C "$WORK" checkout -q develop
printf 'develop-side\n' > "$WORK/a.txt"
printf 'base\0v3' > "$WORK/.hippo/.cache/index.sqlite"
git -C "$WORK" add -A
git -C "$WORK" commit -qm 'develop both'
git -C "$WORK" push -q origin develop
REVIEW="$TEST_TMP/review-hippo-text.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "hippo-text"
assert_neq "$LAND_RC" "0" "hippo-text exits non-zero"
assert_eq "$(jfield status)" "conflict" "hippo-text status"
assert_eq "$(jfield conflicted)" '["a.txt"]' "hippo-text lists only a.txt"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "hippo-text work tree clean"
MERGE_HEAD="$(git -C "$WORK" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
assert_eq "$MERGE_HEAD" "" "hippo-text merge aborted"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "hippo-text remote unchanged"
assert_eq "$(cat "$WORK/a.txt")" "develop-side" "hippo-text restored the develop text"

# --- verdict null or missing → review_not_ship, exit 1, nothing merged ---
# Unparseable JSON and a non-object stay usage.
reset_env
make_repo nullverdict
BEFORE="$(git -C "$BARE" rev-parse develop)"
REVIEW="$TEST_TMP/review-null.json"
printf '%s\n' '{"verdict":null}' > "$REVIEW"
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "null-verdict"
assert_eq "$LAND_RC" "1" "null-verdict exits 1"
assert_eq "$(jfield status)" "review_not_ship" "null-verdict status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "null-verdict remote unchanged"
assert_eq "$(git -C "$WORK" rev-parse HEAD)" "$BEFORE" "null-verdict local HEAD unchanged"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "null-verdict work tree clean"

REVIEW="$TEST_TMP/review-empty.json"
printf '%s\n' '{}' > "$REVIEW"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "empty-verdict"
assert_eq "$LAND_RC" "1" "empty-verdict exits 1"
assert_eq "$(jfield status)" "review_not_ship" "empty-verdict status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "empty-verdict remote unchanged"
assert_eq "$(git -C "$WORK" rev-parse HEAD)" "$BEFORE" "empty-verdict local HEAD unchanged"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "empty-verdict work tree clean"

REVIEW="$TEST_TMP/review-bad.json"
printf '%s\n' '{not json' > "$REVIEW"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "bad-json"
assert_eq "$LAND_RC" "2" "bad-json exits 2"
assert_eq "$(jfield status)" "usage" "bad-json status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "bad-json remote unchanged"

REVIEW="$TEST_TMP/review-array.json"
printf '%s\n' '[]' > "$REVIEW"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "non-object"
assert_eq "$LAND_RC" "2" "non-object exits 2"
assert_eq "$(jfield status)" "usage" "non-object status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "non-object remote unchanged"

# --- --review-generation is required and must be a positive integer, before any git command ---
reset_env
make_repo genuse
REVIEW="$TEST_TMP/review-gen.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
BEFORE="$(git -C "$BARE" rev-parse develop)"
HEAD_BEFORE="$(git -C "$WORK" rev-parse HEAD)"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --push
assert_one_json_line "no-gen"
assert_eq "$LAND_RC" "2" "no-gen exits 2"
assert_eq "$(jfield status)" "usage" "no-gen status"
assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "no-gen nothing merged"
assert_eq "$(git -C "$WORK" rev-parse HEAD)" "$HEAD_BEFORE" "no-gen local HEAD unchanged"
assert_eq "$(git -C "$WORK" status --porcelain)" "" "no-gen work tree clean"
GEN_LOG="$(jfield log)"
assert_file_exists "$GEN_LOG" "no-gen log exists"
assert_not_contains "$(cat "$GEN_LOG")" "git " "no-gen runs no git command"
for bad in 0 -1 abc; do
  run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation "$bad" --push
  assert_one_json_line "gen-$bad"
  assert_eq "$LAND_RC" "2" "gen-$bad exits 2"
  assert_eq "$(jfield status)" "usage" "gen-$bad status"
  assert_eq "$(git -C "$BARE" rev-parse develop)" "$BEFORE" "gen-$bad nothing merged"
  assert_eq "$(git -C "$WORK" rev-parse HEAD)" "$HEAD_BEFORE" "gen-$bad local HEAD unchanged"
  GEN_LOG="$(jfield log)"
  assert_not_contains "$(cat "$GEN_LOG")" "git " "gen-$bad runs no git command"
done

# --- reap after a successful land: local branch and its worktree are gone ---
reset_env
make_repo reap_ok
WT_OK="$TEST_TMP/wt-reap-ok"
git -C "$WORK" worktree add -q "$WT_OK" feat/land
REVIEW="$TEST_TMP/review-reap-ok.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-ok"
assert_eq "$LAND_RC" "0" "reap-ok exits 0"
assert_eq "$(jfield status)" "landed" "reap-ok landed"
if has_branch "$WORK" feat/land; then fail "reap-ok local branch still present"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
if worktree_listed "$WORK" "$WT_OK"; then fail "reap-ok worktree still listed"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
assert_contains "$LAND_ERR" "reap:" "reap-ok prints a reap line"

# --- extra commit after the push, no worktree on the branch: -d keeps it ---
reset_env
make_repo reap_unmerged
REAL_GIT="$(command -v git)"
GIT_WRAP="$TEST_TMP/git-wrap-unmerged"
mkdir -p "$GIT_WRAP"
cat > "$GIT_WRAP/git" << EOF
#!/bin/bash
real="$REAL_GIT"
if [ "\$1" = "push" ]; then
  "\$real" "\$@"
  rc=\$?
  if [ \$rc -eq 0 ]; then
    tree=\$("\$real" rev-parse 'feat/land^{tree}')
    parent=\$("\$real" rev-parse refs/heads/feat/land)
    new=\$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com "\$real" commit-tree "\$tree" -p "\$parent" -m 'post-land extra')
    "\$real" update-ref refs/heads/feat/land "\$new"
  fi
  exit \$rc
fi
exec "\$real" "\$@"
EOF
chmod +x "$GIT_WRAP/git"
git -C "$WORK" config advice.forceDeleteBranch false
REVIEW="$TEST_TMP/review-reap-unmerged.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
PATH="$GIT_WRAP:$PATH" run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-unmerged"
assert_eq "$LAND_RC" "0" "reap-unmerged exits 0"
assert_eq "$(jfield status)" "landed" "reap-unmerged landed"
if has_branch "$WORK" feat/land; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-unmerged branch removed"; fi
if git -C "$WORK" worktree list --porcelain | grep -qx 'branch refs/heads/feat/land'; then fail "reap-unmerged worktree has the branch"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
assert_contains "$LAND_ERR" "reap: warning:" "reap-unmerged warning line"

# --- feat/land-2 worktree must not match a feat/land prefix ---
reset_env
make_repo reap_prefix
git -C "$WORK" branch feat/land-2 feat/land
WT_PREFIX="$TEST_TMP/wt-reap-prefix"
git -C "$WORK" worktree add -q "$WT_PREFIX" feat/land-2
REVIEW="$TEST_TMP/review-reap-prefix.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-prefix"
assert_eq "$LAND_RC" "0" "reap-prefix exits 0"
assert_eq "$(jfield status)" "landed" "reap-prefix landed"
if has_branch "$WORK" feat/land-2; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-prefix feat/land-2 branch removed"; fi
if worktree_listed "$WORK" "$WT_PREFIX"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-prefix feat/land-2 worktree removed"; fi
if has_branch "$WORK" feat/land; then fail "reap-prefix feat/land still present"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi

# --- failed merge leaves the branch and its worktree ---
reset_env
make_repo reap_conflict
WT_CONFLICT="$TEST_TMP/wt-reap-conflict"
git -C "$WORK" worktree add -q "$WT_CONFLICT" feat/land
printf 'branch-side\n' > "$WT_CONFLICT/a.txt"
git -C "$WT_CONFLICT" commit -qam 'branch edit'
printf 'develop-side\n' > "$WORK/a.txt"
git -C "$WORK" commit -qam 'develop edit'
git -C "$WORK" push -q origin develop
REVIEW="$TEST_TMP/review-reap-conflict.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-conflict"
assert_eq "$(jfield status)" "conflict" "reap-conflict status"
if has_branch "$WORK" feat/land; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-conflict branch removed"; fi
if worktree_listed "$WORK" "$WT_CONFLICT"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-conflict worktree removed"; fi
assert_eq "$LAND_ERR" "" "reap-conflict no reap stderr"

# --- push rejected leaves the branch and its worktree ---
reset_env
make_repo reap_push
WT_PUSH="$TEST_TMP/wt-reap-push"
git -C "$WORK" worktree add -q "$WT_PUSH" feat/land
printf '%s\n' '#!/bin/bash' 'exit 1' > "$BARE/hooks/pre-receive"
chmod +x "$BARE/hooks/pre-receive"
REVIEW="$TEST_TMP/review-reap-push.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-push"
assert_eq "$(jfield status)" "push_failed" "reap-push status"
if has_branch "$WORK" feat/land; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-push branch removed"; fi
if worktree_listed "$WORK" "$WT_PUSH"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-push worktree removed"; fi
assert_eq "$LAND_ERR" "" "reap-push no reap stderr"

# --- dirty linked worktree is preserved; landing still exits 0 ---
reset_env
make_repo reap_dirty
WT_DIRTY="$TEST_TMP/wt-reap-dirty"
git -C "$WORK" worktree add -q "$WT_DIRTY" feat/land
printf 'uncommitted\n' >> "$WT_DIRTY/a.txt"
REVIEW="$TEST_TMP/review-reap-dirty.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-dirty"
assert_eq "$LAND_RC" "0" "reap-dirty exits 0"
assert_eq "$(jfield status)" "landed" "reap-dirty landed"
if worktree_listed "$WORK" "$WT_DIRTY"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-dirty worktree removed"; fi
if has_branch "$WORK" feat/land; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-dirty branch removed"; fi
assert_contains "$(cat "$WT_DIRTY/a.txt")" "uncommitted" "reap-dirty file preserved"
assert_contains "$LAND_ERR" "warning" "reap-dirty warning line"

# --- --keep-branch removes nothing ---
reset_env
make_repo reap_keep
WT_KEEP="$TEST_TMP/wt-reap-keep"
git -C "$WORK" worktree add -q "$WT_KEEP" feat/land
REVIEW="$TEST_TMP/review-reap-keep.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push --keep-branch
assert_one_json_line "reap-keep"
assert_eq "$LAND_RC" "0" "reap-keep exits 0"
if has_branch "$WORK" feat/land; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-keep branch removed"; fi
if worktree_listed "$WORK" "$WT_KEEP"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-keep worktree removed"; fi

# --- --prune-remote deletes the remote branch; without the flag it stays ---
reset_env
make_repo reap_remote
git -C "$WORK" push -q origin feat/land
REVIEW="$TEST_TMP/review-reap-remote.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push --prune-remote
assert_one_json_line "reap-remote"
assert_eq "$LAND_RC" "0" "reap-remote exits 0"
REMOTE_LEFT="$(git -C "$WORK" ls-remote --heads origin feat/land)"
assert_eq "$REMOTE_LEFT" "" "reap-remote remote branch gone"

reset_env
make_repo reap_noremote
git -C "$WORK" push -q origin feat/land
REVIEW="$TEST_TMP/review-reap-noremote.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch feat/land --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-noremote"
assert_eq "$LAND_RC" "0" "reap-noremote exits 0"
assert_contains "$(git -C "$WORK" ls-remote --heads origin feat/land)" "refs/heads/feat/land" "reap-noremote remote branch stays"

# --- protected names and the merge target are not reaped ---
for protected in main master; do
  reset_env
  make_repo "reap_protect_${protected}"
  git -C "$WORK" branch -m feat/land "$protected"
  REVIEW="$TEST_TMP/review-reap-protect-${protected}.json"
  write_review "$REVIEW" SHIP-AS-IS
  LAND_SUITES_CMD="$OK_SUITES_JSON"
  LAND_CHECK_CMDS="$OK_CHECKS_JSON"
  run_land "$WORK" --branch "$protected" --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
  assert_one_json_line "reap-protect-$protected"
  assert_eq "$LAND_RC" "0" "reap-protect-$protected exits 0"
  assert_eq "$(jfield status)" "landed" "reap-protect-$protected landed"
  if has_branch "$WORK" "$protected"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-protect-$protected branch removed"; fi
  assert_contains "$LAND_ERR" "reap: warning:" "reap-protect-$protected warning line"
done

reset_env
make_repo reap_protect_develop
printf 'extra\n' >> "$WORK/a.txt"
git -C "$WORK" add a.txt
git -C "$WORK" commit -qm 'develop extra'
REVIEW="$TEST_TMP/review-reap-protect-develop.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch develop --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-protect-develop"
assert_eq "$LAND_RC" "0" "reap-protect-develop exits 0"
assert_eq "$(jfield status)" "landed" "reap-protect-develop landed"
if has_branch "$WORK" develop; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-protect-develop branch removed"; fi
assert_contains "$LAND_ERR" "reap: warning:" "reap-protect-develop warning line"

reset_env
make_repo reap_protect_target
git -C "$WORK" branch -m feat/land release
git -C "$WORK" push -q origin develop:release
REVIEW="$TEST_TMP/review-reap-protect-target.json"
write_review "$REVIEW" SHIP-AS-IS
LAND_SUITES_CMD="$OK_SUITES_JSON"
LAND_CHECK_CMDS="$OK_CHECKS_JSON"
run_land "$WORK" --branch release --base-ref origin/release --review-json "$REVIEW" --fleet-task "$FLEET_ID" --body-file "$BODY" --review-generation 1 --push
assert_one_json_line "reap-protect-target"
assert_eq "$LAND_RC" "0" "reap-protect-target exits 0"
assert_eq "$(jfield status)" "landed" "reap-protect-target landed"
if has_branch "$WORK" release; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap-protect-target branch removed"; fi
assert_contains "$LAND_ERR" "reap: warning:" "reap-protect-target warning line"

finalize_test
