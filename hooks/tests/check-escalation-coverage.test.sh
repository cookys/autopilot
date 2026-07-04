#!/usr/bin/env bash
# hooks/tests/check-escalation-coverage.test.sh — test check-escalation-coverage.js

set -uo pipefail

export TMPDIR="/tmp/hetero-feat-qc2-w1b-mD56XI"
. "$(dirname "$0")/lib.sh"

# Use the sandboxed TEST_TMP as REPO_ROOT for file checks
export REPO_ROOT="$TEST_TMP"

WRAPPER="/tmp/hetero-feat-qc2-w1b-mD56XI/scripts/check-escalation-coverage.js"

# 1. Missing project exit 2 usage
echo "Testing missing project parameters..."
out_missing_proj=$(node "$WRAPPER" 2>&1)
assert_exit_code "$?" 2 "exit code 2 for missing project parameter"
assert_contains "$out_missing_proj" "Usage:" "contains Usage info"

# 2. Project events file not found exit 2
echo "Testing project events file not found..."
out_not_found=$(node "$WRAPPER" --project non-existent-proj 2>&1)
assert_exit_code "$?" 2 "exit code 2 for non-existent project"
assert_contains "$out_not_found" "Error: Project events ledger not found" "contains error message"

# Set up project path
PROJECT_NAME="test-project"
PROJECT_DIR="$TEST_TMP/docs/projects/$PROJECT_NAME"
mkdir -p "$PROJECT_DIR/tree"

# Create helper to write events.jsonl
write_events() {
  # Write lines of json
  printf "%s\n" "$@" > "$PROJECT_DIR/tree/events.jsonl"
}

# Create helper to write signals.json
SIGNALS_FILE="$TEST_TMP/signals.json"
write_signals() {
  echo "$1" > "$SIGNALS_FILE"
}

# 3. Clean case: project with 2 events + signals expecting 2
echo "Testing clean case: 2 events matching 2 expected signals..."
write_events \
  '{"type":"escalation_opened","point":"playbook_no_match","stage":"plan"}' \
  '{"type":"escalation_opened","point":"adjudication_unvalidatable","why_not_mechanical":"some text"}'

write_signals '{"playbook_no_match": 1, "adjudication_unvalidatable": 1}'

out_clean=$(node "$WRAPPER" --project "$PROJECT_NAME" --signals "$SIGNALS_FILE")
assert_exit_code "$?" 0 "clean run exit code is 0"
assert_contains "$out_clean" "All expected escalations accounted for" "indicates clean check"

# 4. JSON output machine check
echo "Testing json output format..."
out_json=$(node "$WRAPPER" --project "$PROJECT_NAME" --signals "$SIGNALS_FILE" --json)
assert_exit_code "$?" 0 "json run exit code is 0"
assert_contains "$out_json" '"project": "test-project"' "JSON contains project name"
assert_contains "$out_json" '"events": 2' "JSON contains correct total event count"
assert_contains "$out_json" '"unattributed": 0' "JSON contains unattributed count"

# 5. Deficit case: signals expecting 3 (e.g. playbook_no_match: 2, adjudication_unvalidatable: 1) -> warn-first
echo "Testing deficit case (warn-first default exit 0)..."
write_signals '{"playbook_no_match": 2, "adjudication_unvalidatable": 1}'
out_deficit_warn=$(node "$WRAPPER" --project "$PROJECT_NAME" --signals "$SIGNALS_FILE" 2>&1)
assert_exit_code "$?" 0 "deficit warn-first exits 0 by default"
assert_contains "$out_deficit_warn" "[WARNING] Escalation coverage deficits detected" "contains deficit warning"
assert_contains "$out_deficit_warn" "Point 'playbook_no_match' has a deficit of 1" "names the deficit point"

# 6. Deficit case with --gate -> exit 1
echo "Testing deficit case with --gate (exit 1)..."
out_deficit_gate=$(node "$WRAPPER" --project "$PROJECT_NAME" --signals "$SIGNALS_FILE" --gate 2>&1)
assert_exit_code "$?" 1 "deficit with --gate exits 1"
assert_contains "$out_deficit_gate" "[ERROR] Gate failure: coverage deficits found" "contains gate failure message"

# 7. No signals file -> informational exit 0 (should report event counts only)
echo "Testing no signals file..."
out_no_signals=$(node "$WRAPPER" --project "$PROJECT_NAME")
assert_exit_code "$?" 0 "no signals file exits 0"
assert_contains "$out_no_signals" "No signals file provided. Running in informational mode" "indicates informational mode"
assert_contains "$out_no_signals" "playbook_no_match: 1" "reports correct count for playbook_no_match"
assert_contains "$out_no_signals" "adjudication_unvalidatable: 1" "reports correct count for adjudication_unvalidatable"

# 8. Malformed line tolerated with loud warning, never a crash
echo "Testing malformed lines in events.jsonl..."
write_events \
  '{"type":"escalation_opened","point":"playbook_no_match"}' \
  '{"invalid_json' \
  '{"type":"escalation_opened","point":"adjudication_unvalidatable"}'

out_malformed=$(node "$WRAPPER" --project "$PROJECT_NAME" --signals "$SIGNALS_FILE" 2>&1)
assert_exit_code "$?" 0 "tolerates malformed lines with exit 0"
assert_contains "$out_malformed" "Warning: malformed events.jsonl line 2" "contains warning about line 2"
# and the 2 valid events should still be counted
assert_contains "$out_malformed" "adjudication_unvalidatable: expected 1, actual 1" "counted second event"

# 9. Test fallback path (docs/projects/_archive/<name>/tree/events.jsonl)
echo "Testing fallback project path..."
ARCHIVE_DIR="$TEST_TMP/docs/projects/_archive/$PROJECT_NAME"
mkdir -p "$ARCHIVE_DIR/tree"
# Remove active project directory to force fallback
rm -rf "$PROJECT_DIR"

# Write events.jsonl to archive path
printf "%s\n" '{"type":"escalation_opened","point":"playbook_no_match"}' > "$ARCHIVE_DIR/tree/events.jsonl"
out_fallback=$(node "$WRAPPER" --project "$PROJECT_NAME")
assert_exit_code "$?" 0 "fallback path check exits 0"
assert_contains "$out_fallback" "playbook_no_match: 1" "reads from fallback path successfully"

finalize_test
