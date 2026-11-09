#!/usr/bin/env bash
# hetero-review-quota-skip.test.sh — a seat whose quota the account store records as exhausted
# (unexpired) is skipped with reason quota_exhausted, not counted as a seat gap; the other seats
# still run; when every seat is skipped collect fails clearly; an expired record does not skip.
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
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB
chmod +x "$R/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$R/scripts/dispatch-review.sh"
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-such-endpoints.env"
unset AUTOPILOT_ENDPOINT_GLM_URL AUTOPILOT_ENDPOINT_GLM_TOKEN ANTHROPIC_COMPATIBLE_BASE_URL ANTHROPIC_COMPATIBLE_AUTH_TOKEN
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
SEATS="m1/low@codex,m2/low@codex,m3/low@codex,qx/high@qoderclicn,oc/high@opencode"

record_quota() { # runner model effort status observed_at ttl reset_at
  printf '{"schema_version":1,"observed_at":"%s","runner":"%s","model":"%s","role":"reviewer","effort":"%s","endpoint":null,"runner_version":null,"capability":{"quota":{"status":"%s","reset_at":%s,"confidence":"high","evidence":"test","ttl_seconds":%s}}}' \
    "$5" "$1" "$2" "$3" "$4" "$7" "$6" | node "$REPO_ROOT/scripts/engine-capability-state.js" record >/dev/null
}
collect() { # phase seats
  node "$SCRIPT" collect --implementer-engine claude-sonnet-5 --repo-root "$R" --ledger "$TEST_TMP/ledger" --phase "$1" --generation 1 --branch work --phase-base "$BASE" --seats "${2:-$SEATS}" 2>&1 < /dev/null
}
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 1. two seats recorded exhausted: skipped with reason, the other 3 run, no gap
record_quota qoderclicn qx high exhausted "$NOW" 86400 '"2026-11-21T00:00:00Z"'
record_quota opencode oc high exhausted "$NOW" 86400 'null'
export LOG_DISPATCH_ARGS="$TEST_TMP/d1.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(collect p1); RC=$?
assert_exit_code "$RC" "0" "exhausted seats: collect exits 0 (no seat gap)"
CH=$(cat "$TEST_TMP/ledger/review-p1/chain.json")
assert_contains "$CH" '"reason": "quota_exhausted"' "exhausted seats: skip recorded with quota_exhausted"
assert_contains "$CH" '"reset_at": "2026-11-21T00:00:00Z"' "exhausted seats: reset_at carried into the skip record"
assert_contains "$CH" '"total_seats": 3' "exhausted seats: the other 3 seats are the panel"
assert_contains "$CH" '"reviewed_seats": 3' "exhausted seats: 3 of 3 reviewed"
assert_contains "$OUT" "(quota_exhausted)" "exhausted seats: reason printed"
assert_not_contains "$(cat "$LOG_DISPATCH_ARGS")" "SEAT:s3" "exhausted seats: qoderclicn seat never dispatched"
assert_not_contains "$(cat "$LOG_DISPATCH_ARGS")" "SEAT:s4" "exhausted seats: opencode seat never dispatched"

# 2. every seat exhausted: fails clearly, nothing dispatched
export LOG_DISPATCH_ARGS="$TEST_TMP/d2.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(collect p2 "qx/high@qoderclicn,oc/high@opencode"); RC=$?
assert_exit_code "$RC" "1" "all seats exhausted: collect fails"
assert_contains "$OUT" "every seat was skipped" "all seats exhausted: clear message"
assert_eq "$(cat "$LOG_DISPATCH_ARGS")" "" "all seats exhausted: nothing dispatched"

# 3. an expired record (ttl elapsed) does not skip
record_quota codex m1 low exhausted "2026-01-01T00:00:00Z" 3600 'null'
export LOG_DISPATCH_ARGS="$TEST_TMP/d3.log"; : > "$LOG_DISPATCH_ARGS"
OUT=$(collect p3 "m1/low@codex,m2/low@codex,m3/low@codex"); RC=$?
assert_exit_code "$RC" "0" "expired exhausted record: exits 0"
assert_contains "$(cat "$LOG_DISPATCH_ARGS")" "SEAT:s0" "expired exhausted record: seat still dispatched"
CH=$(cat "$TEST_TMP/ledger/review-p3/chain.json")
assert_not_contains "$CH" "quota_exhausted" "expired exhausted record: no skip recorded"

finalize_test
