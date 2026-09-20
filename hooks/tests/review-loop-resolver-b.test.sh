#!/usr/bin/env bash
# review-loop-resolver-b.test.sh — row-39+ contract tests for review-loop resolver-b
. "$(dirname "$0")/lib.sh"

assert_r39_hetero_review_loop_c() {
  local mod="$REPO_ROOT/scripts/lib/exclude-allowlist.js"
  assert_file_exists "$mod" "r39: exclude-allowlist.js exists"

  local names
  names=$(node -e "const m=require('$mod'); process.stdout.write(Object.keys(m).sort().join(','))")
  assert_contains "$names" "EXCLUDE_ALLOWLIST" "r39: exports EXCLUDE_ALLOWLIST"
  assert_contains "$names" "isPathspecAllowed" "r39: exports isPathspecAllowed"

  local h_req h_local p_req p_local
  h_req=$(grep -c "require('./lib/exclude-allowlist')" "$REPO_ROOT/scripts/hetero-review-loop.js")
  p_req=$(grep -c "require('./lib/exclude-allowlist')" "$REPO_ROOT/scripts/check-phase-review-receipt.js")
  h_local=$(grep -c "^const EXCLUDE_ALLOWLIST = \[" "$REPO_ROOT/scripts/hetero-review-loop.js" || true)
  p_local=$(grep -c "^const EXCLUDE_ALLOWLIST = \[" "$REPO_ROOT/scripts/check-phase-review-receipt.js" || true)

  assert_eq "$h_req" "1" "r39: hetero-review-loop.js require count is 1"
  assert_eq "$p_req" "1" "r39: check-phase-review-receipt.js require count is 1"
  assert_eq "$h_local" "0" "r39: hetero-review-loop.js has no local EXCLUDE_ALLOWLIST"
  assert_eq "$p_local" "0" "r39: check-phase-review-receipt.js has no local EXCLUDE_ALLOWLIST"
}

assert_r39_hetero_review_loop_c

# # RED: N/A — confirmation only (Mode A already applies requiredMinSeats from
# --min-reviewed-seats on a 3-seat chain: 2 reviewed vs floor 3 exits 1 and names
# the shortfall). Regression guard for row 34.
assert_r34_check_phase_review_r() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"
  local SCRATCH_REPO="$TEST_TMP/r34-repo"
  local LEDGER="$TEST_TMP/r34-ledger"
  mkdir -p "$SCRATCH_REPO/scripts" "$LEDGER"
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
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
  (
    cd "$SCRATCH_REPO"
    git checkout -q -b work
    echo "work changes" >> file.txt
    git add file.txt
    git commit -q -m "c3"
  )
  cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"
  export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  export STUB_RESPONSE_s1='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  export STUB_RESPONSE_s2='{"status": "no_verdict"}'
  unset STUB_SEAT_RESPONSE || true

  local COLLECT_OUT COLLECT_RC
  COLLECT_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r34 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@codex,m2/med@agy,m3/high@grok" \
    --allow-seat-gap --min-reviewed-seats 2 2>&1); COLLECT_RC=$?
  assert_exit_code "$COLLECT_RC" "0" "r34: 3-seat collect with 2 reviewed + gap at floor 2 exits 0"

  cat > "$TEST_TMP/r34-disp.json" <<EOF
{"schema_version":1,"phase":"p_r34","generation":1,"findings":[]}
EOF
  local FIN_OUT FIN_RC
  FIN_OUT=$(node "$HETERO" finalize \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r34 --generation 1 \
    --branch work --dispositions "$TEST_TMP/r34-disp.json" 2>&1); FIN_RC=$?
  assert_exit_code "$FIN_RC" "0" "r34: finalize of 2-of-3 reviewed generation exits 0"

  local CHECK_OUT CHECK_RC
  CHECK_OUT=$(node "$CHECKER" \
    --ledger "$LEDGER" --phase p_r34 --branch work --phase-base "$PHASE_BASE" \
    --repo-root "$SCRATCH_REPO" --min-reviewed-seats 3 2>&1); CHECK_RC=$?
  assert_exit_code "$CHECK_RC" "1" "r34: Mode A --min-reviewed-seats 3 blocks 2-of-3 reviewed receipt"
  assert_contains "$CHECK_OUT" "reviewed seats (2) below minimum required (3)" \
    "r34: refusal names the reviewed-seat shortfall"
}

assert_r34_check_phase_review_r

finalize_test
