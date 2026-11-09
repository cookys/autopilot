#!/usr/bin/env bash
# Profile ledger regression: sandbox HOME, with a separate CLAUDE_CONFIG_DIR.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_COSTS_FILE
PROFILE="$TEST_TMP/profile"
TR="$TEST_TMP/transcript.jsonl"
mkdir -p "$PROFILE"
printf '%s\n' '{"type":"assistant","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-6","usage":{"input_tokens":10,"output_tokens":7}}}' > "$TR"
payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop"}' "$1" "$TR"; }

CLAUDE_CONFIG_DIR="$PROFILE" run_hook cost-tracker.js "$(payload profile-session)"
assert_eq "$__RUN_EXIT" 0 "profile tracker exits 0"
assert_file_exists "$PROFILE/metrics/costs.jsonl" "profile tracker writes ledger"
assert_file_exists "$PROFILE/metrics/.cursors/profile-session.json" "profile tracker writes cursor"
assert_file_absent "$HOOK_HOME/.claude/metrics" "profile tracker leaves HOME metrics untouched"

# Unset and empty both retain the home profile. The writer never supported a file override.
for mode in unset empty; do
  if [ "$mode" = empty ]; then export CLAUDE_CONFIG_DIR=''; else unset CLAUDE_CONFIG_DIR; fi
  AUTOPILOT_COSTS_FILE="$TEST_TMP/unused.jsonl" run_hook cost-tracker.js "$(payload "$mode-session")"
  assert_file_exists "$HOOK_HOME/.claude/metrics/costs.jsonl" "$mode profile writes home ledger"
  assert_file_exists "$HOOK_HOME/.claude/metrics/.cursors/$mode-session.json" "$mode profile writes home cursor"
  assert_file_absent "$TEST_TMP/unused.jsonl" "$mode tracker retains no file override"
done

# Distinct ledgers make fallback/merged reads observable, including in the watcher.
TODAY="$(node -e 'process.stdout.write(new Date().toISOString())')"
write_ledger() { printf '{"ts":"%s","session":"reader-session","model":"claude-opus-4-6","cost_usd":%s}\n' "$TODAY" "$2" > "$1"; }
write_ledger "$PROFILE/metrics/costs.jsonl" 200
write_ledger "$HOOK_HOME/.claude/metrics/costs.jsonl" 1
write_ledger "$TEST_TMP/override.jsonl" 3
export CLAUDE_CONFIG_DIR="$PROFILE"
export AUTOPILOT_COST_FUSE_MODE=block AUTOPILOT_COST_FUSE_DAILY_USD=150
FUSE_PAYLOAD="$(printf '{"session_id":"reader-session","transcript_path":"%s","tool_name":"Edit","tool_input":{},"hook_event_name":"PreToolUse"}' "$TR")"
run_hook cost-fuse.js "$FUSE_PAYLOAD"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "fuse reads profile spend"

check_readers() {
  local expected_file="$1" expected_spend="$2" label="$3" out
  out="$(node "$REPO_ROOT/scripts/cost-digest.js" --today --json)"
  assert_eq "$?" 0 "$label digest exits 0"
  assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).file)' "$out")" "$expected_file" "$label digest ledger path"
  assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).days[0]?.total_usd))' "$out")" "$expected_spend" "$label digest spend"
  out="$(node - "$REPO_ROOT" <<'NODE'
const root = process.argv[2];
const { costsFileOf, sumTodayTierSpend } = require(root + '/scripts/lib/brain-spend.js');
const { createCostReader } = require(root + '/src/status/runs-watch.js');
const file = costsFileOf();
console.log(sumTodayTierSpend(file, new Set(['brain'])));
console.log(createCostReader(process.env).summary(Date.now(), new Set()).host_today_usd);
NODE
)"
  assert_eq "$out" "$(printf '%s\n%s' "$expected_spend" "$expected_spend")" "$label brain and watcher spend"
}
check_readers "$PROFILE/metrics/costs.jsonl" 200 profile

export AUTOPILOT_COSTS_FILE="$TEST_TMP/override.jsonl"
run_hook cost-fuse.js "$FUSE_PAYLOAD"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "fuse file override beats profile"
check_readers "$AUTOPILOT_COSTS_FILE" 3 override
unset AUTOPILOT_COSTS_FILE
for mode in unset empty; do
  if [ "$mode" = empty ]; then export CLAUDE_CONFIG_DIR=''; else unset CLAUDE_CONFIG_DIR; fi
  check_readers "$HOOK_HOME/.claude/metrics/costs.jsonl" 1 "$mode"
done

finalize_test
