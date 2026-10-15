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

# ── 5b. size/mtime short-circuit: unchanged subagent file is skipped; a grown one still yields its new turns ──
CUR="$(cat "$METRICS/.cursors/ct-sub-session.json")"
assert_contains "$CUR" '"agent_files":{"aaa111":{"size":' "cursor records subagent file size/mtime"
ROWS_BEFORE="$(wc -l < "$LEDGER")"
run_hook cost-tracker.js "$(payload)"
assert_eq "$ROWS_BEFORE" "$(wc -l < "$LEDGER")" "unchanged subagent file: no rows appended"
assert_eq 1040 "$(sum_field cache_write_tokens sub)" "unchanged subagent file: sub totals unchanged"
line s4 q4 5 100 60 ',"isSidechain":true,"agentId":"aaa111"' >> "$SUBDIR/agent-aaa111.jsonl"
run_hook cost-tracker.js "$(payload)"
assert_eq 1100 "$(sum_field cache_write_tokens sub)" "grown subagent file: only the new turn is added"
# an old-shape cursor (no agent_files) still works: file is parsed once, nothing double-counted
node -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f,"utf8"));delete c.agent_files;require("fs").writeFileSync(f,JSON.stringify(c))' "$METRICS/.cursors/ct-sub-session.json"
run_hook cost-tracker.js "$(payload)"
assert_eq 1100 "$(sum_field cache_write_tokens sub)" "old cursor without agent_files: no double count"
# same size + same mtime but different content is skipped unparsed (proves the file is not re-read): turn the
# duplicate "s1" line into a fresh "s5" turn of equal byte length, then restore the mtime
SUBF="$SUBDIR/agent-aaa111.jsonl"
touch -r "$SUBF" "$TEST_TMP/mtime.ref"
node -e 'const fs=require("fs"),f=process.argv[1];let t=fs.readFileSync(f,"utf8");t=t.replace(/"id":"s1"([^\n]*\n[^\n]*)"id":"s1"/,"\"id\":\"s1\"$1\"id\":\"s5\"");fs.writeFileSync(f,t)' "$SUBF"
touch -r "$TEST_TMP/mtime.ref" "$SUBF"
run_hook cost-tracker.js "$(payload)"
assert_eq 1100 "$(sum_field cache_write_tokens sub)" "same size+mtime: subagent file is short-circuited, not re-parsed"

# ── 6. missing subagents dir → no error, no sidechain rows ──
rm -rf "$TEST_TMP/transcript"
{ line z1 w1 1 10 5; } > "$TR"
payload2() { printf '{"session_id":"ct-sub-session-2","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TR" "$TEST_TMP"; }
run_hook cost-tracker.js "$(payload2)"
assert_eq 0 "$__RUN_EXIT" "no subagents dir: exit 0"
assert_eq "" "$__RUN_STDERR" "no subagents dir: silent"

# ── 7. agent tree fields from sidecars: depth-1 (no parent), depth-2 (parentAgentId), no sidecar, malformed sidecar ──
TREE_TR="$TEST_TMP/tree-transcript.jsonl"
TSUB="$TEST_TMP/tree-transcript/subagents"
mkdir -p "$TSUB"
{ line t0 t0 1 1 1; } > "$TREE_TR"
{ line d1 e1 5 100 10 ',"isSidechain":true,"agentId":"dep1"'; } > "$TSUB/agent-dep1.jsonl"
printf '%s' '{"agentType":"foreman","toolUseId":"tu1","spawnDepth":1,"model":"sonnet"}' > "$TSUB/agent-dep1.meta.json"
{ line d2 e2 5 100 10 ',"isSidechain":true,"agentId":"dep2"'; } > "$TSUB/agent-dep2.jsonl"
printf '%s' '{"agentType":"general-purpose","toolUseId":"tu2","parentAgentId":"dep1","spawnDepth":2}' > "$TSUB/agent-dep2.meta.json"
{ line d3 e3 5 100 10 ',"isSidechain":true,"agentId":"nometa"'; } > "$TSUB/agent-nometa.jsonl"
{ line d4 e4 5 100 10 ',"isSidechain":true,"agentId":"badmeta"'; } > "$TSUB/agent-badmeta.jsonl"
printf '%s' '{not json' > "$TSUB/agent-badmeta.meta.json"
rm -f "$LEDGER"
TP="$(printf '{"session_id":"ct-tree-session","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$TREE_TR" "$TEST_TMP")"
run_hook cost-tracker.js "$TP"
assert_eq 0 "$__RUN_EXIT" "tree stop exit 0"
tfield() { node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse).find(x=>x.agent_id===process.argv[2]);process.stdout.write(r?(process.argv[3] in r?String(r[process.argv[3]]):"<absent>"):"<norow>")' "$LEDGER" "$1" "$2"; }
assert_eq "<absent>" "$(tfield dep1 parent_agent_id)" "depth-1 sidecar: no parent_agent_id"
assert_eq "1" "$(tfield dep1 depth)" "depth-1 sidecar: depth 1"
assert_eq "foreman" "$(tfield dep1 agent_type)" "depth-1 sidecar: agent_type"
assert_eq "dep1" "$(tfield dep2 parent_agent_id)" "depth-2 sidecar: parent_agent_id"
assert_eq "2" "$(tfield dep2 depth)" "depth-2 sidecar: depth 2"
assert_eq "general-purpose" "$(tfield dep2 agent_type)" "depth-2 sidecar: agent_type"
for a in nometa badmeta; do
  assert_eq "<absent><absent><absent>" "$(tfield $a parent_agent_id)$(tfield $a depth)$(tfield $a agent_type)" "$a: no sidecar fields at all"
  assert_eq "<absent>" "$(tfield $a nonexistent_field)" "$a: row still written"
done
MAINROW="$(grep -v sidechain "$LEDGER" | head -1)"
assert_not_contains "$MAINROW" 'depth' "main row has no tree fields"
# a sidecar is not re-read for a skipped (unchanged) file
printf '%s' '{"agentType":"x","parentAgentId":"zzz"}' > "$TSUB/agent-dep1.meta.json"
ROWS_BEFORE="$(wc -l < "$LEDGER")"
run_hook cost-tracker.js "$TP"
assert_eq "$ROWS_BEFORE" "$(wc -l < "$LEDGER")" "unchanged agent files: no new rows"
# BL-0120: the skipped-file check above cannot fail (no rows -> no sidecar fields to compare). Grow dep1 and the
# rewritten sidecar must now be read: the NEW row carries the rewritten parent/type, the old rows keep theirs.
{ line d5 e5 5 100 10 ',"isSidechain":true,"agentId":"dep1"'; } >> "$TSUB/agent-dep1.jsonl"
run_hook cost-tracker.js "$TP"
assert_eq "$((ROWS_BEFORE + 1))" "$(wc -l < "$LEDGER")" "grown agent file: exactly its new turn appended"
newrow() { node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter(x=>x.agent_id==="dep1").pop();process.stdout.write(String(r[process.argv[2]]))' "$LEDGER" "$1"; }
assert_eq "zzz" "$(newrow parent_agent_id)" "grown agent file: new row gets the rewritten sidecar's parent"
assert_eq "x" "$(newrow agent_type)" "grown agent file: new row gets the rewritten sidecar's type"

finalize_test
