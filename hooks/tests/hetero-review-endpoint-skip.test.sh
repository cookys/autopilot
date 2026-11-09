#!/usr/bin/env bash
# hetero-review-endpoint-skip.test.sh — a seat whose named endpoint is not configured on this
# account is skipped (reason endpoint_not_configured), not counted as a seat gap; a configured
# endpoint whose run fails is still a gap; a configured working endpoint runs.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/hetero-review-loop.js"
R="$TEST_TMP/repo"
mkdir -p "$R/scripts"
(
  cd "$R"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo a > f.txt; git add f.txt; git commit -q -m c1
  git checkout -q -b work
  echo b >> f.txt; git add f.txt; git commit -q -m c2
)
BASE=$(git -C "$R" rev-parse HEAD~1)

cat > "$R/scripts/dispatch-review.sh" <<'STUB'
#!/usr/bin/env bash
echo "SEAT:$STUB_SEAT_ID ARGS:$*" >> "$LOG_DISPATCH_ARGS"
case " $* " in *" --endpoint glm "*) [ "${GLM_RUN_FAILS:-0}" = 1 ] && exit 1 ;; esac
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB
chmod +x "$R/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$R/scripts/dispatch-review.sh"
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-such-endpoints.env"
unset AUTOPILOT_ENDPOINT_GLM_URL AUTOPILOT_ENDPOINT_GLM_TOKEN ANTHROPIC_COMPATIBLE_BASE_URL ANTHROPIC_COMPATIBLE_AUTH_TOKEN
SEATS="m1/low@codex,m2/low@codex,m3/low@codex,glm-x/high@anthropic-compatible:glm"

collect() { # phase
  node "$SCRIPT" collect --implementer-engine claude-sonnet-5 --repo-root "$R" --ledger "$TEST_TMP/ledger" --phase "$1" --generation 1 --branch work --phase-base "$BASE" --seats "$SEATS" 2>&1
}

# 1. unconfigured glm endpoint: skipped, no gap, the other 3 count
export LOG_DISPATCH_ARGS="$TEST_TMP/d1.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(collect p1); RC=$?
assert_exit_code "$RC" "0" "unconfigured endpoint: collect exits 0 (no seat gap)"
CH=$(cat "$TEST_TMP/ledger/review-p1/chain.json")
assert_contains "$CH" '"reason": "endpoint_not_configured"' "unconfigured endpoint: skip recorded with endpoint_not_configured"
assert_contains "$CH" '"total_seats": 3' "unconfigured endpoint: the other 3 seats are the panel"
assert_contains "$CH" '"reviewed_seats": 3' "unconfigured endpoint: 3 of 3 reviewed"
assert_contains "$CH" '"status": "pending"' "unconfigured endpoint: generation is pending, not pending-with-gap"
assert_not_contains "$(cat "$LOG_DISPATCH_ARGS")" "--endpoint glm" "unconfigured endpoint: glm seat never dispatched"

# 2. configured endpoint whose run fails: still a gap
export AUTOPILOT_ENDPOINT_GLM_URL="https://fake.invalid/glm" AUTOPILOT_ENDPOINT_GLM_TOKEN="fake-not-a-token"
export LOG_DISPATCH_ARGS="$TEST_TMP/d2.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(GLM_RUN_FAILS=1 collect p2); RC=$?
assert_exit_code "$RC" "1" "configured endpoint, run fails: still a seat gap (exit 1)"
assert_contains "$OUT" "seat gap" "configured endpoint, run fails: gap reported"

# 3. configured and working: seat runs
export LOG_DISPATCH_ARGS="$TEST_TMP/d3.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(collect p3); RC=$?
assert_exit_code "$RC" "0" "configured endpoint, works: exits 0"
assert_contains "$(cat "$LOG_DISPATCH_ARGS")" "--endpoint glm" "configured endpoint, works: glm seat dispatched"
CH=$(cat "$TEST_TMP/ledger/review-p3/chain.json")
assert_contains "$CH" '"total_seats": 4' "configured endpoint, works: 4 seats"
assert_not_contains "$CH" "endpoint_not_configured" "configured endpoint, works: no skip recorded"

finalize_test
