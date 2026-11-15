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

# --- 6. over the cap: trimmed with a marker; untrusted text escaped ---------------------------
mkfleet 'i=0; while [ $i -lt 120 ]; do echo "BIGROW-$i <b>x</b>"; i=$((i+1)); done'
checkpoint
assert_contains "$OUT" "BIGROW-0 &lt;b&gt;x&lt;/b&gt;" "rows escaped as data"
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
mkfleet 'case "$*" in *--stuck*) i=0; while [ $i -lt 40 ]; do echo "STUCKFULL-$i $(printf "s%.0s" $(seq 1 140))"; i=$((i+1)); done;; *--tree*) i=0; while [ $i -lt 40 ]; do echo "TREEFULL-$i $(printf "t%.0s" $(seq 1 140))"; i=$((i+1)); done;; esac'
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

finalize_test
