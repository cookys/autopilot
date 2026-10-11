#!/usr/bin/env bash
# cost-tracker.js — (1) one API response written as several transcript lines is counted ONCE
# (dedup by message.id + requestId); (2) subagent turns, which live in
# <transcript minus .jsonl>/subagents/agent-<id>.jsonl, reach the ledger as sidechain rows with
# their own cursor (no double-count on the next Stop); (3) rows with no message.id still count.
. "$(dirname "$0")/lib.sh"

TR="$TEST_TMP/transcript.jsonl"
SUBDIR="$TEST_TMP/transcript/subagents"
METRICS="$HOOK_HOME/.claude/metrics"
LEDGER="$METRICS/costs.jsonl"
payload() { printf '{"session_id":"ct-sub-session","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TR" "$TEST_TMP"; }
# line <message.id> <requestId> <input> <cache_read> <cache_write> [extra top-level json]
line() {
  printf '{"type":"assistant"%s,"requestId":"%s","message":{"id":"%s","model":"claude-sonnet-5","usage":{"input_tokens":%s,"output_tokens":7,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' "${6:-}" "$2" "$1" "$3" "$4" "$5"
}
sum_field() { # <field> <jq-ish node filter on row> -> sum over ledger rows
  node -e '
    const rows = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
    const f = process.argv[2]; const want = process.argv[3];
    const sel = rows.filter((r) => want === "all" ? true : want === "sub" ? r.sidechain === true : r.sidechain !== true);
    process.stdout.write(String(sel.reduce((a, r) => a + (r[f] || 0), 0)));
  ' "$LEDGER" "$1" "$2"
}

# ── 1. dedup: m1 is written as THREE lines (identical usage), m2 as one → 2 turns, usage once ──
{ line m1 r1 10 1000 500; line m1 r1 10 1000 500; line m1 r1 10 1000 500; line m2 r2 20 2000 300; } > "$TR"
run_hook cost-tracker.js "$(payload)"
assert_eq 0 "$__RUN_EXIT" "stop 1 exit 0"
assert_eq 2 "$(sum_field turns main)" "3 lines of one response + 1 other = 2 turns (not 4)"
assert_eq 3000 "$(sum_field cache_read_tokens main)" "cache_read counted once per response (1000 + 2000)"
assert_eq 800 "$(sum_field cache_write_tokens main)" "cache_write counted once per response (500 + 300)"
CUR="$(cat "$METRICS/.cursors/ct-sub-session.json")"
assert_contains "$CUR" '"turns":2' "cursor counts deduped turns"

# ── 2. a later Stop with one more duplicate line of m2 adds nothing ──
line m2 r2 20 2000 300 >> "$TR"
run_hook cost-tracker.js "$(payload)"
assert_eq 3000 "$(sum_field cache_read_tokens main)" "duplicate line appended later does not add usage"

# ── 3. a line with no message.id cannot be keyed → still counts as its own turn (old-shape transcripts) ──
printf '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":50,"cache_creation_input_tokens":0}}}\n' >> "$TR"
run_hook cost-tracker.js "$(payload)"
assert_eq 3050 "$(sum_field cache_read_tokens main)" "id-less line counts"

# ── 4. subagent files: sidechain rows, separate from main, flagged with agent_id ──
mkdir -p "$SUBDIR"
{ line s1 q1 5 4000 900 ',"isSidechain":true,"agentId":"aaa111"'; line s1 q1 5 4000 900 ',"isSidechain":true,"agentId":"aaa111"'; line s2 q2 5 6000 100 ',"isSidechain":true,"agentId":"aaa111"'; } > "$SUBDIR/agent-aaa111.jsonl"
printf '%s\n' '{"not":"a meta"}' > "$SUBDIR/agent-aaa111.meta.json"
run_hook cost-tracker.js "$(payload)"
assert_eq 0 "$__RUN_EXIT" "stop with subagent files exit 0"
assert_eq 1000 "$(sum_field cache_write_tokens sub)" "subagent cache_write counted once per response (900 + 100)"
assert_eq 10000 "$(sum_field cache_read_tokens sub)" "subagent cache_read (4000 + 6000)"
assert_eq 2 "$(sum_field turns sub)" "subagent turns deduped"
assert_eq 800 "$(sum_field cache_write_tokens main)" "main rows unchanged by the subagent pass"
assert_contains "$(grep sidechain "$LEDGER" | head -1)" '"agent_id":"aaa111"' "subagent row carries agent_id"
assert_not_contains "$(grep -v sidechain "$LEDGER" | head -1)" 'agent_id' "main row has no agent fields (old shape preserved)"

# ── 5. next Stop with nothing new: no double-count of the subagent file ──
run_hook cost-tracker.js "$(payload)"
assert_eq 1000 "$(sum_field cache_write_tokens sub)" "second Stop does not re-log subagent turns"
# a new subagent turn is picked up, only the new one
line s3 q3 5 100 40 ',"isSidechain":true,"agentId":"aaa111"' >> "$SUBDIR/agent-aaa111.jsonl"
run_hook cost-tracker.js "$(payload)"
assert_eq 1040 "$(sum_field cache_write_tokens sub)" "only the new subagent turn is added"
CUR="$(cat "$METRICS/.cursors/ct-sub-session.json")"
assert_contains "$CUR" '"agents":{"aaa111":3}' "per-agent cursor recorded"

# ── 6. missing subagents dir → no error, no sidechain rows ──
rm -rf "$TEST_TMP/transcript"
{ line z1 w1 1 10 5; } > "$TR"
payload2() { printf '{"session_id":"ct-sub-session-2","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TR" "$TEST_TMP"; }
run_hook cost-tracker.js "$(payload2)"
assert_eq 0 "$__RUN_EXIT" "no subagents dir: exit 0"
assert_eq "" "$__RUN_STDERR" "no subagents dir: silent"

finalize_test
