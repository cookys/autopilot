#!/usr/bin/env bash
# RED at 48aa19a3fdc8eb21ab3a1036dbc7a32a6a61e0ef: 198 passed, 2 failed — Engine-without-Lane deny had no three-line template and no "This brief is still missing:".
# Test for hooks/subagent-budget.js - per-lane relay and turn ceilings on Agent dispatch (plan
# docs/plans/2026-10-18-subagent-budget-gate.md, KR1-KR7). Everything lives under TEST_TMP: HOME,
# the live-state dir (AUTOPILOT_LIVE_DIR from lib.sh), the panel store and the decision ledger
# (both under the scratch repo's .git), fixture transcripts. The clock is injected.
. "$(dirname "$0")/lib.sh"

FIX="$HOOKS_DIR/tests/lib/subagent-budget-fixture.js"
NOW=1790000000000
export AUTOPILOT_SUBAGENT_BUDGET_NOW_MS=$NOW
export AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK=1
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
expect_deny s1d 'Task: x\ngo' "  Fix Loader
second line" "description fallback lane"
# malformed Lane: line falls back to description; a Lane: quoted later in the brief never matches
expect_deny s1d 'Task: x\nLane: bad lane!\ngo' "fix loader" "malformed Lane: falls back to description"
expect_allow s1d 'Engine: sonnet\n1\n2\n3\nLane: other\ngo' "unrelated" "Lane: on line 5 is read"
expect_allow s1d 'Task: x\n1\n2\n3\n4\nLane: fix-loader-quoted\ngo' "" "Lane: on line 6 never matches, no description => no lane"
# a dispatch with no lane counts only toward the root total
expect_allow s1d 'Task: x\ngo' "" "no lane allowed"

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

# ---- BL-0209: nested dispatch (flat subagents dir, meta.json parentAgentId/spawnDepth), clock override ----------------
# payload_x <session> <prompt> <transcript-path> [agent_id]: like payload, plus an explicit transcript path and agent_id.
payload_x() {
  node -e '
    const [sid,prompt,tp,aid]=process.argv.slice(1);
    const p={tool_name:"Agent",session_id:sid,cwd:process.argv[5],transcript_path:tp,tool_input:{prompt:prompt.replace(/\\n/g,"\n"),model:"sonnet"}};
    if(aid) p.agent_id=aid;
    console.log(JSON.stringify(p));
  ' "$1" "$2" "$3" "${4:-}" "$REPO"
}
fire_x() { run_hook "$HOOK" "$(payload_x "$@")"; }
sub_tp() { echo "$PROJ/$1/subagents/agent-$2.jsonl"; }   # a subagent's own transcript path

# nested dispatch is counted whichever transcript_path the harness sends: main transcript, or the foreman's own file
mk n1 '[{"id":"a0","brief":["Lane: nl"],"depth":1},{"id":"a1","brief":["Lane: nl"],"depth":1},{"id":"a2","brief":["Lane: nl"],"depth":1},{"id":"a3","brief":["Lane: nl"],"depth":1}]'
fire_x n1 'Engine: sonnet\nLane: nl\ngo' "$PROJ/n1.jsonl"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 depth-0 transcript_path counts the flat dir"
fire_x n1 'Engine: sonnet\nLane: nl\ngo' "$(sub_tp n1 a0)" a0
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 foreman's own transcript_path + agent_id counts"
fire_x n1 'Engine: sonnet\nLane: nl\ngo' "$(sub_tp n1 a0)"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 foreman's own transcript_path without agent_id counts"
fire_x n1 'Engine: sonnet\nLane: nl\ngo' "$PROJ/n1.jsonl" a0
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 agent_id with the main transcript_path counts"
mk n1b '[{"id":"a0","brief":["Lane: nl"],"depth":1},{"id":"a1","brief":["Lane: nl"],"depth":1}]'
fire_x n1b 'Engine: sonnet\nLane: nl\ngo' "$(sub_tp n1b a0)" a0
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 under the ceiling from a foreman path is allowed"
assert_contains "$__RUN_STDOUT" "additionalContext" "BL0209 under the ceiling from a foreman path gets a context line"
# neither candidate dir exists => fail-open
fire_x n-none 'Engine: sonnet\nLane: nl\ngo' "$PROJ/elsewhere/agent-x.jsonl" x
expect_silent "BL0209 no candidate dir"

# depth-2 transcripts without Lane: bill their turns to the depth-1 ancestor's lane
mk n2 '[{"id":"f1","brief":["Lane: tl"],"depth":1,"turns":1},{"id":"c1","parent":"f1","depth":2,"description":"loaderef independent code review","turns":299}]'
expect_deny n2 'Engine: sonnet\nLane: tl\ngo' "" "BL0209 depth-2 turns reach the ancestor lane (1 + 299 = 300)"
assert_contains "$__RUN_STDOUT" "lane_turns_max 300" "BL0209 ancestry denial names lane_turns_max"
mk n2b '[{"id":"f1","brief":["Lane: tl2"],"depth":1,"turns":1},{"id":"c1","parent":"f1","depth":2,"turns":298}]'
expect_allow n2b 'Engine: sonnet\nLane: tl2\ngo' "" "BL0209 299 turns across the chain still allowed"
# grandchild: two hops up
mk n2c '[{"id":"f1","brief":["Lane: tl3"],"depth":1,"turns":1},{"id":"c1","parent":"f1","depth":2,"turns":1},{"id":"g1","parent":"c1","depth":3,"turns":298}]'
expect_deny n2c 'Engine: sonnet\nLane: tl3\ngo' "" "BL0209 grandchild turns reach the root ancestor lane"
# the nearest ancestor with a Lane: wins over a farther one
mk n2d '[{"id":"f1","brief":["Lane: far"],"depth":1},{"id":"c1","brief":["Lane: near"],"parent":"f1","depth":2},{"id":"g1","parent":"c1","depth":3,"turns":300}]'
expect_deny n2d 'Engine: sonnet\nLane: near\ngo' "" "BL0209 nearest ancestor Lane: wins"
expect_allow n2d 'Engine: sonnet\nLane: far\ngo' "" "BL0209 a farther ancestor does not get the turns"

# a foreman (agent_id) dispatching without Lane: joins the foreman's lane
expect_allow n2 'Task: x\ngo' "" "BL0209 depth-0 dispatch without Lane: has no lane"
fire_x n2 'Engine: sonnet\ngo' "$PROJ/n2.jsonl" f1
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 foreman (agent_id) dispatch without Lane: lands in the foreman's lane"
assert_contains "$__RUN_STDOUT" "lane 'tl'" "BL0209 the denial names the foreman's lane"
fire_x n2 'Engine: sonnet\ngo' "$(sub_tp n2 f1)"
assert_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 foreman path without agent_id also lands in the foreman's lane"
fire_x n2 'Engine: sonnet\ngo' "$PROJ/n2.jsonl" c1
assert_contains "$__RUN_STDOUT" "lane 'tl'" "BL0209 a depth-2 dispatcher inherits the ancestor lane"
fire_x n2 'Engine: sonnet\nLane: other\ngo' "$PROJ/n2.jsonl" f1
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 an explicit Lane: beats the dispatcher's lane"
fire_x n2 'Task: x\ngo' "$PROJ/n2.jsonl" no-such-agent
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 unknown agent_id => no lane, no crash"

# parentAgentId cycle / missing file: no crash, falls back to the description
mk n3 '[{"id":"c1","parent":"c2","depth":1,"description":"cyc"},{"id":"c2","parent":"c1","depth":1,"description":"cyc"},{"id":"c3","parent":"ghost","depth":1,"description":"cyc"},{"id":"c4","parent":"c4","depth":1,"description":"cyc"}]'
expect_deny n3 'Task: x\ngo' "cyc" "BL0209 cycle / ghost parent fall back to description (4 dispatches)"
fire_x n3 'Task: x\ngo' "$PROJ/n3.jsonl" c1
expect_silent_or_allow() { assert_eq 0 "$__RUN_EXIT" "$1: exit 0"; }
expect_silent_or_allow "BL0209 cyclic dispatcher does not crash"
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 cyclic dispatcher without lane is allowed"
mk n3b '[{"id":"z1","parent":"z2","depth":2,"turns":400},{"id":"z2","parent":"z3","depth":2},{"id":"z3","parent":"z1","depth":2}]'
fire_x n3b 'Engine: sonnet\nLane: q\ngo' "$PROJ/n3b.jsonl" z1
assert_eq 0 "$__RUN_EXIT" "BL0209 3-cycle no crash"
# the ancestor walk stops after 8 hops: h8 reaches h0, h9 does not
chain() { node -e 'const t=+process.argv[1];const a=[{id:"h0",brief:["Lane: deep"],depth:1}];for(let i=1;i<=10;i++)a.push({id:"h"+i,parent:"h"+(i-1),depth:i+1,turns:i===t?300:0});console.log(JSON.stringify(a))' "$1"; }
mk n3c "$(chain 8)"
expect_deny n3c 'Engine: sonnet\nLane: deep\ngo' "" "BL0209 8 hops up still reaches the ancestor lane"
mk n3d "$(chain 9)"
expect_allow n3d 'Engine: sonnet\nLane: deep\ngo' "" "BL0209 9 hops up is not attributed"

# dispatch slots: depth >= 2 transcripts take none by default; the switch counts them
mk n4 '[{"id":"d0","brief":["Lane: dl"],"depth":1},{"id":"d1","brief":["Lane: dl"],"depth":1},{"id":"d2","brief":["Lane: dl"]},{"id":"d3","parent":"d0","depth":2},{"id":"d4","parent":"d0","depth":2}]'
expect_allow n4 'Engine: sonnet\nLane: dl\ngo' "" "BL0209 default: 3 depth<=1 + 2 depth-2 => 3 dispatch slots, allowed"
nested_count() {
  node -e '
    const h=require(process.argv[1]);
    const p={tool_name:"Agent",session_id:process.argv[2],transcript_path:process.argv[3]};
    const e=h.withLanes(h.collect(p));
    console.log(h.tally(e,"dl",1790000000000,process.argv[4]==="true").laneDispatches);
  ' "$HOOKS_DIR/$HOOK" n4 "$PROJ/n4.jsonl" "$1"
}
assert_eq 3 "$(nested_count false)" "BL0209 tally countNested=false => 3"
assert_eq 5 "$(nested_count true)" "BL0209 tally countNested=true => 5"
assert_eq 3 "$(node -e 'const h=require(process.argv[1]);const p={tool_name:"Agent",session_id:"n4",transcript_path:process.argv[2]};console.log(h.tally(h.withLanes(h.collect(p)),"dl",1790000000000).laneDispatches)' "$HOOKS_DIR/$HOOK" "$PROJ/n4.jsonl")" "BL0209 tally default excludes nested"
# a nested transcript's turns count either way
mk n4b '[{"id":"d0","brief":["Lane: dl2"],"depth":1},{"id":"d3","parent":"d0","depth":2,"turns":300}]'
expect_deny n4b 'Engine: sonnet\nLane: dl2\ngo' "" "BL0209 nested turns count although nested dispatches do not"

# clock override: ignored without the explicit test flag
mk n5 "$(root_spread 400 60000)"
expect_deny n5 'Engine: sonnet\nLane: fresh\ngo' "" "BL0209 override honoured with the test flag"
AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK= fire n5 'Engine: sonnet\nLane: fresh\ngo'
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 override ignored without the test flag (real clock: old turns)"
assert_contains "$__RUN_STDOUT" "last 60 min 0 subagent turns" "BL0209 production clock sees 0 turns in the last hour"
AUTOPILOT_TEST_ALLOW_SUBAGENT_BUDGET_CLOCK=0 fire n5 'Engine: sonnet\nLane: fresh\ngo'
assert_not_contains "$__RUN_STDOUT" '"permissionDecision":"deny"' "BL0209 flag value other than 1 does not enable the override"

# ---- d-0bb18035: Engine: briefs must carry a Lane: (own or inherited) --------------------------------------------------
LR_DENY='"permissionDecision":"deny"'
mk lr1 '[{"id":"x1","brief":["Lane: other"]}]'
for withmarker in 0 1; do
  if [ "$withmarker" = 1 ]; then printf '{"session_id":"lr1","level":"l5","expires_at":"2099-01-01T00:00:00Z"}' >"$AUTOPILOT_SESSION_MODE_DIR/lr1.json"; fi
  c0=$(cards)
  fire lr1 'Engine: sonnet\nRole: worker\ngo'
  assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR marker=$withmarker Engine: without Lane: denied"
  assert_contains "$__RUN_STDOUT" 'Lane: <name>' "LR marker=$withmarker reason shows the format"
  assert_contains "$__RUN_STDOUT" '[A-Za-z0-9][A-Za-z0-9._-]{0,63}' "LR marker=$withmarker reason shows the name rule"
  assert_contains "$__RUN_STDOUT" 'Budget-Ack: <reason' "LR marker=$withmarker reason shows the ack way"
  assert_eq "$c0" "$(cards)" "LR marker=$withmarker no panel card opened"
done
rm -f "$AUTOPILOT_SESSION_MODE_DIR/lr1.json"
# invalid Lane: values count as no lane
fire lr1 'Engine: sonnet\nLane:\ngo'; assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR empty Lane: denied"
fire lr1 'Engine: sonnet\nLane: -x\ngo'; assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR Lane: -x denied"
fire lr1 'Engine: sonnet\nLane: bad lane!\ngo'; assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR Lane: with a space denied"
# a description does not stand in for the lane of an Engine: brief
fire lr1 'Engine: sonnet\ngo' "some description"; assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR description does not replace Lane:"
expect_allow lr1 'Engine: sonnet\nRole: worker\nLane: lr-ok\ngo' "" "LR valid Lane: allowed"
# no subagents dir yet (first dispatch of a session): a depth-0 Engine: brief is still checked
fire lr-never-created 'Engine: sonnet\ngo'; assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR first dispatch, no subagents dir, no Lane: denied"
fire lr-never-created 'Engine: sonnet\nLane: first\ngo'; expect_silent "LR first dispatch with Lane: stays fail-open"
# not an Engine: brief (Explore etc.): description fallback, no deny
expect_allow lr1 'Find the loader\ngo' "explore it" "LR non-Engine brief without Lane: allowed"
expect_allow lr1 ' Engine: sonnet\ngo' "" "LR leading space is not an Engine: brief"
# inheritance: a subagent dispatcher that has a lane passes the Engine: brief without Lane:
mk lr2 '[{"id":"f1","brief":["Lane: parentlane"],"depth":1}]'
fire_x lr2 'Engine: sonnet\ngo' "$(sub_tp lr2 f1)" f1
assert_not_contains "$__RUN_STDOUT" "$LR_DENY" "LR inherits the dispatcher's lane"
mk lr3 '[{"id":"g1","brief":["no lane here"],"depth":1,"description":"desc only"}]'
fire_x lr3 'Engine: sonnet\ngo' "$(sub_tp lr3 g1)" g1
assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR dispatcher with only a description gives no lane"
# Budget-Ack passes, with a ledger row; a short reason does not
before=$(ledger_rows)
fire lr1 'Engine: sonnet\nBudget-Ack: short\ngo'
assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR short ack still denied"
assert_contains "$__RUN_STDOUT" 'at least 8 characters' "LR short ack explained"
assert_eq "$before" "$(ledger_rows)" "LR denied ack writes no row"
expect_allow lr1 'Engine: sonnet\nBudget-Ack: format exception for test\ngo' "" "LR Budget-Ack passes the missing lane"
assert_eq "$((before + 1))" "$(ledger_rows)" "LR ack writes one ledger row"
# warn mode only warns; off ignores
AUTOPILOT_SUBAGENT_BUDGET_MODE=warn fire lr1 'Engine: sonnet\ngo'
assert_not_contains "$__RUN_STDOUT" '"permissionDecision"' "LR warn mode never denies"
assert_contains "$__RUN_STDOUT" 'lane ceilings cannot apply' "LR warn mode adds the warning"
AUTOPILOT_SUBAGENT_BUDGET_MODE=off fire lr1 'Engine: sonnet\ngo'; expect_silent "LR mode off"

# an Engine: brief without Lane: is never billed to its description lane (that lane is at its ceiling here)
mk lr4 '[{"id":"d0","description":"dsc"},{"id":"d1","description":"dsc"},{"id":"d2","description":"dsc"},{"id":"d3","description":"dsc"}]'
AUTOPILOT_SUBAGENT_BUDGET_MODE=warn fire lr4 'Engine: sonnet\ngo' "dsc"
assert_contains "$__RUN_STDOUT" 'lane ceilings cannot apply' "LR warn: missing Lane: still warned"
assert_not_contains "$__RUN_STDOUT" "lane 'dsc' already has" "LR warn: description lane is not counted for an Engine: brief"
c0=$(cards); before=$(ledger_rows)
expect_allow lr4 'Engine: sonnet\nBudget-Ack: format exception for test\ngo' "dsc" "LR ack: Engine: brief without Lane: passes"
assert_not_contains "$__RUN_STDOUT" "lane 'dsc'" "LR ack: description lane is not counted"
assert_eq "$c0" "$(cards)" "LR ack: no panel card opened"
assert_not_contains "$(tail -n 1 "$LEDGER")" "budget-ack-dsc" "LR ack: ledger row is not filed under the description lane"
assert_eq "$((before + 1))" "$(ledger_rows)" "LR ack: one ledger row"
# remind mode, no Lane:, description lane at its ceiling: still the format deny, and no card
c0=$(cards)
fire lr4 'Engine: sonnet\ngo' "dsc"
assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR remind: denied for the missing Lane:"
assert_not_contains "$__RUN_STDOUT" "lane 'dsc'" "LR remind: reason does not name the description lane"
assert_eq "$c0" "$(cards)" "LR remind: no panel card from the description lane"
# depth-0 Engine: brief without Lane: is checked even when the payload has no transcript_path
fire lr1 'Engine: sonnet\ngo' "" NONE
assert_contains "$__RUN_STDOUT" "$LR_DENY" "LR no transcript_path: Engine: without Lane: denied"
fire lr1 'Engine: sonnet\nLane: x\ngo' "" NONE; expect_silent "LR no transcript_path with Lane: stays fail-open"
fire lr1 'Task: x\ngo' "" NONE; expect_silent "LR no transcript_path non-Engine stays fail-open"

# hdrhint: Engine present, Lane absent (autopilot dispatch) lists Lane and the three-line template.
HDR_TMPL='Engine: <model>\nRole: <role>\nLane: <slug>'
fire lr1 'Engine: sonnet\nRole: worker\ngo'
assert_contains "$__RUN_STDOUT" "$LR_DENY" "hdrhint engine-without-lane denied"
assert_contains "$__RUN_STDOUT" "$HDR_TMPL" "hdrhint engine-without-lane has the template"
assert_contains "$__RUN_STDOUT" "This brief is still missing:" "hdrhint engine-without-lane lists what is missing"
assert_contains "$__RUN_STDOUT" "Lane:" "hdrhint engine-without-lane lists Lane"
# Negative: all three lines stay allowed. Role alone is not a deny.
expect_allow lr1 'Engine: sonnet\nRole: worker\nLane: hdrhint-ok\ngo' "" "hdrhint complete brief stays allowed"
expect_allow lr1 'Engine: sonnet\nLane: hdrhint-ok\ngo' "" "hdrhint missing only Role is not denied"

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
