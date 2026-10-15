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

# Test (g): cache_write sums, ctx/turn arithmetic, subagent share, old rows without new fields.
# Day totals: main row   input 100 cr 9000 cw 900  turns 10 cost 3
#             main row   input  50 cr 1000 cw 100  turns  5 cost 1   (old shape: no sidechain field)
#             sub  row   input  40 cr 2000 cw 3000 turns  5 cost 4   (sidechain:true, agent_id)
#             legacy row (no token fields at all)             turns  1 cost 0.5
CW_FIXTURE="$FIXTURE_DIR/cachewrite.jsonl"
cat > "$CW_FIXTURE" <<JSONL
{"ts":"${DAY1}T09:00:00.000Z","session":"s-a","model":"claude-sonnet-4-5","input_tokens":100,"output_tokens":1,"cache_read_tokens":9000,"cache_write_tokens":900,"turns":10,"cost_usd":3,"cwd":"/app"}
{"ts":"${DAY1}T09:10:00.000Z","session":"s-a","model":"claude-sonnet-4-5","input_tokens":50,"output_tokens":1,"cache_read_tokens":1000,"cache_write_tokens":100,"turns":5,"cost_usd":1,"cwd":"/app"}
{"ts":"${DAY1}T09:20:00.000Z","session":"s-a","model":"claude-sonnet-4-5","sidechain":true,"agent_id":"ag1","input_tokens":40,"output_tokens":1,"cache_read_tokens":2000,"cache_write_tokens":3000,"turns":5,"cost_usd":4,"cwd":"/app"}
{"ts":"${DAY1}T09:30:00.000Z","session":"s-b","model":"claude-sonnet-4-5","turns":1,"cost_usd":0.5,"cwd":"/app"}
JSONL

CW_JSON="$(node "$DIGEST_SCRIPT" --file "$CW_FIXTURE" --since 100 --by tier --json)"
assert_exit_code "$?" "0" "digest on cache_write fixture exits 0"
cwq() { # <json> <expression over day d (the DAY1 entry)>
  node -e '
    const d = JSON.parse(process.argv[1]).days.find(x => x.day === process.argv[3]);
    process.stdout.write(String(eval(process.argv[2])));
  ' "$1" "$2" "$DAY1"
}
assert_eq "$(cwq "$CW_JSON" 'd.rows[0].cache_write_tokens')" "4000" "--json cache_write_tokens sums main + subagent + legacy rows (900+100+3000+0)"
assert_eq "$(cwq "$CW_JSON" 'd.rows[0].cache_read_tokens')" "12000" "--json cache_read_tokens still sums"
# (100+50+40) input + 12000 cr + 4000 cw = 16190 over 21 turns = 770.95 -> 771
assert_eq "$(cwq "$CW_JSON" 'd.rows[0].avg_context_per_turn')" "771" "avg_context_per_turn = (input+cache_read+cache_write)/turns from summed rows"
# subagent: cost 4 of 8.5 total; cache_write 3000 of 4000
assert_eq "$(cwq "$CW_JSON" 'd.subagent_usd')" "4" "subagent_usd counts only sidechain rows"
assert_eq "$(cwq "$CW_JSON" 'Math.round(d.subagent_share*10000)')" "4706" "subagent_share = 4 / 8.5"
assert_eq "$(cwq "$CW_JSON" 'd.subagent_cache_write_share')" "0.75" "subagent_cache_write_share = 3000 / 4000"

AG_JSON="$(node "$DIGEST_SCRIPT" --file "$CW_FIXTURE" --since 100 --by agent --json)"
assert_eq "$(cwq "$AG_JSON" 'd.rows.map(r => r.agent + ":" + r.cache_write_tokens + ":" + r.turns).sort().join(",")')" "main:1000:16,subagent:3000:5" "--by agent splits main from subagent"
assert_eq "$(cwq "$AG_JSON" 'd.rows.find(r => r.agent === "subagent").avg_context_per_turn')" "1008" "subagent ctx/turn = (40+2000+3000)/5"

for MODE in day model session tier agent; do
  MODE_JSON="$(node "$DIGEST_SCRIPT" --file "$CW_FIXTURE" --since 100 --by "$MODE" --json)"
  assert_eq "$(cwq "$MODE_JSON" 'd.rows.reduce((a, r) => a + r.cache_write_tokens, 0)')" "4000" "--by $MODE --json: cache_write_tokens present and totals 4000"
  MODE_TEXT="$(node "$DIGEST_SCRIPT" --file "$CW_FIXTURE" --since 100 --by "$MODE")"
  assert_contains "$MODE_TEXT" "cache_write" "--by $MODE text header has cache_write"
  assert_contains "$MODE_TEXT" "subagent_share: 47.1% of cost, 75.0% of cache_write" "--by $MODE text reports subagent share"
done

# legacy-only ledger (no new fields anywhere): no crash, zeros
OLD_JSON="$(node "$DIGEST_SCRIPT" --file "$FIXTURE_FILE" --since 100 --by agent --json)"
assert_exit_code "$?" "0" "legacy-only ledger with --by agent exits 0"
assert_eq "$(cwq "$OLD_JSON" 'd.rows[0].agent + ":" + d.rows[0].cache_write_tokens + ":" + d.subagent_share')" "main:0:0" "legacy rows count as main with cache_write 0 and subagent_share 0"

# Test (g): --json --by session keys on the session id alone; one session with rows in two cwds is ONE row.
CWD_FIXTURE="$TEST_TMP/cwd-fixture.jsonl"
cat > "$CWD_FIXTURE" <<EOF
{"ts":"${DAY1}T09:00:00.000Z","session":"cwd-session","model":"claude-sonnet-4-5","turns":1,"cost_usd":1.0000,"cwd":"/app/one"}
{"ts":"${DAY1}T09:30:00.000Z","session":"cwd-session","model":"claude-sonnet-4-5","turns":2,"cost_usd":0.5000,"cwd":"/app/two"}
EOF
CWD_JSON="$(node "$DIGEST_SCRIPT" --file "$CWD_FIXTURE" --since 100 --by session --json)"
CWD_ROWS="$(printf '%s' "$CWD_JSON" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const r=j.days.flatMap(d=>d.rows).filter(r=>r.session==="cwd-session");process.stdout.write(r.length+","+r[0].turns+","+r[0].cost_usd)')"
assert_eq "$CWD_ROWS" "1,3,1.5" "--json --by session: one session in two cwds is one row with summed totals"

# Test (h): --tree. Session tree-sess: main rows on two models; A (foreman) child of root via missing parent field,
# B/C children of A, D orphan (parent never in window), E old-shape subagent row (no tree fields).
TREE_FILE="$FIXTURE_DIR/tree.jsonl"
cat > "$TREE_FILE" <<JSONL
{"ts":"${TODAY_UTC}T08:00:00.000Z","session":"tree-sess-0001","model":"fable-5-1","turns":4,"cost_usd":8.0}
{"ts":"${TODAY_UTC}T08:00:00.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":2,"cost_usd":0.5}
{"ts":"${TODAY_UTC}T08:00:01.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":3,"cost_usd":3.0,"sidechain":true,"agent_id":"aaaaa11111","depth":1,"agent_type":"foreman"}
{"ts":"${TODAY_UTC}T08:00:01.000Z","session":"tree-sess-0001","model":"haiku-4","turns":1,"cost_usd":0.25,"sidechain":true,"agent_id":"aaaaa11111","depth":1,"agent_type":"foreman"}
{"ts":"${TODAY_UTC}T08:00:02.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":2,"cost_usd":0.9,"sidechain":true,"agent_id":"bbbbb22222","parent_agent_id":"aaaaa11111","depth":2,"agent_type":"general-purpose"}
{"ts":"${TODAY_UTC}T08:00:02.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.1,"sidechain":true,"agent_id":"ccccc33333","parent_agent_id":"aaaaa11111","depth":2}
{"ts":"${TODAY_UTC}T08:00:03.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.4,"sidechain":true,"agent_id":"ddddd44444","parent_agent_id":"gone000000","depth":2,"agent_type":"explore"}
{"ts":"${TODAY_UTC}T08:00:04.000Z","session":"tree-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.2,"sidechain":true,"agent_id":"eeeee55555"}
{"ts":"${TODAY_UTC}T09:00:00.000Z","session":"tree-small-02","model":"sonnet-5-5","turns":1,"cost_usd":1.0}
{"ts":"2026-01-01T09:00:00.000Z","session":"tree-old-0003","model":"sonnet-5-5","turns":1,"cost_usd":99}
JSONL
TREE_JSON="$(node "$DIGEST_SCRIPT" --file "$TREE_FILE" --today --tree --json)"
assert_exit_code "$?" "0" "--tree --json exits 0"
tj() { node -e 'const d=JSON.parse(process.argv[1]);const s=d.sessions.find(x=>x.session==="tree-sess-0001");const root=s.root;const find=(n,id)=>n.agent_id===id?n:n.children.reduce((a,c)=>a||find(c,id),null);let v;eval("v="+process.argv[2]);process.stdout.write(String(v))' "$TREE_JSON" "$1"; }
assert_eq "$(tj 'd.sessions.map(x=>x.session).join()')" "tree-sess-0001,tree-small-02" "tree: sessions sorted by total desc, --today filter drops the old session"
assert_eq "$(tj 's.total_usd')" "13.35" "tree: session total adds up all rows"
assert_eq "$(tj 'root.own_usd')" "8.5" "tree: root own = main rows only"
assert_eq "$(tj 'root.models.map(m=>m.model).join()')" "fable-5-1,sonnet-5-5" "tree: root keeps a per-model split, desc by cost"
assert_eq "$(tj 'find(find(root,"aaaaa11111"),"bbbbb22222")!==null')" "true" "tree: depth-2 agent nests under its parent_agent_id"
assert_eq "$(tj 'find(root,"aaaaa11111").children.map(c=>c.agent_id).join()')" "bbbbb22222,ccccc33333" "tree: children sorted by subtree desc"
assert_eq "$(tj 'find(root,"aaaaa11111").models.length')" "2" "tree: one agent that used two models has two model entries"
assert_eq "$(tj 'find(root,"aaaaa11111").subtree_usd')" "4.25" "tree: subtree = own 3.25 + children 1.0"
assert_eq "$(tj 'root.children.map(c=>c.agent_id).sort().join()')" "aaaaa11111,ddddd44444,eeeee55555" "tree: parentless (old-shape) and orphan agents attach to the root"
assert_eq "$(tj 'find(root,"ddddd44444").orphan')" "true" "tree: agent whose parent is not in the window is marked orphan"
assert_eq "$(tj 'find(root,"eeeee55555").orphan')" "false" "tree: old-shape row without parent field is not an orphan"
assert_eq "$(tj 'root.subtree_usd')" "13.35" "tree: root subtree equals session total"
assert_eq "$(tj 'find(root,"aaaaa11111").label')" "foreman aaaaa…" "tree: label is agent_type + first 5 id chars"
assert_eq "$(tj 'find(root,"eeeee55555").label')" "agent eeeee…" "tree: label falls back to 'agent' without agent_type"
TREE_TXT="$(node "$DIGEST_SCRIPT" --file "$TREE_FILE" --today --tree)"
assert_contains "$TREE_TXT" "session tree-ses  \$13.35" "tree text: session header with total"
assert_contains "$TREE_TXT" "├─ depth-0  fable-5-1  \$8.00" "tree text: depth-0 line"
assert_contains "$TREE_TXT" "foreman aaaaa…  sonnet-5-5  \$3.00" "tree text: agent first model line"
assert_contains "$TREE_TXT" "haiku-4  \$0.25 (subtree \$4.25)" "tree text: second model on its own line, subtree on the last"
assert_contains "$TREE_TXT" "├─ general-purpose bbbbb…  sonnet-5-5  \$0.90" "tree text: nested child drawn under its parent"
assert_contains "$TREE_TXT" "explore ddddd… [orphan]" "tree text: orphan marker"
node "$DIGEST_SCRIPT" --file "$TREE_FILE" --tree --by session >/dev/null 2>&1
assert_exit_code "$?" "2" "--tree with --by exits 2"
node "$DIGEST_SCRIPT" --file "$TREE_FILE" --by session --tree >/dev/null 2>&1
assert_exit_code "$?" "2" "--by then --tree also exits 2"

# BL-0120: parent cycle, self-parent and 5-char label collisions. Session cyc: C (parent A) and D (parent C) hang under
# a cycle A<->B; C is first in the file so a cycle breaker that judges C by the walk alone cuts it loose as an orphan.
CYC_FILE="$FIXTURE_DIR/cycle.jsonl"
cat > "$CYC_FILE" <<JSONL
{"ts":"${TODAY_UTC}T08:00:00.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":1.0}
{"ts":"${TODAY_UTC}T08:00:01.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.1,"sidechain":true,"agent_id":"cccc333333","parent_agent_id":"aaaa111111","depth":3,"agent_type":"worker"}
{"ts":"${TODAY_UTC}T08:00:02.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.2,"sidechain":true,"agent_id":"dddd444444","parent_agent_id":"cccc333333","depth":4,"agent_type":"worker"}
{"ts":"${TODAY_UTC}T08:00:03.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.4,"sidechain":true,"agent_id":"aaaa111111","parent_agent_id":"bbbb222222","depth":1,"agent_type":"worker"}
{"ts":"${TODAY_UTC}T08:00:04.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.8,"sidechain":true,"agent_id":"bbbb222222","parent_agent_id":"aaaa111111","depth":2,"agent_type":"worker"}
{"ts":"${TODAY_UTC}T08:00:05.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":1.6,"sidechain":true,"agent_id":"ssss555555","parent_agent_id":"ssss555555","depth":1,"agent_type":"selfp"}
{"ts":"${TODAY_UTC}T08:00:06.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":3.2,"sidechain":true,"agent_id":"abcde11111","depth":1,"agent_type":"foreman"}
{"ts":"${TODAY_UTC}T08:00:07.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":6.4,"sidechain":true,"agent_id":"abcde22222","depth":1,"agent_type":"foreman"}
{"ts":"${TODAY_UTC}T08:00:08.000Z","session":"cyc-sess-0001","model":"sonnet-5-5","turns":1,"cost_usd":0.5,"sidechain":true,"agent_id":"abcdf33333","depth":1,"agent_type":"foreman"}
JSONL
CYC_JSON="$(node "$DIGEST_SCRIPT" --file "$CYC_FILE" --today --tree --json)"
assert_exit_code "$?" "0" "--tree on cyclic parents exits 0"
cj() { node -e 'const d=JSON.parse(process.argv[1]);const s=d.sessions[0];const root=s.root;const find=(n,id)=>n.agent_id===id?n:n.children.reduce((a,c)=>a||find(c,id),null);const all=(n)=>[n].concat(...n.children.map(all));let v;eval("v="+process.argv[2]);process.stdout.write(String(v))' "$CYC_JSON" "$1"; }
assert_eq "$(cj 'all(root).length')" "9" "cycle: every agent stays reachable from the root"
assert_eq "$(cj 's.total_usd')" "14.2" "cycle: session total counts every row"
assert_eq "$(cj 'find(root,"cccc333333").orphan')" "false" "cycle: a node hanging under a cycle is not made an orphan"
assert_eq "$(cj 'find(find(root,"aaaa111111"),"cccc333333")!==null')" "true" "cycle: the node under the cycle keeps its parent link"
assert_eq "$(cj 'find(find(root,"cccc333333"),"dddd444444")!==null')" "true" "cycle: the grandchild keeps its parent link"
assert_eq "$(cj 'find(root,"aaaa111111").orphan')" "true" "cycle: the one member that is cut loose is marked orphan"
assert_eq "$(cj 'root.children.some(c=>c.agent_id==="ssss555555")&&!find(root,"ssss555555").orphan')" "true" "self-parent: attaches to the root, not an orphan"
assert_eq "$(cj 'find(root,"abcde11111").label!==find(root,"abcde22222").label')" "true" "labels: two agents sharing type and 5-char prefix get distinct labels"
assert_eq "$(cj 'find(root,"abcdf33333").label')" "foreman abcdf…" "labels: a non-colliding agent keeps the short label"
CYC_TXT="$(node "$DIGEST_SCRIPT" --file "$CYC_FILE" --today --tree)"
assert_contains "$CYC_TXT" "foreman abcde1" "labels: text output disambiguates the collision too"

finalize_test
