#!/usr/bin/env bash
# resolve-review-loop-pins-per-role.test.sh — standing operator pins are looked up per ROLE.
#
# resolve-review-loop.sh reads `engine-capability-state.js pins --role R` once per role and
# reuses it for every seat of that role. Two cursor seats with DIFFERENT roles, each pinned only
# for its own role, must both be admitted by their own pin: a lookup keyed on anything coarser
# than the role hands the second seat the first role's pins and refuses it. No suite exercised
# two pinned roles in one run before this file (2026-09-24).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
STATE="$REPO_ROOT/scripts/engine-capability-state.js"

node "$STATE" pin-seat --engine cur-rev --runner cursor --role reviewer --effort high \
  --endpoint @none --reason "pins-per-role reviewer" --operator tester >/dev/null
node "$STATE" pin-seat --engine cur-impl --runner cursor --role implementer --effort high \
  --endpoint @none --reason "pins-per-role implementer" --operator tester >/dev/null

CFG="$TEST_TMP/review-loop-config.md"
printf -- '- reviewer_engine: cur-rev\n- reviewer_runner: cursor\n- reviewer_effort: high\n- implementer_engine: cur-impl\n- implementer_runner: cursor\n- implementer_effort: high\n' >"$CFG"

ERR="$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" 2>&1 >/dev/null)"

assert_contains "$ERR" "reviewer seat (cur-rev/cursor) runs on an EVIDENCE-FREE standing operator pin" \
  "reviewer seat is admitted by the reviewer-role pin"
assert_contains "$ERR" "implementer seat (cur-impl/cursor) runs on an EVIDENCE-FREE standing operator pin" \
  "implementer seat is admitted by its OWN role's pin, not the reviewer role's"
assert_not_contains "$ERR" "is NOT qualified for any role" \
  "neither pinned seat is refused"

finalize_test "resolve-review-loop-pins-per-role"
