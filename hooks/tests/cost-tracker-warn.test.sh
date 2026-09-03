#!/usr/bin/env bash
# cost-tracker.js — default-on since v2.35.15; cumulative cache-read warning (threshold,
# doubling watermark preserved across consecutive Stops), opt-out, fail-open.
. "$(dirname "$0")/lib.sh"

TR="$TEST_TMP/transcript.jsonl"
turn() { # <cache_read> <input> <output>
  printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":0}}}\n' "$2" "$3" "$1"
}
payload() { printf '{"session_id":"ct-warn-session","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TR" "$TEST_TMP"; }
METRICS="$HOOK_HOME/.claude/metrics"
export AUTOPILOT_COST_TRACKER_CACHE_READ_WARN=1000

# ── 1. default-on: rows land without any enable flag; below threshold → no warning ──
unset AUTOPILOT_HOOK_COST_TRACKER AUTOPILOT_COST_TRACKER
turn 400 10 5 > "$TR"
run_hook cost-tracker.js "$(payload)"
assert_eq 0 "$__RUN_EXIT" "stop 1 exit 0"
assert_file_exists "$METRICS/costs.jsonl" "costs.jsonl written without an enable flag (default-on)"
assert_eq "" "$__RUN_STDERR" "below threshold: no warning"

# ── 2. crossing the threshold warns once; the next Stop below the doubling stays quiet ──
{ turn 400 10 5; turn 700 10 5; } > "$TR"          # cumulative 1,100 ≥ 1,000
run_hook cost-tracker.js "$(payload)"
assert_contains "$__RUN_STDERR" 'cost-tracker: session ct-warn-session has read 1,100 cache tokens' "threshold crossing warns with the cumulative total"
assert_contains "$__RUN_STDERR" 'threshold 1,000' "warning names the threshold"
CUR="$(cat "$HOOK_HOME/.claude/metrics/.cursors/ct-warn-session.json")"
assert_contains "$CUR" '"cache_read_warned":1000' "watermark recorded in the cursor"
assert_contains "$CUR" '"turns":2' "turns cursor still advanced"
{ turn 400 10 5; turn 700 10 5; turn 300 10 5; } > "$TR"   # cumulative 1,400 < 2,000
run_hook cost-tracker.js "$(payload)"
assert_eq "" "$__RUN_STDERR" "next Stop below the doubling: no repeat warning (watermark preserved across the ordinary cursor write)"
CUR="$(cat "$HOOK_HOME/.claude/metrics/.cursors/ct-warn-session.json")"
assert_contains "$CUR" '"cache_read_warned":1000' "watermark survives the ordinary cursor update"
assert_contains "$CUR" '"turns":3' "turns cursor advanced to 3"

# ── 3. the doubling warns again, and a multi-doubling jump lands on the right rung ──
{ turn 400 10 5; turn 700 10 5; turn 300 10 5; turn 3000 10 5; } > "$TR"   # 4,400 ≥ 2,000 (and ≥ 4,000)
run_hook cost-tracker.js "$(payload)"
assert_contains "$__RUN_STDERR" 'read 4,400 cache tokens' "doubling crossed: warns again"
assert_contains "$__RUN_STDERR" 'threshold 4,000' "watermark jumps to the highest crossed rung"
CUR="$(cat "$HOOK_HOME/.claude/metrics/.cursors/ct-warn-session.json")"
assert_contains "$CUR" '"cache_read_warned":4000' "watermark at 4,000"

# ── 4. opt-out env silences everything; garbage payload is fail-open ──
AUTOPILOT_COST_TRACKER=false run_hook cost-tracker.js "$(payload)"
assert_eq 0 "$__RUN_EXIT" "opt-out exit 0"
assert_eq "" "$__RUN_STDERR" "opt-out: silent"
run_hook cost-tracker.js '{not json'
assert_eq 0 "$__RUN_EXIT" "garbage payload exit 0 (fail-open)"

finalize_test
