#!/usr/bin/env bash
# Test for hooks/subagent-budget.js - per-lane relay and turn ceilings on Agent dispatch (plan
# docs/plans/2026-10-18-subagent-budget-gate.md, KR1-KR7). Everything lives under TEST_TMP: HOME,
# the live-state dir (AUTOPILOT_LIVE_DIR from lib.sh), the panel store and the decision ledger
# (both under the scratch repo's .git), fixture transcripts. The clock is injected.
. "$(dirname "$0")/lib.sh"

FIX="$HOOKS_DIR/tests/lib/subagent-budget-fixture.js"
NOW=1790000000000
export AUTOPILOT_SUBAGENT_BUDGET_NOW_MS=$NOW
unset AUTOPILOT_SUBAGENT_BUDGET_MODE AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX AUTOPILOT_SUBAGENT_BUDGET_LANE_TURNS_MAX AUTOPILOT_SUBAGENT_BUDGET_ROOT_TURNS_PER_HOUR_MAX
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

REPO="$TEST_TMP/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q 2>/dev/null
PROJ="$TEST_TMP/claude/projects/p"; mkdir -p "$PROJ"
LEDGER="$REPO/.git/autopilot/ledger/decisions.jsonl"
DECDIR="$REPO/.git/autopilot/decisions"
HOOK=subagent-budget.js

# mk <session> '<agents json>'
mk() { node "$FIX" "$PROJ" "$1" "$NOW" "$2"; }
# agents <n> <lane-prefix-or-same> : n agents with `Lane: <lane>` and 1 turn each
same_lane() { node -e 'const [n,lane,extra]=process.argv.slice(1);const a=[];for(let i=0;i<+n;i++)a.push(Object.assign({id:`${lane}-${i}`,brief:[`Lane: ${lane}`],turns:1},JSON.parse(extra||"{}")));console.log(JSON.stringify(a))' "$1" "$2" "${3:-}"; }
# payload <session> <prompt-with-\n-escapes> [description] [transcript-session-dir-override]
payload() {
  node -e '
    const [sid,prompt,desc,tp]=process.argv.slice(1);
    const p={tool_name:"Agent",session_id:sid,cwd:process.argv[6],tool_input:{prompt:prompt.replace(/\\n/g,"\n"),model:"sonnet"}};
    if(desc) p.tool_input.description=desc;
    if(tp!=="NONE") p.transcript_path=tp||process.argv[5]+"/"+sid+".jsonl";
    console.log(JSON.stringify(p));
  ' "$1" "$2" "${3:-}" "${4:-}" "$PROJ" "$REPO"
}
fire() { run_hook "$HOOK" "$(payload "$@")"; }
expect_deny() { fire "$1" "$2" "${3:-}"; assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "${4:-}: denied"; }
expect_allow() { fire "$1" "$2" "${3:-}"; assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "${4:-}: not denied"; assert_eq 0 "$__RUN_EXIT" "${4:-}: exit 0"; }
expect_silent() { assert_eq 0 "$__RUN_EXIT" "$1: exit 0"; assert_eq "" "$__RUN_STDOUT" "$1: no stdout"; }
cards() { node -e 'const fs=require("fs");const d=process.argv[1];let n=0;try{for(const f of fs.readdirSync(d)){if(!f.endsWith(".json"))continue;n+=JSON.parse(fs.readFileSync(d+"/"+f,"utf8")).decisions.length}}catch{}console.log(n)' "$DECDIR"; }
ledger_rows() { [ -f "$LEDGER" ] && wc -l <"$LEDGER" | tr -d ' ' || echo 0; }

# ---- KR1: the 5th dispatch of a lane is denied, with and without a session-mode marker ----------------------------
mk s1 "$(same_lane 4 alpha)"
expect_deny s1 'Engine: sonnet\nLane: alpha\ngo' "" "KR1 5th dispatch, no marker"
assert_contains "$__RUN_STDOUT" "lane_dispatch_max 4" "KR1 reason names the ceiling"
assert_contains "$__RUN_STDOUT" "Budget-Ack:" "KR1 reason names the ack line"
assert_contains "$__RUN_STDOUT" "panel card d-" "KR1 reason names the card"
printf '{"session_id":"s1m","level":"l5","expires_at":"2099-01-01T00:00:00Z"}' >"$AUTOPILOT_SESSION_MODE_DIR/s1m.json"
mk s1m "$(same_lane 4 alpha)"
expect_deny s1m 'Engine: sonnet\nLane: alpha\ngo' "" "KR1 5th dispatch, marker present"
mk s1b "$(same_lane 3 alpha)"
expect_allow s1b 'Engine: sonnet\nLane: alpha\ngo' "" "KR1 4th dispatch allowed"
# lane key: the Lane: line, not the description
mk s1c '[{"id":"a1","brief":["Lane: alpha"],"description":"one"},{"id":"a2","brief":["Lane: alpha"],"description":"two"},{"id":"a3","brief":["Lane: alpha"],"description":"three"},{"id":"a4","brief":["Lane: alpha"],"description":"four"}]'
expect_deny s1c 'Engine: sonnet\nLane: alpha\ngo' "unrelated words" "KR1 Lane: line keys the lane over description"
# description fallback, first line, trimmed, lower-cased (agent side reads meta.json description)
mk s1d '[{"id":"a1","description":"Fix Loader"},{"id":"a2","description":"fix loader"},{"id":"a3","description":"FIX LOADER  "},{"id":"a4","description":"fix loader"}]'
expect_deny s1d 'Engine: sonnet\ngo' "  Fix Loader
second line" "description fallback lane"
# malformed Lane: line falls back to description; a Lane: quoted later in the brief never matches
expect_deny s1d 'Engine: sonnet\nLane: bad lane!\ngo' "fix loader" "malformed Lane: falls back to description"
expect_allow s1d 'Engine: sonnet\n1\n2\n3\nLane: other\ngo' "unrelated" "Lane: on line 5 is read"
expect_allow s1d 'Engine: sonnet\n1\n2\n3\n4\nLane: fix-loader-quoted\ngo' "" "Lane: on line 6 never matches, no description => no lane"
# a dispatch with no lane counts only toward the root total
expect_allow s1d 'Engine: sonnet\ngo' "" "no lane allowed"

# ---- reviewers are excluded from the relay count (their turns still count) -----------------------------------------
mk s2 "$(node -e 'console.log(JSON.stringify([0,1,2].map(i=>({id:"i"+i,brief:["Lane: rev"]})).concat([3,4].map(i=>({id:"r"+i,brief:["Lane: rev","Role: reviewer"]})))))')"
expect_allow s2 'Engine: sonnet\nLane: rev\ngo' "" "reviewer: 3 implementers + 2 reviewers, new implementer allowed"
mk s2b "$(node -e 'console.log(JSON.stringify([0,1,2,3].map(i=>({id:"i"+i,brief:["Lane: rev"]}))))')"
expect_allow s2b 'Engine: sonnet\nRole: reviewer\nLane: rev\ngo' "" "reviewer dispatch is not counted against the relay ceiling"
expect_deny s2b 'Engine: sonnet\nLane: rev\ngo' "" "4 implementers deny a 5th implementer"
mk s2c '[{"id":"r1","brief":["Lane: rev2","Role: reviewer"],"turns":300}]'
expect_deny s2c 'Engine: sonnet\nLane: rev2\ngo' "" "reviewer turns count toward the lane turn total"

# ---- KR2: lane turns 299 / 300; root hour 399 / 400 -----------------------------------------------------------------
mk s3a '[{"id":"t1","brief":["Lane: big"],"turns":299}]'
expect_allow s3a 'Engine: sonnet\nLane: big\ngo' "" "KR2 lane turns 299"
mk s3b '[{"id":"t1","brief":["Lane: big"],"turns":300}]'
expect_deny s3b 'Engine: sonnet\nLane: big\ngo' "" "KR2 lane turns 300"
assert_contains "$__RUN_STDOUT" "lane_turns_max 300" "KR2 reason names lane_turns_max"
root_spread() { node -e 'const [total,age,extra]=process.argv.slice(1);const a=[];let left=+total,i=0;while(left>0){const n=Math.min(100,left);a.push(Object.assign({id:"g"+i,brief:["Lane: g"+i],turns:n,ageMs:+age},JSON.parse(extra||"{}")));left-=n;i++}console.log(JSON.stringify(a))' "$@"; }
mk s4a "$(root_spread 399 60000)"
expect_allow s4a 'Engine: sonnet\nLane: fresh\ngo' "" "KR2 root hour 399"
mk s4b "$(root_spread 400 60000)"
expect_deny s4b 'Engine: sonnet\nLane: fresh\ngo' "" "KR2 root hour 400"
assert_contains "$__RUN_STDOUT" "root_turns_per_hour_max 400" "KR2 reason names root_turns_per_hour_max"
# window boundary: a turn exactly 60 min old is outside; one ms younger is inside; a future ts counts
mk s4c "$(root_spread 399 60000 | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));a.push({id:"edge",brief:["Lane: edge"],turns:1,ageMs:3600000});console.log(JSON.stringify(a))')"
expect_allow s4c 'Engine: sonnet\nLane: fresh\ngo' "" "window: exactly 60 min old is not counted"
mk s4d "$(root_spread 399 60000 | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));a.push({id:"edge",brief:["Lane: edge"],turns:1,ageMs:3599999});console.log(JSON.stringify(a))')"
expect_deny s4d 'Engine: sonnet\nLane: fresh\ngo' "" "window: 3599999 ms old is counted"
mk s4e "$(root_spread 399 60000 | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));a.push({id:"fut",brief:["Lane: fut"],turns:1,ageMs:-5000});console.log(JSON.stringify(a))')"
expect_deny s4e 'Engine: sonnet\nLane: fresh\ngo' "" "window: a future ts counts"
# missing ts counts toward lane totals but not the hour
mk s4f "$(root_spread 400 0 '{"noTs":true}')"
expect_allow s4f 'Engine: sonnet\nLane: fresh\ngo' "" "no ts: not in the hour"
mk s4g '[{"id":"n1","brief":["Lane: nots"],"turns":300,"noTs":true}]'
expect_deny s4g 'Engine: sonnet\nLane: nots\ngo' "" "no ts: counts toward lane totals"
# lane totals ignore age; only the hour total filters
mk s5a "$(same_lane 4 old '{"ageMs":172800000,"mtimeAgeMs":172800000}')"
expect_deny s5a 'Engine: sonnet\nLane: old\ngo' "" "old dispatches still count toward the lane"
mk s5b '[{"id":"o1","brief":["Lane: old2"],"turns":300,"ageMs":172800000,"mtimeAgeMs":172800000}]'
expect_deny s5b 'Engine: sonnet\nLane: old2\ngo' "" "old lane turns still count"
mk s5c "$(root_spread 400 172800000 '{"mtimeAgeMs":172800000}')"
expect_allow s5c 'Engine: sonnet\nLane: fresh\ngo' "" "old turns do not count toward the hour"

# ---- in-flight agents count, because transcripts are read, not costs.jsonl ----------------------------------------
assert_file_absent "$HOOK_HOME/.claude/metrics/costs.jsonl" "no costs.jsonl exists in the sandbox"
expect_deny s3b 'Engine: sonnet\nLane: big\ngo' "" "in-flight transcripts counted with no costs.jsonl"

# ---- KR3: Budget-Ack ------------------------------------------------------------------------------------------------
mk s6 "$(same_lane 4 ackl)"
before=$(ledger_rows)
expect_deny s6 'Engine: sonnet\nLane: ackl\nBudget-Ack:\ngo' "" "KR3 empty reason denied"
expect_deny s6 'Engine: sonnet\nLane: ackl\nBudget-Ack: 1234567\ngo' "" "KR3 7-character reason denied"
assert_contains "$__RUN_STDOUT" "at least 8 characters" "KR3 reason explains the short ack"
assert_eq "$before" "$(ledger_rows)" "KR3 a denied ack writes no ledger row"
expect_allow s6 'Engine: sonnet\nLane: ackl\nBudget-Ack: 12345678\ngo' "" "KR3 8-character reason passes"
assert_eq "$((before + 1))" "$(ledger_rows)" "KR3 one ledger row appended"
assert_contains "$(tail -1 "$LEDGER")" '"decision_id":"budget-ack-ackl-5"' "KR3 ledger row id"
assert_contains "$(tail -1 "$LEDGER")" '"class":"tactical"' "KR3 ledger row class"
assert_contains "$(tail -1 "$LEDGER")" '"kind":"decision"' "KR3 ledger row kind"
expect_allow s6 'Engine: sonnet\nLane: ackl\n1\n2\n3\n4\n5\n6\n7\nBudget-Ack: tenth line counts\ngo' "" "ack on line 10 counts"
expect_deny s6 'Engine: sonnet\nLane: ackl\n1\n2\n3\n4\n5\n6\n7\n8\nBudget-Ack: eleventh line, ignored\ngo' "" "ack beyond line 10 ignored"
# an ack under the ceiling writes nothing
mk s6b "$(same_lane 1 fine)"
n=$(ledger_rows)
expect_allow s6b 'Engine: sonnet\nLane: fine\nBudget-Ack: unnecessary ack\ngo' "" "ack under the ceiling"
assert_eq "$n" "$(ledger_rows)" "KR3 no row when no ceiling was hit"

# ---- KR4: exactly one card per (session, lane) ----------------------------------------------------------------------
mk s7 "$(same_lane 4 cardl)"
c0=$(cards)
expect_deny s7 'Engine: sonnet\nLane: cardl\ngo' "" "KR4 first deny"
assert_eq "$((c0 + 1))" "$(cards)" "KR4 first deny opens one card"
assert_contains "$__RUN_STDOUT" "has been opened" "KR4 first reason says opened"
expect_deny s7 'Engine: sonnet\nLane: cardl\ngo' "" "KR4 second deny"
assert_eq "$((c0 + 1))" "$(cards)" "KR4 second deny opens no card"
assert_contains "$__RUN_STDOUT" "is already open" "KR4 second reason says already open"
mk s7b "$(same_lane 4 cardm)"
expect_deny s7b 'Engine: sonnet\nLane: cardm\ngo' "" "KR4 other session, other lane"
assert_eq "$((c0 + 2))" "$(cards)" "KR4 another session opens its own card"

# ---- KR5: context line on every allowed dispatch ---------------------------------------------------------------------
mk s8 '[{"id":"c1","brief":["Lane: ctx"],"turns":10},{"id":"c2","brief":["Lane: small"],"turns":2}]'
fire s8 'Engine: sonnet\nLane: other\ngo'
assert_contains "$__RUN_STDOUT" '"additionalContext":"subagent-budget: last 60 min 12 subagent turns, ~$' "KR5 context line with hour turns and USD"
assert_contains "$__RUN_STDOUT" "heaviest lane: ctx (10 turns, 1 dispatches)" "KR5 heaviest lane"

# ---- KR6: fail-open ---------------------------------------------------------------------------------------------------
fire s1 'Engine: sonnet\nLane: alpha\ngo' "" NONE
expect_silent "KR6 no transcript_path"
mk s9 '[{"id":"bad1","raw":"this is not json\n{nor this"}]'
fire s9 'Engine: sonnet\nLane: x\ngo'
expect_silent "KR6 corrupt jsonl"
fire s-never-created 'Engine: sonnet\nLane: x\ngo'
expect_silent "KR6 missing subagents dir"
mk s9b "$(same_lane 4 locked)"
chmod 000 "$PROJ/s9b/subagents"
if [ "$(id -u)" != 0 ]; then
  fire s9b 'Engine: sonnet\nLane: locked\ngo'
  expect_silent "KR6 unreadable directory"
fi
chmod 755 "$PROJ/s9b/subagents"
run_hook "$HOOK" "not json at all"
expect_silent "KR6 unparseable payload"
run_hook "$HOOK" '{"tool_name":"Bash","session_id":"s1"}'
expect_silent "other tools are untouched"

# ---- modes and knobs ---------------------------------------------------------------------------------------------------
AUTOPILOT_SUBAGENT_BUDGET_MODE=warn fire s1 'Engine: sonnet\nLane: alpha\ngo'
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "warn mode never denies"
assert_contains "$__RUN_STDOUT" "warn mode, not blocking" "warn mode says so"
export AUTOPILOT_SUBAGENT_BUDGET_MODE=off
fire s1 'Engine: sonnet\nLane: alpha\ngo'; expect_silent "mode off"
unset AUTOPILOT_SUBAGENT_BUDGET_MODE
export AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX=2
mk s10 "$(same_lane 2 envl)"
expect_deny s10 'Engine: sonnet\nLane: envl\ngo' "" "env override lane_dispatch_max=2"
unset AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX
printf '{"subagent_budget":{"lane_turns_max":5}}' >"$AUTOPILOT_CONFIG_FILE"
mk s10b '[{"id":"k1","brief":["Lane: cfgl"],"turns":5}]'
expect_deny s10b 'Engine: sonnet\nLane: cfgl\ngo' "" "config file lane_turns_max=5"
printf '{"subagent_budget":{"mode":"off"}}' >"$AUTOPILOT_CONFIG_FILE"
fire s10b 'Engine: sonnet\nLane: cfgl\ngo'; expect_silent "config mode off"
printf '{}\n' >"$AUTOPILOT_CONFIG_FILE"

# ---- cache: invalidates on size change, lives under the live dir, transcripts untouched ---------------------------------
mk s11 '[{"id":"w1","brief":["Lane: warm"],"turns":299}]'
expect_allow s11 'Engine: sonnet\nLane: warm\ngo' "" "cache: 299 allowed (cold)"
expect_allow s11 'Engine: sonnet\nLane: warm\ngo' "" "cache: 299 allowed (warm)"
assert_file_exists "$AUTOPILOT_LIVE_DIR/subagent-budget/cache/s11.json" "cache lives under the live dir"
sum_before=$(cksum <"$PROJ/s11/subagents/agent-w1.jsonl")
mk s11 '[{"id":"w1","brief":["Lane: warm"],"turns":300}]'
expect_deny s11 'Engine: sonnet\nLane: warm\ngo' "" "cache: file changed, recount denies at 300"
assert_neq "$sum_before" "$(cksum <"$PROJ/s11/subagents/agent-w1.jsonl")" "fixture rewritten"
before=$(cksum <"$PROJ/s11/subagents/agent-w1.jsonl")
fire s11 'Engine: sonnet\nLane: warm\ngo'
assert_eq "$before" "$(cksum <"$PROJ/s11/subagents/agent-w1.jsonl")" "hook never writes a transcript"
assert_file_absent "$HOOK_HOME/.claude/metrics/costs.jsonl" "hook never writes costs.jsonl"

# ---- KR7: latency, 200 transcripts x 300 turns, second call warm ---------------------------------------------------------
mk s12 "$(node -e 'const a=[];for(let i=0;i<200;i++)a.push({id:"p"+i,brief:["Lane: lat"+i],turns:300,ageMs:4800000});console.log(JSON.stringify(a))')"
fire s12 'Engine: sonnet\nLane: latnew\ngo'
assert_contains "$__RUN_STDOUT" "additionalContext" "KR7 cold call allowed with a context line"
times=""
for _ in $(seq 1 20); do
  t0=$(date +%s%N)
  fire s12 'Engine: sonnet\nLane: latnew\ngo'
  t1=$(date +%s%N)
  times="$times $(( (t1 - t0) / 1000000 ))"
done
p95=$(printf '%s\n' $times | sort -n | awk '{a[NR]=$1} END{i=int(NR*0.95+0.999999); if(i<1)i=1; print a[i]}')
echo "# KR7 warm latency ms (20 calls): $times  p95=$p95"
if [ "$p95" -le 300 ]; then assert_eq ok ok "KR7 p95 ${p95} ms <= 300"; else fail "KR7 p95 ${p95} ms > 300"; fi

finalize_test
