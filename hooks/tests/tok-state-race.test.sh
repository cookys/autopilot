#!/usr/bin/env bash
# Per-session context-budget state file: two hooks (context-budget.js, state-checkpoint.js PostCompact arm)
# read-modify-write it. (a) concurrent writers must not lose an update; lock failure fails open (exit 0);
# (b) the first live total after PostCompact ignores a value written before the compaction;
# (c) the config file is parsed once per context-budget run.
. "$(dirname "$0")/lib.sh"

SID="tok-race"
TRANSCRIPT="$TEST_TMP/t.jsonl"
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":1}}}' > "$TRANSCRIPT"
export AUTOPILOT_CONTEXT_BUDGET_T1=1000000
export AUTOPILOT_CONTEXT_BUDGET_T2=2000000
STATE="$AUTOPILOT_LIVE_DIR/context-budget/${SID}.json"

budget() {
  local payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({session_id:process.argv[1],transcript_path:process.argv[2],cwd:process.argv[3]}))' "$SID" "$TRANSCRIPT" "$TEST_TMP")"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/context-budget.js" >"$TEST_TMP/.cb.out" 2>"$TEST_TMP/.cb.err" <<< "$payload"
  CB_EXIT=$?
}
post_compact() {
  local payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({session_id:process.argv[1],hook_event_name:"PostCompact",trigger:"auto",compact_summary:"x",cwd:process.argv[2],transcript_path:process.argv[3]}))' "$SID" "$TEST_TMP" "$TRANSCRIPT")"
  HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
    node "$HOOKS_DIR/state-checkpoint.js" >/dev/null 2>&1 <<< "$payload"
}
field() { node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s[process.argv[2]]))}catch{process.stdout.write("none")}' "$STATE" "$1"; }

# (a) concurrent writers lose no update.
rm -rf "$AUTOPILOT_LIVE_DIR/context-budget"
budget   # seed the file
N=6
for _ in $(seq "$N"); do ( budget ) & ( post_compact ) & done
wait
assert_eq "$(field calls)" "$((N + 1))" "all $((N + 1)) context-budget increments survive concurrency"
assert_eq "$(field postCompactGen)" "$N" "all $N PostCompact arms survive concurrency"

# (a) lock acquisition failure fails open.
sleep 30 & HOLDER=$!
printf '%s' "$HOLDER" > "${STATE}.lock"
budget
assert_exit_code "$CB_EXIT" 0 "context-budget exits 0 when the state lock is held"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
rm -f "${STATE}.lock"

# (c) config parsed once per run.
mkdir -p "$HOOK_HOME/.autopilot"
printf '%s' '{"context_budget":{"seat":"session"}}' > "$HOOK_HOME/.autopilot/config.json"
export AUTOPILOT_CONFIG_PARSE_COUNT_FILE="$TEST_TMP/parse-count"
rm -f "$AUTOPILOT_CONFIG_PARSE_COUNT_FILE"
budget
assert_eq "$(wc -l < "$AUTOPILOT_CONFIG_PARSE_COUNT_FILE" 2>/dev/null | tr -d ' ')" "1" "config parsed exactly once"
unset AUTOPILOT_CONFIG_PARSE_COUNT_FILE
rm -f "$HOOK_HOME/.autopilot/config.json"

# (b) a live value written before the compaction is ignored; a later one is recorded.
rm -rf "$AUTOPILOT_LIVE_DIR/context-budget"
write_live() {
  mkdir -p "$AUTOPILOT_LIVE_DIR/context"
  node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({schema_version:1,session_id:process.argv[2],written_at:new Date().toISOString(),writer:"statusline",model:{},context_window:{context_window_size:200000,used_percentage:1,total_input_tokens:Number(process.argv[3])}}))' "$AUTOPILOT_LIVE_DIR/context/${SID}.json" "$SID" "$1"
}
write_live 150000
sleep 0.05
post_compact
budget
assert_eq "$(field postCompactSeen)" "undefined" "pre-compaction live value is not measured"
sleep 0.05
write_live 60000
budget
assert_eq "$(field postCompactTokens)" "60000" "first post-compaction live value is measured"

finalize_test
