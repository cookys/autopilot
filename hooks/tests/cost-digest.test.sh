#!/usr/bin/env bash
# hooks/tests/cost-digest.test.sh — tests for scripts/cost-digest.js
. "$(dirname "$0")/lib.sh"

DIGEST_SCRIPT="$REPO_ROOT/scripts/cost-digest.js"
FIXTURE_DIR="$TEST_TMP/fixture"
mkdir -p "$FIXTURE_DIR"
FIXTURE_FILE="$FIXTURE_DIR/costs.jsonl"

TODAY_UTC="$(node -e 'process.stdout.write(new Date().toISOString().slice(0, 10))')"
DAY1="2026-08-01"
DAY2="2026-08-02"

# Write synthetic ledger JSONL:
# - 3 distinct UTC days: $DAY1, $DAY2, $TODAY_UTC
# - 3 models: fable-model (brain), claude-sonnet-4-5 (hands), haiku-3-5 (hands-cheap)
# - 2 distinct session ids: sess-1, sess-2
# - 1 malformed line: not valid json
# - at least one row stamped with today's UTC date

cat > "$FIXTURE_FILE" <<JSONL
{"ts":"${DAY1}T10:00:00.000Z","session":"sess-1-alpha","model":"fable-model-v1","turns":2,"cost_usd":0.5000,"cwd":"/app"}
{"ts":"${DAY1}T11:00:00.000Z","session":"sess-2-beta","model":"claude-sonnet-4-5","turns":3,"cost_usd":0.5000,"cwd":"/app"}
not valid json at all!
{"ts":"${DAY2}T12:00:00.000Z","session":"sess-1-alpha","model":"haiku-3-5-flash","turns":1,"cost_usd":0.1000,"cwd":"/app"}
{"ts":"${TODAY_UTC}T08:00:00.000Z","session":"sess-2-beta","model":"mythos-brain-model","turns":4,"cost_usd":2.0000,"cwd":"/app"}
JSONL

# Test (a): --json output day totals and brain_share match hand-computed values
# For $DAY1:
# Total = 1.0000, Brain = 0.5000, Brain Share = 0.5 (50.00%)
JSON_OUT="$(node "$DIGEST_SCRIPT" --file "$FIXTURE_FILE" --since 100 --json)"
assert_exit_code "$?" "0" "digest with --json exits 0"

DAY1_TOTAL="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  process.stdout.write(day ? String(day.total_usd) : "missing");
' "$JSON_OUT" "$DAY1")"
assert_eq "$DAY1_TOTAL" "1" "DAY1 total_usd matches 1"

DAY1_BRAIN_SHARE="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  process.stdout.write(day ? String(Math.round(day.brain_share * 100)) : "missing");
' "$JSON_OUT" "$DAY1")"
assert_eq "$DAY1_BRAIN_SHARE" "50" "DAY1 brain_share matches 50%"

# Test (b): skipped_lines == 1
SKIPPED_LINES="$(node -e '
  const data = JSON.parse(process.argv[1]);
  process.stdout.write(String(data.skipped_lines));
' "$JSON_OUT")"
assert_eq "$SKIPPED_LINES" "1" "skipped_lines is exactly 1"

# Test (c): --today --file <fixture> returns only the row(s) stamped today
TODAY_OUT="$(node "$DIGEST_SCRIPT" --file "$FIXTURE_FILE" --today --json)"
assert_exit_code "$?" "0" "--today exits 0"

DAYS_COUNT="$(node -e '
  const data = JSON.parse(process.argv[1]);
  process.stdout.write(String(data.days.length));
' "$TODAY_OUT")"
assert_eq "$DAYS_COUNT" "1" "--today returns exactly one day"

RETURNED_DAY="$(node -e '
  const data = JSON.parse(process.argv[1]);
  process.stdout.write(data.days[0] ? data.days[0].day : "");
' "$TODAY_OUT")"
assert_eq "$RETURNED_DAY" "$TODAY_UTC" "--today returned day matches today's UTC date"

# Test (d): pointing --file at a nonexistent path -> exit 0, --json has "days":[] and something is printed to stderr
NONEXISTENT_STDERR="$TEST_TMP/nonexistent.stderr"
NONEXISTENT_OUT="$(node "$DIGEST_SCRIPT" --file "$FIXTURE_DIR/nonexistent.jsonl" --json 2>"$NONEXISTENT_STDERR")"
NONEXISTENT_EXIT="$?"
assert_exit_code "$NONEXISTENT_EXIT" "0" "nonexistent file exits 0"
assert_contains "$NONEXISTENT_OUT" '"days": []' "nonexistent file JSON contains empty days array"
STDERR_CONTENT="$(cat "$NONEXISTENT_STDERR")"
if [ -n "$STDERR_CONTENT" ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "stderr should not be empty for nonexistent file"
fi

# Test (e): negative control: mutate one cost_usd value in the fixture, rerun, assert computed total changes
MUTATED_FILE="$FIXTURE_DIR/mutated.jsonl"
sed 's/"cost_usd":0.5000/"cost_usd":0.9999/' "$FIXTURE_FILE" > "$MUTATED_FILE"

MUTATED_JSON="$(node "$DIGEST_SCRIPT" --file "$MUTATED_FILE" --since 100 --json)"
MUTATED_DAY1_TOTAL="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  process.stdout.write(day ? String(day.total_usd) : "missing");
' "$MUTATED_JSON" "$DAY1")"
assert_neq "$MUTATED_DAY1_TOTAL" "$DAY1_TOTAL" "mutated cost_usd changes computed total"

# Test tierOf export directly
TIEROF_TEST="$(node -e '
  const { tierOf } = require(process.argv[1]);
  const results = [
    tierOf("fable-3"),
    tierOf("mythos-preview"),
    tierOf("claude-opus-4"),
    tierOf("claude-sonnet-3-5"),
    tierOf("claude-haiku-3-5"),
    tierOf("other-gpt-4o")
  ];
  process.stdout.write(results.join(","));
' "$DIGEST_SCRIPT")"
assert_eq "$TIEROF_TEST" "brain,brain,brain,hands,hands-cheap,other" "tierOf export correctly classifies models"

finalize_test
