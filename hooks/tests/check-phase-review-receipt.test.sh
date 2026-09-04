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
DIFF_SHA=$(git -C "$SCRATCH_REPO" diff "$PHASE_BASE" "$GEN1_HEAD" | { sha256sum 2>/dev/null || shasum -a 256; } | awk '{print $1}')

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

# Helper to write findings and dispositions
write_gen_artifacts() {
  local p="$1"
  local gen="$2"
  mkdir -p "$LEDGER/review-$p/g$gen"
  cat << 'EOF' > "$LEDGER/review-$p/g$gen/findings.json"
{
  "findings": []
}
EOF
  cat << 'EOF' > "$LEDGER/review-$p/g$gen/dispositions.json"
{
  "findings": []
}
EOF
  local dsha
  dsha=$(node -e "const crypto=require('crypto'), fs=require('fs'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$LEDGER/review-$p/g$gen/dispositions.json")
  echo "$dsha"
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
P1_DISP_SHA=$(write_gen_artifacts "p1" "1")
mkdir -p "$LEDGER/review-p1"
cat << EOF > "$LEDGER/review-p1/chain.json"
[
  {
    "generation": 1,
    "base": "$PHASE_BASE",
    "head": "$GEN1_HEAD",
    "status": "finalized",
    "dispositions_sha256": "$P1_DISP_SHA"
  }
]
EOF
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
      \"status\": \"finalized\",
      \"dispositions_sha256\": \"$P1_DISP_SHA\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"

C1_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p1 --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C1_RC=$?
assert_exit_code "$C1_RC" "0" "case 1: valid review receipt exits 0"

# 2. Same as (1) but the branch has since moved (add a new commit after building the fixture)
#    so the recorded head no longer matches: expect exit 1.
(
  cd "$SCRATCH_REPO"
  echo "another commit" >> file.txt
  git add file.txt
  git commit -q -m "c4"
)
C2_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p1 --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C2_RC=$?
assert_exit_code "$C2_RC" "1" "case 2: branch moved exits 1"

# Reset branch back to GEN1_HEAD for subsequent tests
(
  cd "$SCRATCH_REPO"
  git reset --hard -q "$GEN1_HEAD"
)

# 3. Same as (1) but verdict is "FIX-THEN-SHIP" instead of "SHIP-AS-IS": expect exit 1.
P3_DISP_SHA=$(write_gen_artifacts "p3" "1")
mkdir -p "$LEDGER/review-p3"
cat << EOF > "$LEDGER/review-p3/chain.json"
[
  {
    "generation": 1,
    "base": "$PHASE_BASE",
    "head": "$GEN1_HEAD",
    "status": "finalized",
    "dispositions_sha256": "$P3_DISP_SHA"
  }
]
EOF
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
      \"status\": \"finalized\",
      \"dispositions_sha256\": \"$P3_DISP_SHA\"
    }
  ],
  \"verdict\": \"FIX-THEN-SHIP\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
write_range_json "p3" "1" "$PHASE_BASE" "$GEN1_HEAD" "$DIFF_SHA"
C3_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p3 --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C3_RC=$?
assert_exit_code "$C3_RC" "1" "case 3: verdict FIX-THEN-SHIP exits 1"

# 4. No receipt file present at all: expect exit 1.
C4_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase nonexistent --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C4_RC=$?
assert_exit_code "$C4_RC" "1" "case 4: missing receipt exits 1"

# 5. Same as (1) but hand-edit g1/range.json's diff_sha256 to a wrong value after writing it (simulating tampering or staleness): expect exit 1.
write_range_json "p5" "1" "$PHASE_BASE" "$GEN1_HEAD" "0000000000000000000000000000000000000000000000000000000000000000"
P5_DISP_SHA=$(write_gen_artifacts "p5" "1")
mkdir -p "$LEDGER/review-p5"
cat << EOF > "$LEDGER/review-p5/chain.json"
[
  {
    "generation": 1,
    "base": "$PHASE_BASE",
    "head": "$GEN1_HEAD",
    "status": "finalized",
    "dispositions_sha256": "$P5_DISP_SHA"
  }
]
EOF
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
      \"status\": \"finalized\",
      \"dispositions_sha256\": "$P5_DISP_SHA\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
C5_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p5 --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: tampered diff_sha256 exits 1"

# 6. A two-generation chain where generation 2's base does not equal generation 1's head (broken chain): expect exit 1.
P6_DISP_SHA1=$(write_gen_artifacts "p6" "1")
P6_DISP_SHA2=$(write_gen_artifacts "p6" "2")
mkdir -p "$LEDGER/review-p6"
cat << EOF > "$LEDGER/review-p6/chain.json"
[
  {
    "generation": 1,
    "base": "$PHASE_BASE",
    "head": "$GEN1_HEAD",
    "status": "finalized",
    "dispositions_sha256": "$P6_DISP_SHA1"
  },
  {
    "generation": 2,
    "base": "1111111111111111111111111111111111111111",
    "head": "$GEN1_HEAD",
    "status": "finalized",
    "dispositions_sha256": "$P6_DISP_SHA2"
  }
]
EOF
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
      \"status\": \"finalized\",
      \"dispositions_sha256\": \"$P6_DISP_SHA1\"
    },
    {
      \"generation\": 2,
      \"base\": \"1111111111111111111111111111111111111111\",
      \"head\": \"$GEN1_HEAD\",
      \"status\": \"finalized\",
      \"dispositions_sha256\": \"$P6_DISP_SHA2\"
    }
  ],
  \"verdict\": \"SHIP-AS-IS\",
  \"open_findings\": [],
  \"resolved_from\": \"test\",
  \"written_at\": \"2026-09-04T00:00:00Z\"
}"
write_range_json "p6" "1" "$PHASE_BASE" "$GEN1_HEAD" "$DIFF_SHA"
write_range_json "p6" "2" "1111111111111111111111111111111111111111" "$GEN1_HEAD" "$DIFF_SHA"
C6_OUT=$(node "$SCRIPT" --ledger "$LEDGER" --phase p6 --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); C6_RC=$?
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
    { "id": "f1", "candidate_blocker": true, "disposition": "deferred" },
    { "id": "f2", "candidate_blocker": false, "disposition": "rejected" }
  ]
}
EOF
cat << 'EOF' > "$DISPOSITIONS_10"
{
  "findings": [
    { "id": "f1", "candidate_blocker": true, "disposition": "deferred", "rationale": "Will fix later" },
    { "id": "f2", "candidate_blocker": false, "disposition": "rejected", "rationale": "Not an issue" }
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
    { "id": "f1", "candidate_blocker": true, "disposition": "accepted_blocker" },
    { "id": "f2", "candidate_blocker": true, "disposition": "rejected" },
    { "id": "f3", "candidate_blocker": false, "disposition": "rejected" }
  ]
}
EOF
cat << 'EOF' > "$DISPOSITIONS_11"
{
  "findings": [
    { "id": "f1", "candidate_blocker": true, "disposition": "accepted_blocker", "rationale": "Confirmed blocking flaw" },
    { "id": "f2", "candidate_blocker": true, "disposition": "rejected", "rationale": "False positive due to X" }
  ]
}
EOF
C11_OUT=$(node "$SCRIPT" --plan-artifact "$PLAN_ARTIFACT_11" --dispositions "$DISPOSITIONS_11" 2>&1); C11_RC=$?
assert_exit_code "$C11_RC" "0" "case 11: valid dispositions exit 0"

# ─────────────────────────────────────────────────────────────────────────────
# 12. End-to-end case using hetero-review-loop.js collect and finalize
# ─────────────────────────────────────────────────────────────────────────────
HETERO_SCRIPT="$REPO_ROOT/scripts/hetero-review-loop.js"
mkdir -p "$SCRATCH_REPO/scripts"
DISPATCH_STUB="$SCRATCH_REPO/scripts/dispatch-review.sh"
cat << 'STUB_EOF' > "$DISPATCH_STUB"
#!/usr/bin/env bash
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
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": ""}'
STUB_EOF
chmod +x "$DISPATCH_STUB"

# Ensure check-redispatch-prompt.sh is available in SCRATCH_REPO
if [ ! -f "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh" ]; then
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
fi

export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$DISPATCH_STUB"

# Seat s0 reports a Critical finding; Seat s1 reports empty findings with verdict SHIP-AS-IS
export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "FIX-THEN-SHIP", "findings": "🔴 Critical: Critical security bug found in validation logic"}'
export STUB_RESPONSE_s1='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": ""}'
unset STUB_SEAT_RESPONSE

E2E_PHASE="p_e2e"
mkdir -p "$LEDGER"

COLLECT_OUT=$(node "$HETERO_SCRIPT" collect \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER" \
  --phase "$E2E_PHASE" \
  --generation 1 \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --seats "m1/low@codex,m2/med@agy" 2>&1); COLLECT_RC=$?
assert_exit_code "$COLLECT_RC" "0" "e2e: collect exits 0"

# Inspect findings.json to get finding id
FINDINGS_FILE="$LEDGER/review-$E2E_PHASE/g1/findings.json"
assert_file_exists "$FINDINGS_FILE" "e2e: findings.json exists"
FINDING_ID=$(node -e "const f = JSON.parse(fs.readFileSync(process.argv[1])).findings; console.log(f[0].id);" "$FINDINGS_FILE")

# Hand-write a dispositions file disposing every finding (disposing f as verified)
E2E_DISP_FILE="$TEST_TMP/disp_e2e.json"
cat << EOF > "$E2E_DISP_FILE"
{
  "schema_version": 1,
  "phase": "$E2E_PHASE",
  "generation": 1,
  "findings": [
    { "id": "$FINDING_ID", "disposition": "verified", "rationale": "True positive critical defect" }
  ]
}
EOF

FINALIZE_OUT=$(node "$HETERO_SCRIPT" finalize \
  --repo-root "$SCRATCH_REPO" \
  --ledger "$LEDGER" \
  --phase "$E2E_PHASE" \
  --generation 1 \
  --branch work \
  --dispositions "$E2E_DISP_FILE" 2>&1); FINALIZE_RC=$?
assert_exit_code "$FINALIZE_RC" "0" "e2e: finalize exits 0"

E2E_RECEIPT="$LEDGER/receipt-$E2E_PHASE.json"
assert_file_exists "$E2E_RECEIPT" "e2e: receipt exists"

# Run checker in review mode against resulting receipt and confirm it exits 0
CHECK_E2E_OUT=$(node "$SCRIPT" \
  --ledger "$LEDGER" \
  --phase "$E2E_PHASE" \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --repo-root "$SCRATCH_REPO" 2>&1); CHECK_E2E_RC=$?
assert_exit_code "$CHECK_E2E_RC" "0" "e2e: checker exits 0 on valid finalized review receipt"

# Negative control 1: Hand-edit receipt so verdict says SHIP-AS-IS while finding is Critical & verified -> exit 1
FORGED_RECEIPT_CONTENT=$(node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  r.verdict = 'SHIP-AS-IS';
  fs.writeFileSync(process.argv[1], JSON.stringify(r, null, 2));
" "$E2E_RECEIPT")
NEG1_OUT=$(node "$SCRIPT" \
  --ledger "$LEDGER" \
  --phase "$E2E_PHASE" \
  --branch work \
  --phase-base "$PHASE_BASE" \
  --repo-root "$SCRATCH_REPO" 2>&1); NEG1_RC=$?
assert_exit_code "$NEG1_RC" "1" "e2e: checker exits 1 on forged verdict"

# Restore genuine verdict for negative control 2
node -e "
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  r.verdict = 'FIX-THEN-SHIP';
  fs.writeFileSync(process.argv[1], JSON.stringify(r, null, 2));
" "$E2E_RECEIPT"

# Negative control 2: Run checker with a phase-base flag value that differs from chain's actual first-entry base sha -> exit 1
NEG2_OUT=$(node "$SCRIPT" \
  --ledger "$LEDGER" \
  --phase "$E2E_PHASE" \
  --branch work \
  --phase-base "0000000000000000000000000000000000000000" \
  --repo-root "$SCRATCH_REPO" 2>&1); NEG2_RC=$?
assert_exit_code "$NEG2_RC" "1" "e2e: checker exits 1 on mismatched phase-base sha"

finalize_test
