#!/usr/bin/env bash
# A STANDING operator pin admits an unqualified roster seat exactly as the
# per-invocation override file does, and the notice says WHICH of the two it was.
#
# Why this exists: the operator-pin plan
# (docs/plans/2026-09-11-operator-pin-supersedes-qualification.md §1 item 2) names
# "the only evidence-free path is per-invocation and file-shaped" as a defect.
# D1-D4 closed it on the admission side (dispatch-contract.js reads operator_pin);
# this covers the roster side. The red case matters more than the green one: with
# the pin store emptied, the same config must still be REFUSED, or the gate has
# been removed rather than widened.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
CAP_STATE="$REPO_ROOT/scripts/engine-capability-state.js"
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_FILE AUTOPILOT_QUALIFICATION_OVERRIDE ENGINE_CAPABILITY_DIR
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-such-topology.json"

# An unqualified seat: cursor is in UNQUALIFIED_RUNNERS and this store has no row.
PIN_STORE="$TEST_TMP/pin-store"
mkdir -p "$PIN_STORE"
CFG="$TEST_TMP/pinned-implementer.md"
printf -- '- implementer_engine: cursor-grok-4.6-low\n- implementer_effort: low\n- implementer_runner: cursor\n' > "$CFG"

run_resolver() {
  local stdout_file="$TEST_TMP/stdout" stderr_file="$TEST_TMP/stderr"
  ENGINE_CAPABILITY_DIR="$PIN_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" \
    bash "$SCRIPT" >"$stdout_file" 2>"$stderr_file"
  RUN_EXIT=$?
  RUN_STDOUT="$(cat "$stdout_file")"
  RUN_STDERR="$(cat "$stderr_file")"
}

# --- RED: no pin, no override file → refused, and the message names both exits.
run_resolver
assert_eq "$RUN_EXIT" "3" "an unqualified seat with no pin and no override is refused"
assert_contains "$RUN_STDERR" "is NOT qualified for any role" \
  "the refusal names the missing qualification"
assert_contains "$RUN_STDERR" "standing pin" \
  "the refusal names the pin as one of the sanctioned exits"
assert_contains "$RUN_STDERR" "AUTOPILOT_QUALIFICATION_OVERRIDE" \
  "the refusal still names the per-invocation exit"
assert_not_contains "$RUN_STDOUT" '"implementer_engine"' \
  "a refused roster emits no roster document"

# --- GREEN: the same config, with a standing pin recorded for that exact tuple.
node "$CAP_STATE" pin-seat --engine cursor-grok-4.6-low --runner cursor \
  --role implementer --effort low --endpoint @none \
  --reason "operator named this seat for the fixture" --operator test-operator \
  --store "$PIN_STORE" >/dev/null
run_resolver
assert_eq "$RUN_EXIT" "0" "a standing pin admits the same seat the red case refused"
assert_contains "$RUN_STDOUT" '"implementer_engine": "cursor-grok-4.6-low"' \
  "the admitted roster carries the pinned engine"
assert_contains "$RUN_STDOUT" '"override_admitted_seats": ["implementer"]' \
  "an evidence-free admission is recorded in override_admitted_seats"
assert_contains "$RUN_STDERR" "EVIDENCE-FREE standing operator pin" \
  "the notice says the decision came from a pin, not from an override file"
assert_contains "$RUN_STDERR" "test-operator" \
  "the notice names the operator who made the decision"
assert_contains "$RUN_STDERR" "RECORDED OPERATOR DECISION, not earned qualification" \
  "the notice refuses to read as earned qualification"

# --- The pin is role-exact: an implementer pin must not admit a reviewer seat.
REV_CFG="$TEST_TMP/pinned-as-reviewer.md"
printf -- '- reviewer_engine: cursor-grok-4.6-low\n- reviewer_effort: low\n- reviewer_runner: cursor\n' > "$REV_CFG"
ENGINE_CAPABILITY_DIR="$PIN_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$REV_CFG" \
  bash "$SCRIPT" >"$TEST_TMP/rev-out" 2>"$TEST_TMP/rev-err"
REV_EXIT=$?
assert_eq "$REV_EXIT" "3" "an implementer pin does not admit the same engine to a reviewer seat"
assert_contains "$(cat "$TEST_TMP/rev-err")" "is NOT qualified for any role" \
  "the reviewer refusal names the missing qualification"

# --- Removing the pin must re-red the green case: the gate was widened, not removed.
node "$CAP_STATE" unpin-seat --role implementer --store "$PIN_STORE" >/dev/null
run_resolver
assert_eq "$RUN_EXIT" "3" "unpinning restores the refusal — the gate was widened, not deleted"

finalize_test
