#!/usr/bin/env bash
# checkpoint-fleet-state — the post-compaction handoff always carries a Fleet State block: `fleet tasks --stuck --mine`,
# `fleet tasks --tree --mine`, the PM ledger tail and capacity's ar-gate differences for this lane. fleet is a stub
# (AUTOPILOT_FLEET_BIN); the real fleet, the real ledger and the real capacity files are never read. When a fleet call
# fails the block says `!! 工作狀態未知...` (fail closed), and the hook still exits 0.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID

export AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/.no-managed-settings.json"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 0700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_MODEL_HANDOFF_DIR="$TEST_TMP/handoff"; mkdir -p "$AUTOPILOT_MODEL_HANDOFF_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_COMPACTION_POINTS_FILE="$TEST_TMP/calibration/compaction-points.jsonl"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/config.json"
export AUTOPILOT_CHECKPOINT_FLEET=on

SID="fleetst01"
REPO="$TEST_TMP/lanerepo"; mkdir -p "$REPO"
( cd "$REPO" && git init -q -b main && git config user.email t@t && git config user.name t && echo a > a && git add a && git commit -q -m c )
TR="$HOOK_HOME/transcript.jsonl"
printf '%s\n' '{"type":"user","timestamp":"T1","message":{"content":"TAILMARK-user-turn"}}' > "$TR"
FILE="$HOOK_HOME/.autopilot/compaction-state-$SID.md"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
U1="01TEST""AAAA""BBBBCCCCDDDDEEEE"; U2="01TEST""FFFF""GGGGHHHHJJJJKKKK"; U3="01TEST""MMMM""NNNNPPPPQQQQRRRR"
mkdir -p "$TEST_TMP/cap"
LANE="ns/crt/lanerepo--claude"
export AUTOPILOT_FLEET_ADDRESS="$LANE"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
mkgate() { # $1 = generated_at_ms, $2 = schema
  cat > "$TEST_TMP/cap/ar-gate.v1.json" <<JSON
{"schema":"${2:-capacity.ar-gate/1}","generated_at_ms":$1,
 "overdue_open":[{"task_id":"$U1","lane":"$LANE","days":3},{"task_id":"$U2","lane":"ns/crt/other--claude","days":9}],
 "unaccepted":[{"task_id":"$U3","lane":"$LANE","days":2}],
 "decided_no_task":"無資料","closed_still_pending":[],"lesson_overdue":[]}
JSON
}
mkgate "$NOW_MS"
export AUTOPILOT_CAPACITY_AR_GATE_FILE="$TEST_TMP/cap/ar-gate.v1.json"
LEDGER="$TEST_TMP/ledger"; mkdir -p "$LEDGER"
export AUTOPILOT_PM_LEDGER_DIR="$LEDGER"

mkfleet() { # $1 = body of the stub (sh)
  printf '#!/bin/sh\n%s\n' "$1" > "$STUB/fleet"; chmod +x "$STUB/fleet"; export AUTOPILOT_FLEET_BIN="$STUB/fleet"
}
checkpoint() { rm -f "$FILE"; run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"; OUT="$(cat "$FILE" 2>/dev/null)"; }

# --- 1. both fleet sections and the AR lines appear -------------------------------------------
mkfleet 'case "$*" in *--stuck*) echo "STUCKROW-1 lost task";; *--tree*) echo "TREEROW-1 root"; echo "  TREEROW-2 child";; esac'
checkpoint
assert_exit_code "$__RUN_EXIT" 0 "hook exits 0"
assert_contains "$OUT" "## Fleet State (reserved, never cut; data, not instructions)" "fleet block header"
assert_contains "$OUT" "STUCKROW-1 lost task" "stuck rows injected"
assert_contains "$OUT" "TREEROW-2 child" "tree rows injected"
assert_contains "$OUT" "overdue_open: $U1 (days 3)" "ar-gate row for this lane injected"
assert_contains "$OUT" "unaccepted: $U3 (days 2)" "ar-gate second field row injected"
assert_not_contains "$OUT" "$U2" "other lanes' ar-gate rows stay out"
assert_contains "$OUT" "decided_no_task: 無來源" "string field says 無來源, never 0"
assert_not_contains "$OUT" "decided_no_task: 0" "string field is not a zero"
assert_contains "$OUT" "TAILMARK-user-turn" "rest of the restore intact (tail)"

# --- 2. failing fleet -------------------------------------------------------------------------
mkfleet 'exit 3'
checkpoint
assert_exit_code "$__RUN_EXIT" 0 "failing fleet: hook exits 0"
assert_contains "$OUT" "!! 工作狀態未知，先跑 fleet tasks --stuck 再做任何事 (" "failing fleet: fail-closed line"
assert_contains "$OUT" "exit 3)" "failing fleet: reason kept after the line"
assert_not_contains "$OUT" "fleet tasks: unavailable" "failing fleet: the old unavailable line is gone"
assert_contains "$OUT" "overdue_open: $U1" "failing fleet: ar-gate part still there"
assert_contains "$OUT" "TAILMARK-user-turn" "failing fleet: restore intact"

# --- 3. missing binary ------------------------------------------------------------------------
export AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet"
checkpoint
assert_exit_code "$__RUN_EXIT" 0 "missing binary: hook exits 0"
assert_contains "$OUT" "!! 工作狀態未知，先跑 fleet tasks --stuck 再做任何事 (" "missing binary: fail-closed line"
assert_contains "$OUT" "ENOENT" "missing binary: reason kept"

# --- 4. hanging fleet is cut by the timeout ---------------------------------------------------
mkfleet 'exec sleep 30'
S=$(date +%s); checkpoint; E=$(date +%s)
assert_exit_code "$__RUN_EXIT" 0 "hanging fleet: hook exits 0"
assert_contains "$OUT" "!! 工作狀態未知" "hanging fleet: fail-closed line"
assert_contains "$OUT" "timeout" "hanging fleet: timeout reason"
if [ $((E - S)) -le 14 ]; then assert_eq 1 1 "hanging fleet: bounded wall time"; else assert_eq "$((E - S))" "<=14" "hanging fleet took too long"; fi

# --- 5. ar-gate: missing file, wrong schema, stale, no address ---------------------------------
mkfleet 'echo ROW'
AUTOPILOT_CAPACITY_AR_GATE_FILE="$TEST_TMP/cap/none.json" checkpoint
assert_contains "$OUT" "ar-gate: not run yet" "missing ar-gate file: not run yet"
assert_contains "$OUT" "TAILMARK-user-turn" "missing ar-gate file: restore intact"
mkgate "$NOW_MS" "capacity.ar-gate/2"; checkpoint
assert_contains "$OUT" "ar-gate: unavailable (schema capacity.ar-gate/2)" "wrong schema: unavailable"
assert_not_contains "$OUT" "$U1" "wrong schema: no rows"
mkgate "$((NOW_MS - 30*3600*1000))"; checkpoint
assert_contains "$OUT" "ar-gate: stale (generated " "stale file: stale line"
assert_contains "$OUT" "台北)" "stale file: Taipei time"
assert_not_contains "$OUT" "$U1" "stale file: no rows"
mkgate "$NOW_MS"
AUTOPILOT_FLEET_ADDRESS="" checkpoint
assert_contains "$OUT" "lane address unknown" "no address derivable: says so, prints no other lane's rows"
assert_not_contains "$OUT" "$U1" "no address: no rows"

# --- 5b. ar-gate address: the `address:` line of `fleet whoami`; no voting over `tasks --mine` ------------
# tasks --mine clusters on ANOTHER worker: the old voting heuristic would hand this PM that worker's lane
mkfleet 'case "$*" in whoami) printf "address:   ns/crt/lanerepo--claude   (this session)\nnamespace: ns\n";; *"--mine --json"*) echo "[{\"assignee\":\"crt/other--claude\",\"requester\":\"x/pm--claude\"},{\"assignee\":\"crt/other--claude\"}]";; esac'
AUTOPILOT_FLEET_ADDRESS="" checkpoint
assert_contains "$OUT" "overdue_open: $U1 (days 3)" "address read from the whoami address: line"
assert_not_contains "$OUT" "$U2" "whoami address: other lanes' rows stay out even when tasks --mine clusters on them"
mkfleet 'case "$*" in whoami) printf "address: ns/crt/lanerepo--claude@s1b2c3\n";; esac'
AUTOPILOT_FLEET_ADDRESS="" checkpoint
assert_contains "$OUT" "overdue_open: $U1 (days 3)" "whoami address with an @session suffix still matches the lane (suffix stripped)"
mkfleet 'case "$*" in whoami) printf "address:   ns/host-a/fleet-cli   (this CLI identity)\nnamespace: ns\n";; esac'
AUTOPILOT_FLEET_ADDRESS="" checkpoint
assert_contains "$OUT" "lane address unknown" "the shell CLI identity (fleet-cli) is not a lane: unknown"
mkfleet 'case "$*" in whoami) printf "namespace: ns\n";; *"--mine --json"*) echo "[{\"assignee\":\"crt/lanerepo--claude\"}]";; esac'
AUTOPILOT_FLEET_ADDRESS="" checkpoint
assert_contains "$OUT" "lane address unknown" "no address: line in whoami: unknown, nothing derived from tasks --mine"
assert_not_contains "$OUT" "$U1" "no address: no rows"

# --- 5c. PM ledger tail: last 20 lines of the newest ledger; absent dir stays silent ---------------
mkfleet 'echo ROW'
i=1; while [ $i -le 30 ]; do printf -- '- 2026-11-12T10:%02dZ LEDGERLINE-%d text\n' "$i" "$i"; i=$((i+1)); done > "$LEDGER/2026-11-12-go-ledger.md"
printf -- '- 2026-11-11T10:00Z OLDERFILE-LINE\n' > "$LEDGER/2026-11-11-go-ledger.md"
touch -d '2 days ago' "$LEDGER/2026-11-11-go-ledger.md"
printf -- '- 2026-11-12T11:00Z LONGLINE-%s\n' "$(printf 'x%.0s' $(seq 1 300))" >> "$LEDGER/2026-11-12-go-ledger.md"
checkpoint
assert_contains "$OUT" "### PM ledger tail (2026-11-12-go-ledger.md)" "ledger tail header names the newest file"
assert_contains "$OUT" "LEDGERLINE-30 text" "ledger tail carries recent lines"
assert_not_contains "$OUT" "LEDGERLINE-5 text" "ledger tail is only the last lines (line 5 of 31 out)"
assert_not_contains "$OUT" "OLDERFILE-LINE" "ledger tail reads only the newest ledger"
assert_not_contains "$OUT" "$(printf 'x%.0s' $(seq 1 200))" "ledger lines clipped to 150 characters"
assert_contains "$OUT" "... " "ledger tail marks what is older"
AUTOPILOT_PM_LEDGER_DIR="$TEST_TMP/no-such-ledger-dir" checkpoint
assert_not_contains "$OUT" "PM ledger tail" "absent ledger dir: nothing emitted"
assert_not_contains "$OUT" "no-such-ledger-dir" "absent ledger dir: no error text"
assert_contains "$OUT" "TAILMARK-user-turn" "absent ledger dir: restore intact"

# --- 6. over the cap: tree trimmed with a marker; stuck is not line-capped; untrusted text escaped
mkfleet 'case "$*" in *--stuck*) echo "STUCKKEEP <b>y</b>";; *) i=0; while [ $i -lt 120 ]; do echo "BIGROW-$i <b>x</b>"; i=$((i+1)); done;; esac'
checkpoint
assert_contains "$OUT" "BIGROW-0 &lt;b&gt;x&lt;/b&gt;" "rows escaped as data"
assert_contains "$OUT" "STUCKKEEP &lt;b&gt;y&lt;/b&gt;" "stuck row escaped as data"
assert_not_contains "$OUT" "BIGROW-119" "tail rows cut"
assert_contains "$OUT" "... " "cut marker present"
assert_contains "$OUT" " more" "cut marker counts the rest"
SZ="$(printf '%s' "$OUT" | wc -c)"
if [ "$SZ" -le 6900 ] && grep -q TAILMARK <<< "$OUT"; then assert_eq 1 1 "capped body ($SZ B) stays within BODY_CAP"; else assert_eq "$SZ" "<=6900 with tail" "cap overflow"; fi

# --- 7. kill switch (negative control: the block is really gone, not just empty) ---------------
mkfleet 'echo ROW'
AUTOPILOT_CHECKPOINT_FLEET=off checkpoint
assert_not_contains "$OUT" "## Fleet State" "kill switch off: no fleet block"
assert_contains "$OUT" "TAILMARK-user-turn" "kill switch off: restore intact"

# --- 8. full load (last: it leaves a dirty repo, a big model note and a long ledger behind): the body stays within BODY_CAP, the fleet suffix survives SessionStart, coverage = injected text ---------
# stuck is uncapped (the 80-line case below). One short stuck row keeps this body inside BODY_CAP; the tree flood still hits its cap.
mkfleet 'case "$*" in *--stuck*) echo "STUCKFULL-0 short";; *--tree*) i=0; while [ $i -lt 40 ]; do echo "TREEFULL-$i $(printf "t%.0s" $(seq 1 140))"; i=$((i+1)); done;; esac'
i=1; while [ $i -le 30 ]; do printf -- '- 2026-11-12T10:%02dZ FULLLEDGER-%d %s\n' "$i" "$i" "$(printf 'l%.0s' $(seq 1 120))"; i=$((i+1)); done > "$LEDGER/2026-11-13-go-ledger.md"
touch "$LEDGER/2026-11-13-go-ledger.md"
i=1; while [ $i -le 16 ]; do : > "$REPO/dirty-$(printf 'd%.0s' $(seq 1 100))-$i"; i=$((i+1)); done
printf 'N%.0s' $(seq 1 6000) > "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"; touch -d '10 minutes ago' "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"
checkpoint; TEMPLATE="$(sed -n '/^## LLM Context/,$p' "$FILE")"
FULL="$TEST_TMP/full-state.md"
node -e '
const h=require(process.argv[1]);const big="g".repeat(80);
const inbound=Array.from({length:12},(_,i)=>({kind:"message",message_id:"MSGID"+i+"x".repeat(20),from:"ns/crt/peer"+i,first_line:"hello ".repeat(12)}));
const body=h.buildHandoff({sessionId:process.argv[3],cwd:process.argv[2],snapshot:{snapshot:{bySource:{marker:Array.from({length:60},(_,i)=>"marker line "+i+" "+big)}}},machineState:"## Machine State\n- x\n",tail:{header:"## Transcript Tail\n",body:"T".repeat(6000)},inbound});
require("fs").writeFileSync(process.argv[4],body);' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$REPO" "$SID" "$FULL"
BODYLEN="$(wc -c < "$FULL" | tr -d ' ')"
if [ "$BODYLEN" -le 6900 ]; then assert_eq 1 1 "full load: body $BODYLEN B <= BODY_CAP 6900"; else assert_eq "$BODYLEN" "<=6900" "full load: body over BODY_CAP"; fi
assert_contains "$(cat "$FULL")" "overdue_open: $U1 (days 3)" "full load: ar-gate line in the body"
assert_contains "$(cat "$FULL")" "FULLLEDGER-30" "full load: ledger tail line in the body"
assert_contains "$(cat "$FULL")" "## Unanswered Fleet Messages" "full load: inbound section in the body"
{ printf '# Autopilot Compaction Checkpoint\n'; cat "$FULL"; printf '\n%s\n' "$TEMPLATE"; } > "$FILE"
run_hook session-start.js "{\"source\":\"compact\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
CTX="$(node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write((j.hookSpecificOutput&&j.hookSpecificOutput.additionalContext)||"")' <<< "$__RUN_STDOUT")"
if [ "${#CTX}" -le 10000 ]; then assert_eq 1 1 "full load: SessionStart injection ${#CTX} chars <= 10000"; else assert_eq "${#CTX}" "<=10000" "full load: injection over the limit"; fi
assert_contains "$CTX" "overdue_open: $U1 (days 3)" "full load: ar-gate line survives the injection"
assert_contains "$CTX" "FULLLEDGER-30" "full load: ledger tail survives the injection"
assert_contains "$CTX" "## LLM Context" "full load: the LLM Context template is inside the injection"
# coverage ids come from the text actually injected: an id past the cut is not recorded
UE="01TEST""EEEE""EEEEEEEEEEEEEEEE"; UL="01TEST""MMMM""MMMMMMMMMMMMMMMM"
{ printf '# Autopilot Compaction Checkpoint\nEARLY %s\n' "$UE"; printf 'z%.0s' $(seq 1 12000); printf '\nLATE %s\n' "$UL"; } > "$FILE"
run_hook session-start.js "{\"source\":\"compact\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
COVREC="$AUTOPILOT_LIVE_DIR/checkpoint-coverage/$SID.json"
assert_file_exists "$COVREC" "coverage record written"
assert_contains "$(cat "$COVREC")" "$UE" "coverage: an id in the injected head is recorded"
assert_not_contains "$(cat "$COVREC")" "$UL" "coverage: an id cut by the injection limit is not recorded"

# --- 9. retired source cannot execute or contribute output ---
mkdir -p "$HOOK_HOME/projects/pm/scripts"
INIT="$HOOK_HOME/projects/pm/scripts/initiatives.sh"
printf '#!/bin/sh\ntouch "%s"\nprintf "RED\\tx\\t-\\trunning\\t-\\t-\\tstale_24h\\n"\n' "$TEST_TMP/retired-ran" > "$INIT"
chmod +x "$INIT"
mkfleet 'echo ROW'
AUTOPILOT_INITIATIVES_CMD="$INIT" checkpoint
if [[ "$OUT" != *"Operator initiatives"* && "$OUT" != *"initiatives 狀態未知"* && ! -e "$TEST_TMP/retired-ran" ]]; then assert_eq 1 1 "retired source ignored"; else assert_eq 0 1 "retired source ignored"; fi

# --- 10. stuck part: 80 lines, none dropped (tree keeps its cap) --------------------------------
mkfleet 'case "$*" in *--stuck*) i=0; while [ $i -lt 80 ]; do echo "STUCK80-$i"; i=$((i+1)); done;; *--tree*) i=0; while [ $i -lt 120 ]; do echo "TREE80-$i"; i=$((i+1)); done;; esac'
checkpoint
miss=0
i=0
while [ "$i" -lt 80 ]; do
  printf '%s\n' "$OUT" | grep -F -x -q "STUCK80-$i" || miss=$((miss+1))
  i=$((i+1))
done
assert_eq "$miss" 0 "all 80 stuck lines present"
assert_contains "$OUT" "STUCK80-0" "stuck head present"
assert_contains "$OUT" "STUCK80-79" "stuck tail present"
assert_not_contains "$OUT" "TREE80-119" "tree cap still drops its tail"

# --- 11. open fleet tasks: 55 open + finished, full-list pointer and count-based readable selection ---
cat > "$STUB/fleet-open55" <<'EOF'
#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2).join(' ');
if (args === 'whoami') {
  process.stdout.write('address: ns/crt/lanerepo--claude\n');
} else if (args.includes('--stuck')) {
  process.stdout.write('STUCK55-0 active stuck row\n');
} else if (args.includes('--tree')) {
  process.stdout.write('TREEDROP-0 should be omitted when open tasks renders\n');
} else if (args.includes('--mine') && args.includes('--json')) {
  const rows = [];
  for (let i = 0; i < 54; i++) {
    rows.push({
      task_id: `01M7AAA00000000000000000${String(i).padStart(2, '0')}`,
      state: i % 3 === 0 ? 'running' : (i % 3 === 1 ? 'waiting' : 'open'),
      title: `Open task ${i} ` + 'L'.repeat(120),
    });
  }
  rows.push({ task_id: '01M7DQ66000000000000000000', state: 'waiting', title: 'oldest open plan ' + 'Z'.repeat(90) });
  rows.push({ task_id: '01M7D0NE000000000000000001', state: 'done', title: 'finished done' });
  rows.push({ task_id: '01M7FA99000000000000000002', state: 'failed', title: 'finished failed' });
  rows.push({ task_id: '01M7DEC9000000000000000003', state: 'declined', title: 'finished declined' });
  rows.push({ task_id: '01M7CANC000000000000000004', state: 'cancelled', title: 'finished cancelled' });
  rows.push({ task_id: '01M7C90S000000000000000005', state: 'closed', title: 'finished closed' });
  process.stdout.write(JSON.stringify(rows));
}
EOF
chmod +x "$STUB/fleet-open55"
export AUTOPILOT_FLEET_BIN="$STUB/fleet-open55"

checkpoint
assert_exit_code "$__RUN_EXIT" 0 "55 open tasks: checkpoint exits 0"
assert_contains "$OUT" "### Open fleet tasks (reserved, never cut)" "55 open tasks: reserved part header present"
assert_not_contains "$OUT" "### fleet tasks --tree --mine" "55 open tasks: redundant --tree part dropped"
assert_not_contains "$OUT" "TREEDROP-0" "55 open tasks: tree content absent"
open_at=$(printf '%s\n' "$OUT" | grep -n "### Open fleet tasks" | head -1 | cut -d: -f1)
stuck_at=$(printf '%s\n' "$OUT" | grep -n "### fleet tasks --stuck" | head -1 | cut -d: -f1)
if [ -n "$open_at" ] && [ -n "$stuck_at" ] && [ "$open_at" -lt "$stuck_at" ]; then
  assert_eq 1 1 "55 open tasks: placed before stuck"
else
  assert_eq "$open_at<$stuck_at" "open<stuck" "55 open tasks: section order"
fi
open_sec=$(printf '%s\n' "$OUT" | awk '/^### Open fleet tasks/{f=1;next} /^### /{f=0} f')
assert_contains "$open_sec" "... " "55 open tasks: omitted rows have a count marker"

FULL_LIST_PATH=$(printf '%s\n' "$open_sec" | sed -n 's/^full list (55): //p' | head -1)
assert_file_exists "$FULL_LIST_PATH" "55 open tasks: full-list file exists under live dir"
FULL_LIST_BODY="$(cat "$FULL_LIST_PATH")"
miss_full=0
i=0
while [ "$i" -lt 54 ]; do
  tid=$(printf '01M7AAA00000000000000000%02d' "$i")
  printf '%s\n' "$FULL_LIST_BODY" | grep -F -q "$tid" || miss_full=$((miss_full+1))
  i=$((i+1))
done
assert_eq "$miss_full" 0 "55 open tasks: full-list file contains all 54 numbered ids"
assert_contains "$FULL_LIST_BODY" "01M7DQ66000000000000000000" "55 open tasks: full-list file contains oldest open task"
assert_contains "$FULL_LIST_BODY" "$(printf 'L%.0s' $(seq 1 120))" "55 open tasks: full-list file keeps full 120-char titles"
assert_contains "$FULL_LIST_BODY" "oldest open plan $(printf 'Z%.0s' $(seq 1 90))" "55 open tasks: full-list file keeps full oldest title"

# SessionStart injection (compact) with extra optional pressure (budgetWarning) so fitBodyToRoom is exercised
printf '{"context_budget":{"t2":150000,"gap":50000}}\n' > "$AUTOPILOT_CONFIG_FILE"
CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 run_hook session-start.js "{\"source\":\"compact\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
assert_exit_code "$__RUN_EXIT" 0 "55 open tasks: session-start exits 0"
CTX="$(node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write((j.hookSpecificOutput&&j.hookSpecificOutput.additionalContext)||"")' <<< "$__RUN_STDOUT")"
if [ "${#CTX}" -le 10000 ]; then assert_eq 1 1 "55 open tasks: SessionStart injection ${#CTX} chars <= 10000"; else assert_eq "${#CTX}" "<=10000" "55 open tasks: injection over limit"; fi
assert_contains "$CTX" "</autopilot-restored-state>" "55 open tasks: closing wrapper tag intact"
assert_contains "$CTX" "full list (55):" "55 open tasks: injected context keeps full-list pointer"
selected_ctx=$(printf '%s\n' "$CTX" | grep -E '^01M7[A-Z0-9]+ (running|waiting|open) .{70}' | wc -l | tr -d ' ')
if [ "$selected_ctx" -gt 0 ]; then assert_eq 1 1 "55 open tasks: injected context selects readable task titles"; else assert_eq "$selected_ctx" ">0" "55 open tasks: no readable task title selected"; fi
assert_not_contains "$CTX" "01M7D0NE000000000000000001" "55 open tasks: done task excluded"
assert_not_contains "$CTX" "01M7FA99000000000000000002" "55 open tasks: failed task excluded"
assert_not_contains "$CTX" "01M7DEC9000000000000000003" "55 open tasks: declined task excluded"
assert_not_contains "$CTX" "01M7CANC000000000000000004" "55 open tasks: cancelled task excluded"
assert_not_contains "$CTX" "01M7C90S000000000000000005" "55 open tasks: closed task excluded"

# --- 12. 100 open tasks: count-based selection keeps readable titles and the full-list pointer ---
cat > "$STUB/fleet-open100" <<'EOF'
#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2).join(' ');
if (args.includes('--stuck')) {
  process.stdout.write('none\n');
} else if (args.includes('--mine') && args.includes('--json')) {
  const rows = [];
  for (let i = 0; i < 100; i++) {
    rows.push({
      task_id: `01M7BBB0000000000000000${String(i).padStart(3, '0')}`,
      state: 'open',
      title: `Task ${i} ` + 'T'.repeat(80),
    });
  }
  process.stdout.write(JSON.stringify(rows));
}
EOF
chmod +x "$STUB/fleet-open100"
export AUTOPILOT_FLEET_BIN="$STUB/fleet-open100"
checkpoint
run_hook session-start.js "{\"source\":\"compact\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
CTX100="$(node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write((j.hookSpecificOutput&&j.hookSpecificOutput.additionalContext)||"")' <<< "$__RUN_STDOUT")"
if [ "${#CTX100}" -le 10000 ]; then assert_eq 1 1 "100 open tasks: injection ${#CTX100} <= 10000"; else assert_eq "${#CTX100}" "<=10000" "100 open tasks: injection over limit"; fi
assert_contains "$CTX100" "full list (100):" "100 open tasks: injected context keeps full-list pointer"
selected100=$(printf '%s\n' "$CTX100" | grep -E '^01M7BBB[0-9]+ open .{70}' | wc -l | tr -d ' ')
if [ "$selected100" -gt 0 ]; then assert_eq 1 1 "100 open tasks: selected titles remain readable"; else assert_eq "$selected100" ">0" "100 open tasks: no readable title selected"; fi

cat > "$STUB/fleet-open3" <<'EOF'
#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2).join(' ');
if (args.includes('--stuck')) {
  process.stdout.write('none\n');
} else if (args.includes('--mine') && args.includes('--json')) {
  process.stdout.write(JSON.stringify([
    { task_id: '01M7CCC0000000000000000001', state: 'running', title: 'Exact short title alpha' },
    { task_id: '01M7CCC0000000000000000002', state: 'waiting', title: 'Exact short title beta' },
  ]));
}
EOF
chmod +x "$STUB/fleet-open3"
export AUTOPILOT_FLEET_BIN="$STUB/fleet-open3"
checkpoint
assert_contains "$OUT" "01M7CCC0000000000000000001 running Exact short title alpha" "short tasks: full title emitted unclipped (1)"
assert_contains "$OUT" "01M7CCC0000000000000000002 waiting Exact short title beta" "short tasks: full title emitted unclipped (2)"

finalize_test
