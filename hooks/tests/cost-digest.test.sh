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

# Test (f): --by session grouping does not merge distinct sessions sharing an
# 8-char prefix, in BOTH text and --json modes; a session that used two models
# aggregates its cost/turns across both rows.
SESSION_FIXTURE="$FIXTURE_DIR/sessions.jsonl"
cat > "$SESSION_FIXTURE" <<JSONL
{"ts":"${DAY1}T09:00:00.000Z","session":"abcdefgh-one","model":"claude-sonnet-4-5","turns":1,"cost_usd":1.0000,"cwd":"/app"}
{"ts":"${DAY1}T09:30:00.000Z","session":"abcdefgh-two","model":"claude-sonnet-4-5","turns":1,"cost_usd":1.0000,"cwd":"/app"}
{"ts":"${DAY1}T10:00:00.000Z","session":"multi-model-session","model":"claude-sonnet-4-5","turns":1,"cost_usd":0.5000,"cwd":"/app"}
{"ts":"${DAY1}T10:30:00.000Z","session":"multi-model-session","model":"claude-haiku-3-5","turns":1,"cost_usd":0.2500,"cwd":"/app"}
JSONL

SESSION_JSON_OUT="$(node "$DIGEST_SCRIPT" --file "$SESSION_FIXTURE" --since 100 --by session --json)"
assert_exit_code "$?" "0" "digest --by session --json exits 0"

SESSION_JSON_BY="$(node -e '
  const data = JSON.parse(process.argv[1]);
  process.stdout.write(String(data.by));
' "$SESSION_JSON_OUT")"
assert_eq "$SESSION_JSON_BY" "session" "--json honours --by session (top-level by field)"

SESSION_JSON_ROWS_COUNT="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  process.stdout.write(day ? String(day.rows.length) : "missing");
' "$SESSION_JSON_OUT" "$DAY1")"
assert_eq "$SESSION_JSON_ROWS_COUNT" "3" "--json --by session keeps the two 8-char-prefix-sharing sessions distinct (3 rows total)"

SESSION_JSON_PREFIX_SESSIONS="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  const sessions = day.rows.map(r => r.session).filter(s => s.startsWith("abcdefgh")).sort();
  process.stdout.write(sessions.join(","));
' "$SESSION_JSON_OUT" "$DAY1")"
assert_eq "$SESSION_JSON_PREFIX_SESSIONS" "abcdefgh-one,abcdefgh-two" "--json --by session emits full untruncated session ids, not merged"

SESSION_JSON_MULTI_MODEL_COST="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  const row = day.rows.find(r => r.session === "multi-model-session");
  process.stdout.write(row ? String(row.cost_usd) : "missing");
' "$SESSION_JSON_OUT" "$DAY1")"
assert_eq "$SESSION_JSON_MULTI_MODEL_COST" "0.75" "--json --by session aggregates cost across a session's two models"

SESSION_JSON_MULTI_MODEL_MODELS="$(node -e '
  const data = JSON.parse(process.argv[1]);
  const day = data.days.find(d => d.day === process.argv[2]);
  const row = day.rows.find(r => r.session === "multi-model-session");
  process.stdout.write(row ? row.models.sort().join(",") : "missing");
' "$SESSION_JSON_OUT" "$DAY1")"
assert_eq "$SESSION_JSON_MULTI_MODEL_MODELS" "claude-haiku-3-5,claude-sonnet-4-5" "--json --by session lists both models a session used"

SESSION_TEXT_OUT="$(node "$DIGEST_SCRIPT" --file "$SESSION_FIXTURE" --since 100 --by session)"
assert_exit_code "$?" "0" "digest --by session (text) exits 0"

SESSION_TEXT_DISTINCT_ROWS="$(node -e '
  const text = process.argv[1];
  const lines = text.split("\n").filter(l => l.startsWith(process.argv[2]));
  process.stdout.write(String(lines.length));
' "$SESSION_TEXT_OUT" "$DAY1")"
assert_eq "$SESSION_TEXT_DISTINCT_ROWS" "3" "text --by session keeps the 8-char-prefix sessions on separate rows"

finalize_test
