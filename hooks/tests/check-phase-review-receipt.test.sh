#!/usr/bin/env bash
# check-phase-review-receipt.test.sh — contract test for scripts/check-phase-review-receipt.js
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-phase-review-receipt.js"

# 0. --help flag
HELP_OUT=$(node "$SCRIPT" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "case 0: --help exits 0"
assert_contains "$HELP_OUT" "Usage:" "case 0: --help outputs usage"

# Set up scratch test environment
SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "c1"
  echo "base content" > file.txt
  git add file.txt
  git commit -q -m "c2"
)

PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "work changes" >> file.txt
  git add file.txt
  git commit -q -m "c3"
)

GEN1_HEAD=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"

# Compute real diff and sha256 between PHASE_BASE and GEN1_HEAD
DIFF_C2_C3=$(git -C "$SCRATCH_REPO" diff "$PHASE_BASE" "$GEN1_HEAD")
DIFF_SHA=$(node -e "const crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(process.argv[1], 'utf8').digest('hex'))" "$DIFF_C2_C3")

# Helper to write standard range.json
write_range_json() {
  local p="$1"
  local gen="$2"
  local b="$3"
  local h="$4"
  local dsha="$5"
  mkdir -p "$LEDGER/review-$p/g$gen"
  cat << EOF > "$LEDGER/review-$p/g$gen/range.json"
{
  "base": "$b",
  "head": "$h",
  "diff_sha256": "$dsha"
}
EOF
}

# Helper to write receipt.json
write_receipt_json() {
  local p="$1"
  local content="$2"
  mkdir -p "$LEDGER"
  cat << EOF > "$LEDGER/receipt-$p.json"
$content
EOF
}

# 1. A fully matching, well-formed "review" kind receipt with one finalized generation,
#    correct phase_base_sha, correct range.json whose diff_sha256 is the real sha256 of the real git diff base head output
#    in the scratch repo, and the branch's current head matching the last chain entry's head: expect exit 0.
write_range_json "p1" "1" "$PHASE_BASE" "$GEN1_HEAD" "$DIFF_SHA"
write_receipt_json "p1" "{
  \"kind\": \"review\",
  \"phase\": \"p1\",
  \"branch\": \"work\",
  \"phase_base_sha\": \"$PHASE_BASE\",
  \"chain\": [
    {
      \"generation\": 1,
      \"base\": \"$PHASE_BASE\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"

C1_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p1 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C1_RC=$?
assert_exit_code "$C1_RC" "0" "case 1: valid review receipt exits 0"

# 2. Same as (1) but the branch has since moved (add a new commit after building the fixture)
#    so the recorded head no longer matches: expect exit 1.
(
  cd "$SCRATCH_REPO"
  echo "another commit" >> file.txt
  git add file.txt
  git commit -q -m "c4"
)
C2_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p1 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C2_RC=$?
assert_exit_code "$C2_RC" "1" "case 2: branch moved exits 1"

# Reset branch back to GEN1_HEAD for subsequent tests
(
  cd "$SCRATCH_REPO"
  git reset --hard -q "$GEN1_HEAD"
)

# 3. Same as (1) but verdict is "FIX-THEN-SHIP" instead of "SHIP-AS-IS": expect exit 1.
write_receipt_json "p3" "{
  \"kind\": \"review\",
  \"phase\": \"p3\",
  \"branch\": \"work\",
  \"phase_base_sha\": \"$PHASE_BASE\",
  \"chain\": [
    {
      \"generation\": 1,
      \"base\": \"$PHASE_BASE\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\"
    }
  ],
  \"verdict\": \"FIX-THEN-SHIP\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
write_range_json "p3" "1" "$PHASE_BASE" "$GEN1_HEAD" "$DIFF_SHA"
C3_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p3 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C3_RC=$?
assert_exit_code "$C3_RC" "1" "case 3: verdict FIX-THEN-SHIP exits 1"

# 4. No receipt file present at all: expect exit 1.
C4_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase nonexistent --branch work --repo-root "$SCRATCH_REPO" 2>&1); C4_RC=$?
assert_exit_code "$C4_RC" "1" "case 4: missing receipt exits 1"

# 5. Same as (1) but hand-edit g1/range.json's diff_sha256 to a wrong value after writing it (simulating tampering or staleness): expect exit 1.
write_range_json "p5" "1" "$PHASE_BASE" "$GEN1_HEAD" "0000000000000000000000000000000000000000000000000000000000000000"
write_receipt_json "p5" "{
  \"kind\": \"review\",
  \"phase\": \"p5\",
  \"branch\": \"work\",
  \"phase_base_sha\": \"$PHASE_BASE\",
  \"chain\": [
    {
      \"generation\": 1,
      \"base\": \"$PHASE_BASE\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
C5_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p5 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: tampered diff_sha256 exits 1"

# 6. A two-generation chain where generation 2's base does not equal generation 1's head (broken chain): expect exit 1.
write_receipt_json "p6" "{
  \"kind\": \"review\",
  \"phase\": \"p6\",
  \"branch\": \"work\",
  \"phase_base_sha\": \"$PHASE_BASE\",
  \"chain\": [
    {
      \"generation\": 1,
      \"base\": \"$PHASE_BASE\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\"
    },
    {
      \"generation\": 2,
      \"base\": \"1111111111111111111111111111111111111111\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
write_range_json "p6" "1" "$PHASE_BASE" "$GEN1_HEAD" "$DIFF_SHA"
write_range_json "p6" "2" "1111111111111111111111111111111111111111" "$GEN1_HEAD" "$DIFF_SHA"
C6_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p6 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C6_RC=$?
assert_exit_code "$C6_RC" "1" "case 6: broken chain base!=prev_head exits 1"

# 7. An "opt-out" kind receipt with configured_value "off", a config file whose sha256 matches config_source.sha256,
#    and a shimmed resolver stub that prints "off" for both the knob field and the knob_resolved_from field: expect exit 0.
mkdir -p "$TEST_TMP/bin"
RESOLVER_STUB="$TEST_TMP/bin/fake-resolver.sh"
cat << 'RESOLVER_EOF' > "$RESOLVER_STUB"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then
  case "$2" in
    plan_review|plan_review_resolved_from)
      if [ -n "$RESOLVER_RET_VAL" ]; then
        echo "$RESOLVER_RET_VAL"
      else
        echo "off"
      fi
      ;;
    *) echo "" ;;
  esac
  exit 0
fi
exit 1
RESOLVER_EOF
chmod +x "$RESOLVER_STUB"

CONFIG_FILE="$TEST_TMP/review-loop-config.md"
echo "plan_review: off" > "$CONFIG_FILE"
CONFIG_SHA=$(node -e "const crypto=require('crypto'), fs=require('fs'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$CONFIG_FILE")

write_receipt_json "p7" "{
  \"kind\": \"opt-out\",
  \"phase\": \"p7\",
  \"knob\": \"plan_review\",
  \"configured_value\": \"off\",
  \"config_source\": {
    \"path\": \"$CONFIG_FILE\",
    \"sha256\": \"$CONFIG_SHA\"
  },
  \"resolved_from\": \"off\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"

export AUTOPILOT_REVIEW_LOOP_RESOLVER="$RESOLVER_STUB"
unset RESOLVER_RET_VAL
C7_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p7 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C7_RC=$?
assert_exit_code "$C7_RC" "0" "case 7: valid opt-out receipt exits 0"

# 8. Same as (7) but the shimmed resolver stub prints "auto" for the knob_resolved_from field (while configured_value still claims "off"): expect exit 1.
cat << 'RESOLVER8_EOF' > "$RESOLVER_STUB"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then
  case "$2" in
    plan_review) echo "off" ;;
    plan_review_resolved_from) echo "auto" ;;
    *) echo "" ;;
  esac
  exit 0
fi
exit 1
RESOLVER8_EOF
chmod +x "$RESOLVER_STUB"

C8_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p7 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C8_RC=$?
assert_exit_code "$C8_RC" "1" "case 8: resolver resolved_from!=off exits 1"

# 9. Same as (7) but the config file's actual bytes are changed after the receipt was written,
#    so its sha256 no longer matches config_source.sha256: expect exit 1.
# Restore resolver to return off
cat << 'RESOLVER7_EOF' > "$RESOLVER_STUB"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then
  case "$2" in
    plan_review|plan_review_resolved_from) echo "off" ;;
    *) echo "" ;;
  esac
  exit 0
fi
exit 1
RESOLVER7_EOF
chmod +x "$RESOLVER_STUB"

echo "plan_review: on" > "$CONFIG_FILE"
C9_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p7 --branch work --repo-root "$SCRATCH_REPO" 2>&1); C9_RC=$?
assert_exit_code "$C9_RC" "1" "case 9: config sha256 mismatch exits 1"

# 10. Mode B: a plan-artifact with one candidate_blocker:true finding and a dispositions file giving it disposition "deferred": expect exit 1.
PLAN_ARTIFACT_10="$TEST_TMP/plan10.json"
DISPOSITIONS_10="$TEST_TMP/disp10.json"
cat << 'EOF' > "$PLAN_ARTIFACT_10"
{
  "findings": [
    { "id": "f1", "candidate_blocker": true },
    { "id": "f2", "candidate_blocker": false }
  ]
}
EOF
cat << 'EOF' > "$DISPOSITIONS_10"
{
  "findings": [
    { "id": "f1", "disposition": "deferred", "rationale": "Will fix later" },
    { "id": "f2", "disposition": "rejected", "rationale": "Not an issue" }
  ]
}
EOF
C10_OUT=$(node "$SCRIPT" --plan-artifact "$PLAN_ARTIFACT_10" --dispositions "$DISPOSITIONS_10" 2>&1); C10_RC=$?
assert_exit_code "$C10_RC" "1" "case 10: deferred disposition for candidate_blocker exits 1"

# 11. Mode B: a plan-artifact with two candidate_blocker:true findings, both given
#     "accepted_blocker"/"rejected" dispositions with non-empty rationale: expect exit 0.
PLAN_ARTIFACT_11="$TEST_TMP/plan11.json"
DISPOSITIONS_11="$TEST_TMP/disp11.json"
cat << 'EOF' > "$PLAN_ARTIFACT_11"
{
  "findings": [
    { "id": "f1", "candidate_blocker": true },
    { "id": "f2", "candidate_blocker": true },
    { "id": "f3", "candidate_blocker": false }
  ]
}
EOF
cat << 'EOF' > "$DISPOSITIONS_11"
{
  "findings": [
    { "id": "f1", "disposition": "accepted_blocker", "rationale": "Confirmed blocking flaw" },
    { "id": "f2", "disposition": "rejected", "rationale": "False positive due to X" }
  ]
}
EOF
C11_OUT=$(node "$SCRIPT" --plan-artifact "$PLAN_ARTIFACT_11" --dispositions "$DISPOSITIONS_11" 2>&1); C11_RC=$?
assert_exit_code "$C11_RC" "0" "case 11: valid dispositions exit 0"

finalize_test
