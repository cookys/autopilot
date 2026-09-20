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

finalize_test
