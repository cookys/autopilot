#!/usr/bin/env bash
# hooks/tests/adjudicate-findings.test.sh — tests for adjudicate-findings.js
#
# Sourced from lib.sh to get sandboxed environment.
. "$(dirname "$0")/lib.sh"

# First, check node syntax of the target script
node --check "$REPO_ROOT/scripts/adjudicate-findings.js"
assert_exit_code "$?" "0" "node --check syntax check"

STORE="$TEST_TMP/findings.jsonl"

run_adj() {
  local args="$1"
  local stdin_content="${2:-}"
  local stdout_file="$TEST_TMP/.stdout.$$"
  local stderr_file="$TEST_TMP/.stderr.$$"
  local cmd_exit
  
  if [ -n "$stdin_content" ]; then
    node "$REPO_ROOT/scripts/adjudicate-findings.js" $args >"$stdout_file" 2>"$stderr_file" <<< "$stdin_content"
  else
    node "$REPO_ROOT/scripts/adjudicate-findings.js" $args >"$stdout_file" 2>"$stderr_file" </dev/null
  fi
  cmd_exit=$?
  __RUN_STDOUT=$(cat "$stdout_file")
  __RUN_STDERR=$(cat "$stderr_file")
  __RUN_EXIT=$cmd_exit
  rm -f "$stdout_file" "$stderr_file"
}

# --- 1. Add finding tests ---
echo "Running Add tests..."

# Successful add
run_adj "add --store $STORE" '{"finding_id": "F1", "claim": "overflow in line 10", "severity": "🔴", "source": "reviewer-a"}'
assert_exit_code "$__RUN_EXIT" "0" "add valid finding F1"
assert_contains "$__RUN_STDOUT" '"finding_id":"F1"' "stdout contains F1 data"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "stdout status is UNPROBED"

# Verify F1 status
run_adj "status --store $STORE --id F1 --json"
assert_exit_code "$__RUN_EXIT" "0" "status of F1"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "status is UNPROBED"
assert_contains "$__RUN_STDOUT" '"actionable":false' "actionable is false"

# Duplicate finding_id rejected
run_adj "add --store $STORE" '{"finding_id": "F1", "claim": "another claim", "severity": "🔵", "source": "reviewer-b"}'
assert_exit_code "$__RUN_EXIT" "1" "add duplicate F1 rejected"
assert_contains "$__RUN_STDERR" "Duplicate finding_id" "stderr contains duplicate warning"

# Input with status field rejected
run_adj "add --store $STORE" '{"finding_id": "F2", "claim": "claim 2", "severity": "🔵", "source": "reviewer-b", "status": "REPRODUCED"}'
assert_exit_code "$__RUN_EXIT" "1" "add status field rejected"
assert_contains "$__RUN_STDERR" "carrying a status is rejected" "stderr warning for status"

# Input with unknown field rejected
run_adj "add --store $STORE" '{"finding_id": "F2", "claim": "claim 2", "severity": "🔵", "source": "reviewer-b", "extra_field": "val"}'
assert_exit_code "$__RUN_EXIT" "1" "add unknown field rejected"
assert_contains "$__RUN_STDERR" "unknown field" "stderr warning for unknown field"

# --- 2. Probe tests ---
echo "Running Probe tests..."

# Probe with matching signature -> REPRODUCED, actionable true, gate exit 0
run_adj "probe --store $STORE --id F1" '{"probe_cmd": "npm test", "expected_signature": "FAIL: overflow", "observed_output": "FAIL: overflow at index 5", "observed_matches_expected": true}'
assert_exit_code "$__RUN_EXIT" "0" "probe matching signature on F1"
assert_contains "$__RUN_STDOUT" '"status":"REPRODUCED"' "stdout status updated to REPRODUCED"

run_adj "status --store $STORE --id F1 --json"
assert_exit_code "$__RUN_EXIT" "0" "status F1"
assert_contains "$__RUN_STDOUT" '"status":"REPRODUCED"' "status is REPRODUCED"
assert_contains "$__RUN_STDOUT" '"actionable":true' "actionable is true"

run_adj "gate --store $STORE --ids F1"
assert_exit_code "$__RUN_EXIT" "0" "gate F1"

# Probe non-matching alone -> stays UNPROBED, gate exit 1 naming the id
run_adj "add --store $STORE" '{"finding_id": "F2", "claim": "null ptr", "severity": "🟠", "source": "reviewer-b"}'
assert_exit_code "$__RUN_EXIT" "0" "add F2"

run_adj "probe --store $STORE --id F2" '{"probe_cmd": "npm test", "expected_signature": "NullPointerException", "observed_output": "Success", "observed_matches_expected": false}'
assert_exit_code "$__RUN_EXIT" "0" "probe non-matching F2"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "stdout status stays UNPROBED"

run_adj "status --store $STORE --id F2 --json"
assert_exit_code "$__RUN_EXIT" "0" "status F2"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "status remains UNPROBED"
assert_contains "$__RUN_STDOUT" '"actionable":false' "actionable remains false"

run_adj "gate --store $STORE --ids F2"
assert_exit_code "$__RUN_EXIT" "1" "gate F2 fails"
assert_eq "$__RUN_STDOUT" "F2" "gate stdout lists F2"

# --- 3. Refute tests ---
echo "Running Refute tests..."

# Refute without prior probe -> rejected
run_adj "add --store $STORE" '{"finding_id": "F3", "claim": "race cond", "severity": "🟡", "source": "reviewer-a"}'
assert_exit_code "$__RUN_EXIT" "0" "add F3"

run_adj "refute --store $STORE --id F3" '{"mutation_desc": "lock added", "mutation_probe_output": "Success", "probe_fired_under_mutation": true}'
assert_exit_code "$__RUN_EXIT" "1" "refute without prior probe rejected"
assert_contains "$__RUN_STDERR" "requires a prior probe record" "stderr warning for prior probe"

# Refute with probe_fired_under_mutation=false -> UNPROBED + vacuous_probe surfaced
run_adj "refute --store $STORE --id F2" '{"mutation_desc": "mutate to fail", "mutation_probe_output": "Success", "probe_fired_under_mutation": false}'
assert_exit_code "$__RUN_EXIT" "0" "refute with probe_fired_under_mutation=false"
assert_contains "$__RUN_STDOUT" '"vacuous_probe":true' "surfaced vacuous_probe: true"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "refute event status stays UNPROBED"

run_adj "status --store $STORE --id F2 --json"
assert_exit_code "$__RUN_EXIT" "0" "status F2"
assert_contains "$__RUN_STDOUT" '"status":"UNPROBED"' "status is UNPROBED"

# Refute with probe_fired_under_mutation=true -> REFUTED, actionable false
run_adj "refute --store $STORE --id F2" '{"mutation_desc": "mutate to fail", "mutation_probe_output": "Fired!", "probe_fired_under_mutation": true}'
assert_exit_code "$__RUN_EXIT" "0" "refute with probe_fired_under_mutation=true"
assert_contains "$__RUN_STDOUT" '"vacuous_probe":false' "surfaced vacuous_probe: false"
assert_contains "$__RUN_STDOUT" '"status":"REFUTED"' "refute event status updated to REFUTED"

run_adj "status --store $STORE --id F2 --json"
assert_exit_code "$__RUN_EXIT" "0" "status F2"
assert_contains "$__RUN_STDOUT" '"status":"REFUTED"' "status is REFUTED"
assert_contains "$__RUN_STDOUT" '"actionable":false' "actionable is false"

# --- 4. Trace tests ---
echo "Running Trace tests..."

# Trace with confirmed_by == source -> rejected
run_adj "add --store $STORE" '{"finding_id": "F4", "claim": "deadlock", "severity": "🔵", "source": "reviewer-a"}'
assert_exit_code "$__RUN_EXIT" "0" "add F4"

run_adj "trace --store $STORE --id F4" '{"trace_chain": ["a.js:10 - deadlock"], "confirmed_by": "reviewer-a"}'
assert_exit_code "$__RUN_EXIT" "1" "trace same-source rejected"
assert_contains "$__RUN_STDERR" "reject same-source confirmation" "stderr warning for same source"

# Trace with different family -> PROOF_BY_TRACE, actionable true
run_adj "trace --store $STORE --id F4" '{"trace_chain": ["a.js:10 - deadlock"], "confirmed_by": "reviewer-b"}'
assert_exit_code "$__RUN_EXIT" "0" "trace different-source success"
assert_contains "$__RUN_STDOUT" '"status":"PROOF_BY_TRACE"' "status is PROOF_BY_TRACE"

run_adj "status --store $STORE --id F4 --json"
assert_exit_code "$__RUN_EXIT" "0" "status F4"
assert_contains "$__RUN_STDOUT" '"status":"PROOF_BY_TRACE"' "status is PROOF_BY_TRACE"
assert_contains "$__RUN_STDOUT" '"actionable":true' "actionable is true"

# --- 5. Malformed JSON / Unknown Subcommand / Unknown Field ---
echo "Running general validation tests..."

# Malformed JSON
run_adj "add --store $STORE" '{"finding_id": "F5", "claim":'
assert_exit_code "$__RUN_EXIT" "1" "malformed JSON fails with 1"

# Unknown subcommand -> exit 2
run_adj "invalidsub --store $STORE" '{"finding_id": "F5"}'
assert_exit_code "$__RUN_EXIT" "2" "unknown subcommand fails with 2"

# --- 6. Append-only and Idempotency tests ---
echo "Running Append-only / Idempotency tests..."

# Count lines in the store file
LINE_COUNT_BEFORE=$(wc -l < "$STORE")

# Call status (read-only)
run_adj "status --store $STORE"
assert_exit_code "$__RUN_EXIT" "0" "status check"

# Check that store has not grown
LINE_COUNT_AFTER=$(wc -l < "$STORE")
assert_eq "$LINE_COUNT_AFTER" "$LINE_COUNT_BEFORE" "status check did not write to store"

# Make sure all historical lines are present (line count only grows on writes)
run_adj "add --store $STORE" '{"finding_id": "F5", "claim": "unused import", "severity": "🔵", "source": "reviewer-a"}'
assert_exit_code "$__RUN_EXIT" "0" "add F5"

LINE_COUNT_AFTER_ADD=$(wc -l < "$STORE")
assert_eq "$LINE_COUNT_AFTER_ADD" "$((LINE_COUNT_BEFORE + 1))" "store line count grew by exactly 1"

# --- 7. Option-argument parsing and missing value tests ---
echo "Running option-argument parsing / missing value validation tests..."

# status --store with no value fails with exit 2, naming --store, no stack trace
run_adj "status --store"
assert_exit_code "$__RUN_EXIT" "2" "status with missing --store value exits 2"
assert_contains "$__RUN_STDERR" "--store" "stderr names --store"
assert_not_contains "$__RUN_STDERR" "TypeError" "stderr has no TypeError"
assert_not_contains "$__RUN_STDERR" "at " "stderr has no stack trace (no 'at ')"

# status --store with option token as value fails with exit 2, naming --store, no stack trace
run_adj "status --store --id F1"
assert_exit_code "$__RUN_EXIT" "2" "status with option token as --store value exits 2"
assert_contains "$__RUN_STDERR" "--store" "stderr names --store"
assert_not_contains "$__RUN_STDERR" "TypeError" "stderr has no TypeError"
assert_not_contains "$__RUN_STDERR" "at " "stderr has no stack trace (no 'at ')"

# probe --id with no value fails with exit 2, naming --id, no stack trace
run_adj "probe --store $STORE --id"
assert_exit_code "$__RUN_EXIT" "2" "probe with missing --id value exits 2"
assert_contains "$__RUN_STDERR" "--id" "stderr names --id"
assert_not_contains "$__RUN_STDERR" "TypeError" "stderr has no TypeError"
assert_not_contains "$__RUN_STDERR" "at " "stderr has no stack trace (no 'at ')"

# Control case: normal invocation still works
run_adj "status --store $STORE"
assert_exit_code "$__RUN_EXIT" "0" "normal status invocation succeeds"

finalize_test
