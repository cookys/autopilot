#!/usr/bin/env bash
# hetero-review-loop.test.sh — contract test for scripts/hetero-review-loop.js
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/hetero-review-loop.js"

# ─── collect ───

# Set up scratch test environment
SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "c1"
  echo "second" > file.txt
  git add file.txt
  git commit -q -m "c2"
)

PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

# Add another commit on branch 'work' for diff tests
(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "work changes" >> file.txt
  git add file.txt
  git commit -q -m "c3"
)

mkdir -p "$TEST_TMP/bin"

# Stub dispatch-review.sh
cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$SIMULATE_HEAD_MOVE" ]; then
  # Append commit to scratch repo to move head
  echo "moved" >> "$REPO_FOR_TEST/file.txt"
  git -C "$REPO_FOR_TEST" commit -q -am "moved commit"
fi

if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi

if [ -n "$STUB_SEAT_RESPONSE" ]; then
  echo "$STUB_SEAT_RESPONSE"
  exit 0
fi

echo '{"status": "reviewed", "findings": ""}'
STUB_EOF
chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"

# Stub resolve-review-loop.sh
cat << 'RESOLVE_EOF' > "$TEST_TMP/bin/resolve-review-loop.sh"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then
  case "$2" in
    reviewer_engine) echo "x" ;;
    reviewer_runner) echo "agy" ;;
    reviewer_effort) echo "low" ;;
    reviewer_endpoint) echo "" ;;
    *) echo "" ;;
  esac
  exit 0
fi
echo '{"reviewer_engine": "x", "reviewer_runner": "agy", "reviewer_effort": "low", "reviewer_endpoint": "@none"}'
RESOLVE_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop.sh"

LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"

# Case 1: --help exits 0 and contains Usage:
HELP_OUT=$(node "$SCRIPT" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "case 1: --help exits 0"
assert_contains "$HELP_OUT" "Usage:" "case 1: --help outputs usage instructions"

# Case 2: generation 1 without --phase-base exits 2
C2_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p1 --generation 1 --branch work 2>&1); C2_RC=$?
assert_exit_code "$C2_RC" "2" "case 2: gen 1 without --phase-base exits 2"

# Case 3: generation 1 with three seats all reviewed exits 0, writes range.json, diff.txt, findings.json, chain.json
export STUB_SEAT_RESPONSE='{"status": "reviewed", "findings": "No issues found."}'
C3_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p1 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy,m3/high@grok" 2>&1); C3_RC=$?
assert_exit_code "$C3_RC" "0" "case 3: exits 0 on 3 reviewed seats"
assert_file_exists "$LEDGER/review-p1/g1/range.json" "case 3: range.json exists"
assert_file_exists "$LEDGER/review-p1/g1/diff.txt" "case 3: diff.txt exists"
assert_file_exists "$LEDGER/review-p1/g1/findings.json" "case 3: findings.json exists"
assert_file_exists "$LEDGER/review-p1/chain.json" "case 3: chain.json exists"
assert_contains "$(cat "$LEDGER/review-p1/chain.json")" '"status": "pending"' "case 3: chain entry status is pending"
assert_contains "$(cat "$LEDGER/review-p1/g1/findings.json")" '"findings": []' "case 3: findings array is empty"

# Case 4: a seat with findings text containing one Critical and one Major produces two entries with distinct ids
export STUB_SEAT_RESPONSE='{"status": "reviewed", "findings": "Critical: SQL injection vulnerability\nDetailed description here.\n\nMajor: Unhandled promise rejection\nMore details."}'
C4_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p4 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C4_RC=$?
assert_exit_code "$C4_RC" "0" "case 4: exits 0"
FINDINGS_C4=$(cat "$LEDGER/review-p4/g1/findings.json")
assert_contains "$FINDINGS_C4" '"severity": "Critical"' "case 4: has Critical finding"
assert_contains "$FINDINGS_C4" '"severity": "Major"' "case 4: has Major finding"
# Verify distinct IDs
ID1=$(node -e 'const f = JSON.parse(fs.readFileSync(process.argv[1])).findings; console.log(f[0].id);' "$LEDGER/review-p4/g1/findings.json")
ID2=$(node -e 'const f = JSON.parse(fs.readFileSync(process.argv[1])).findings; console.log(f[1].id);' "$LEDGER/review-p4/g1/findings.json")
[ "$ID1" != "$ID2" ]; ID_DIFF_RC=$?
assert_exit_code "$ID_DIFF_RC" "0" "case 4: finding IDs are distinct"

# Case 5: a seat returning {status: "no_verdict"} without --allow-seat-gap exits 1 and chain.json is not updated
export STUB_RESPONSE_s0='{"status": "reviewed", "findings": ""}'
export STUB_RESPONSE_s1='{"status": "no_verdict"}'
unset STUB_SEAT_RESPONSE
C5_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p5 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: exits 1 on gap without --allow-seat-gap"
assert_file_exists "$LEDGER/review-p5/g1/range.json" "case 5: range.json written before exit"
assert_file_exists "$LEDGER/review-p5/g1/seat-s1.json" "case 5: seat-s1.json written"
assert_file_absent "$LEDGER/review-p5/chain.json" "case 5: chain.json not written"
assert_file_absent "$LEDGER/review-p5/g1/findings.json" "case 5: findings.json not written"

# Case 6: same as (5) but with --allow-seat-gap exits 0 and chain.json has pending-with-gap
C6_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap 2>&1); C6_RC=$?
assert_exit_code "$C6_RC" "0" "case 6: exits 0 with --allow-seat-gap"
assert_file_exists "$LEDGER/review-p6/chain.json" "case 6: chain.json written"
assert_contains "$(cat "$LEDGER/review-p6/chain.json")" '"status": "pending-with-gap"' "case 6: status is pending-with-gap"

# Case 7: generation 2 with chain.json seeded with g1 head X uses X as base
mkdir -p "$LEDGER/review-p7"
SEED_BASE="$PHASE_BASE"
SEED_HEAD=$(git -C "$SCRATCH_REPO" rev-parse work~0)
cat << SEED_EOF > "$LEDGER/review-p7/chain.json"
[
  {
    "generation": 1,
    "base": "$SEED_BASE",
    "head": "$SEED_HEAD",
    "seats": ["s0"],
    "status": "pending"
  }
]
SEED_EOF
export STUB_SEAT_RESPONSE='{"status": "reviewed", "findings": ""}'
unset STUB_RESPONSE_s0
unset STUB_RESPONSE_s1
C7_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p7 --generation 2 --branch work --seats "m1/low@codex" 2>&1); C7_RC=$?
assert_exit_code "$C7_RC" "0" "case 7: exits 0 for gen 2"
RANGE_BASE=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).base);' "$LEDGER/review-p7/g2/range.json")
assert_eq "$RANGE_BASE" "$SEED_HEAD" "case 7: range.json base matches seeded head X"

# Case 8: generation 2 with chain.json missing generation-1 entry exits 1
mkdir -p "$LEDGER/review-p8"
echo "[]" > "$LEDGER/review-p8/chain.json"
C8_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p8 --generation 2 --branch work --seats "m1/low@codex" 2>&1); C8_RC=$?
assert_exit_code "$C8_RC" "1" "case 8: exits 1 when gen 1 entry missing"

# Case 9: simulate head moving between snapshot and seat-return
export REPO_FOR_TEST="$SCRATCH_REPO"
export SIMULATE_HEAD_MOVE=1
C9_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p9 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C9_RC=$?
assert_exit_code "$C9_RC" "1" "case 9: exits 1 on head change"
assert_file_absent "$LEDGER/review-p9/g1/findings.json" "case 9: no findings.json written"
assert_contains "$(cat "$LEDGER/review-p9/chain.json")" '"status": "aborted"' "case 9: chain.json recorded aborted entry"
unset SIMULATE_HEAD_MOVE
unset REPO_FOR_TEST

# Case 10: seats resolved via resolver stub (no --seats flag)
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop.sh"
C10_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10 --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10_RC=$?
assert_exit_code "$C10_RC" "0" "case 10: exits 0 with resolver stub"
assert_file_exists "$LEDGER/review-p10/chain.json" "case 10: chain.json exists"
assert_contains "$(cat "$LEDGER/review-p10/chain.json")" '"seats": [' "case 10: chain.json has seats"
assert_file_exists "$LEDGER/review-p10/g1/seat-s0.json" "case 10: seat-s0.json exists"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

finalize_test
