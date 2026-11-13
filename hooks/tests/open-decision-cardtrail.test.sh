#!/usr/bin/env bash
# BL cardtrail: `open-decision.js close` keeps the card (status closed, closed_at, answer), `show --id` finds a closed card, `list` hides closed ones
# unless --all. `close --answer --executor` sends NOTHING (PM ruling 01M6RV0Y02, overridden for panel answers by PM 01M6ZXJYTQ, 2026-11-09): it prints one JSON (the executor's dispatch + the asker's fyi, the
# answer verbatim) and parks the card in pending_dispatch; `close --dispatched <task_id>` then closes it. A step only the operator can do goes to
# awaiting_operator_action (`done` ends it, plain `close` is refused). `backfill` is a dry run unless --apply and takes a status per line.
# Negative controls (each shown red before green in the lane logs):
#   NC1 show --id of a CLOSED card (it used to be gone, so the answer only lived in chat);
#   NC2 close --executor must NOT go straight to closed: a sabotaged copy that does is run through the same assertion and must FAIL it;
#   NC3 backfill without --apply writes nothing; NC4 a good line plus a bad line writes neither.
# fleet is the stub below (AUTOPILOT_FLEET_BIN) and must never be called at all.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
STUBLOG="$TEST_TMP/fleet.log"; : > "$STUBLOG"
cat > "$TEST_TMP/fleet" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$STUBLOG"
if [ -n "$STUB_FAIL" ]; then echo "stub: courier down" >&2; exit 3; fi
exit 0
STUB
chmod +x "$TEST_TMP/fleet"
export AUTOPILOT_FLEET_BIN="$TEST_TMP/fleet" STUBLOG
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
D="$R/.git/autopilot/decisions"
EXEC="ns/cc/exec--claude"; ASK="ns/cc/asker--claude"
od() { OUT="$(node "$OD" "$@" --cwd "$R" --root-run-id rt 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
# open refuses a card without --executor (PM 01M6ZXJYTQ), so opencard names one; a card with NO executor can only come from the library (hooks/ask-decision.js), libcard
libcard() { OUT="$(node -e 'const r=require(process.argv[1]).openDecision({cwd:process.argv[2],root:"rt",session:null,question:process.argv[3],options:null,not_authorized:"irreversible"});process.stdout.write(r.id)' "$OD" "$R" "$1" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
opencard() { OUT="$(node "$OD" open --executor "$EXEC" --cwd "$R" --root-run-id rt --question "$1" --free-text --not-authorized irreversible "${@:2}" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
field() { node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const e=v.decisions.find(d=>d.id===process.argv[2]);const x=e?e[process.argv[3]]:undefined;process.stdout.write(x===undefined?"<undef>":String(x))' "$(ls "$D"/*.json | head -1)" "$1" "$2"; }

# 1. open stores executor + asker; close --answer --executor prints JSON, sends nothing, parks the card
opencard "Q1?" --executor "$EXEC" --asker "$ASK"; assert_eq "$RC" 0 "open with --executor/--asker: exit 0"; C1="$OUT"
assert_eq "$(field "$C1" executor)" "$EXEC" "open stored executor"; assert_eq "$(field "$C1" asker)" "$ASK" "open stored asker"
assert_eq "$(field "$C1" status)" "open" "open card has status open"
ANS=$'--rm -rf $(touch /tmp/x1); `id` ; "quoted" \'single\' \\ back\nline2 \tTab 中文：就照 A 做 -- end'
printf '%s' "$ANS" > "$TEST_TMP/ans.txt"
od close --id "$C1" --answer "$ANS"; assert_eq "$RC" 0 "close --answer (card has executor): exit 0"
# stdout is exactly one JSON document; every checked field comes out of JSON.parse
pj() { printf '%s' "$OUT" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));const f=process.argv[1].split(".");let x=j;for(const k of f){x=x==null?undefined:x[k]}process.stdout.write(x===undefined?"<undef>":(typeof x==="string"?x:JSON.stringify(x)))' "$1"; }
assert_eq "$(printf '%s' "$OUT" | node -e 'try{JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write("valid")}catch(e){process.stdout.write("INVALID")}')" "valid" "close --executor: stdout is valid JSON"
assert_eq "$(pj dispatch.to)" "$EXEC" "JSON dispatch.to is the executor"; assert_eq "$(pj fyi.to)" "$ASK" "JSON fyi.to is the asker"
assert_eq "$(pj id)" "$C1" "JSON names the card"; assert_eq "$(pj status)" "pending_dispatch" "JSON says pending_dispatch"
assert_eq "$(printf '%s' "$OUT" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const a=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write([j.answer===a,j.dispatch.task.includes(a),j.dispatch.task.includes(process.argv[2]),j.fyi.text.includes(a)].join())' "$TEST_TMP/ans.txt" "$C1")" "true,true,true,true" "answer survives JSON.parse byte for byte, in answer, task (with card id) and fyi"
assert_eq "$(field "$C1" status)" "pending_dispatch" "NC2 card is pending_dispatch, NOT closed, after close --executor"
case "$(field "$C1" pending_dispatch_at)" in 20??-??-??T??:??:??.???Z) assert_eq 1 1 "pending_dispatch_at is ISO UTC";; *) fail "pending_dispatch_at not ISO UTC: $(field "$C1" pending_dispatch_at)";; esac
assert_eq "$(field "$C1" closed_at)" "<undef>" "no closed_at yet"
assert_eq "$(cat "$TEST_TMP/ans.txt")" "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.decisions.find(d=>d.id===process.argv[2]).answer)' "$(ls "$D"/*.json | head -1)" "$C1")" "stored answer is verbatim"
assert_eq "$(cat "$STUBLOG")" "" "close sent nothing: fleet was never called"
od list; assert_contains "$OUT" "$C1" "list shows the pending_dispatch card (it is not closed)"; assert_contains "$OUT" "status: pending_dispatch" "list marks the status"
assert_contains "$OUT" "open decisions: 0" "a pending_dispatch card is not counted as an open decision"; assert_contains "$OUT" "pending_dispatch: 1" "its own count"
od close --id "$C1" --answer "again"; assert_eq "$RC" 2 "close again of a pending_dispatch card: refused"; assert_contains "$ERR" "--dispatched" "refusal points at --dispatched"
assert_eq "$(field "$C1" answer)" "$ANS" "refused close did not overwrite the answer"
od close --id "$C1" --dispatched "task-77"; assert_eq "$RC" 0 "--dispatched on pending_dispatch: exit 0"
assert_eq "$(field "$C1" status)" "closed" "--dispatched closes the card"; assert_eq "$(field "$C1" dispatched_task_id)" "task-77" "dispatched_task_id recorded"
assert_neq "$(field "$C1" closed_at)" "<undef>" "closed_at recorded"
od close --id "$C1" --dispatched "task-78"; assert_eq "$RC" 2 "--dispatched on a closed card: refused"; assert_contains "$ERR" "pending_dispatch" "reason names the state needed"
assert_eq "$(field "$C1" dispatched_task_id)" "task-77" "refused --dispatched changed nothing"
od list; assert_eq "$RC" 1 "list: closed card is not listed (exit 1, none open)"; assert_contains "$OUT" "no open decision" "list says none open"
od list --all; assert_eq "$RC" 0 "list --all: exit 0"; assert_contains "$OUT" "$C1" "list --all shows the closed card"
# NC1: show --id finds the closed card with its answer
od show --id "$C1"; assert_eq "$RC" 0 "NC1 show --id of a closed card: exit 0"; assert_contains "$OUT" "status: closed" "NC1 show --id: status"; assert_contains "$OUT" "就照 A 做" "NC1 show --id: answer text"
od show --id d-nope; assert_eq "$RC" 1 "show --id of an unknown card: exit 1"
od close --id d-nope --dispatched t1; assert_eq "$RC" 2 "--dispatched on an unknown card: refused"

# 2. executor given at close; none anywhere -> warning, direct close
libcard "Q2?"; C2="$OUT"
od close --id "$C2" --answer "no executor here"; assert_eq "$RC" 0 "no executor anywhere: still closes, exit 0"
assert_contains "$OUT" "沒有 executor，不會派工" "warns there is no executor"; assert_eq "$(field "$C2" status)" "closed" "no executor: card closed directly"
libcard "Q3?"; C3="$OUT"
od close --id "$C3" --answer "x" --executor "$EXEC"; assert_eq "$RC" 0 "executor given at close: exit 0"
assert_eq "$(pj dispatch.to)" "$EXEC" "close --executor: dispatch JSON"; assert_eq "$(pj fyi)" "null" "no asker -> fyi null"; assert_eq "$(field "$C3" status)" "pending_dispatch" "executor given at close: pending_dispatch"
od close --id "$C3" --dispatched t3 >/dev/null; od close --id "$C3" --dispatched t4; assert_eq "$RC" 2 "second --dispatched refused"
for st in open; do opencard "Q-D?"; CD="$OUT"; od close --id "$CD" --dispatched t9; assert_eq "$RC" 2 "--dispatched on an $st card: refused"; assert_eq "$(field "$CD" status)" "open" "still open"; od close --id "$CD" >/dev/null; done

# 4. awaiting_operator_action
opencard "Q5?" --executor "$EXEC"; C5="$OUT"
od close --id "$C5" --answer "run the script" --awaiting-operator "跑 scripts/x.sh"; assert_eq "$RC" 0 "awaiting + executor: exit 0"
assert_eq "$(pj status)" "awaiting_operator_action" "awaiting + executor: JSON status"; assert_eq "$(pj dispatch.to)" "$EXEC" "awaiting + executor: dispatch JSON printed"
assert_contains "$(pj dispatch.task)" "操作員本人動手" "the executor is told the operator still has a step"
assert_eq "$(field "$C5" status)" "awaiting_operator_action" "status awaiting_operator_action"; assert_eq "$(field "$C5" awaiting_operator)" "跑 scripts/x.sh" "the step is stored"
assert_eq "$(field "$C5" executor)" "$EXEC" "executor recorded on the awaiting card"
od list; assert_contains "$OUT" "$C5" "list shows an awaiting card (it is not closed)"; assert_contains "$OUT" "status: awaiting_operator_action" "list marks the status"
assert_contains "$OUT" "open decisions: 0" "an awaiting card is not counted as an open decision"; assert_contains "$OUT" "awaiting_operator_action: 1" "its own count"
libcard "Q5b?"; C5B="$OUT"; od close --id "$C5B" --answer "do it" --awaiting-operator "step b"; assert_eq "$RC" 0 "awaiting without executor: exit 0"; assert_contains "$OUT" "awaiting_operator_action $C5B" "awaiting (no executor) says so"
assert_eq "$(cat "$STUBLOG")" "" "awaiting path sent nothing either"
od close --id "$C5"; assert_eq "$RC" 2 "plain close of an awaiting card is refused"; assert_contains "$ERR" "done --id" "refusal points at done"
od close --id "$C5" --dispatched t1; assert_eq "$RC" 2 "--dispatched on an awaiting card: refused"
assert_eq "$(field "$C5" status)" "awaiting_operator_action" "still awaiting after the refused closes"
od done --id "$C1"; assert_contains "$OUT" "already closed" "done on a closed card is idempotent"
opencard "Q6?"; C6="$OUT"; od done --id "$C6"; assert_eq "$RC" 2 "done on an open card is refused"
od done --id "$C5"; assert_eq "$RC" 0 "done: exit 0"; assert_eq "$(field "$C5" status)" "closed" "done closes it"
assert_neq "$(field "$C5" closed_at)" "<undef>" "done sets closed_at"; assert_eq "$(field "$C5" answer)" "run the script" "done keeps the answer"
od done --id "$C5B" >/dev/null

# 5. argument checks
od close --id "$C6" --answer a --option X; assert_eq "$RC" 2 "--answer with --option: usage exit 2"
od close --id "$C6" --executor "$EXEC"; assert_eq "$RC" 2 "--executor without --answer: usage exit 2"
od close --id "$C6" --answer a --executor "x y"; assert_eq "$RC" 2 "--executor not an address: usage exit 2"
od close --id "$C6" --dispatched t --answer a; assert_eq "$RC" 2 "--dispatched with --answer: usage exit 2"
od close --id "$C6" --dispatched "bad id!"; assert_eq "$RC" 2 "--dispatched needs a task id token"
od close --id "$C6"; assert_eq "$RC" 0 "plain close (withdrawal) still works"; assert_eq "$(field "$C6" status)" "closed" "withdrawal kept as closed"; assert_eq "$(field "$C6" answer)" "null" "withdrawal has answer null"

# 6. backfill: dry run by default, status per line
cat > "$TEST_TMP/bf.jsonl" <<JSON
{"id":"d-aaaa1111","question":"old Q A?","answer":"yes A","closed_at":"2026-11-05T02:57:00Z","executor":"$EXEC","asker":"$ASK"}
{"id":"d-bbbb2222","question":"old Q B?","answer":"yes B","closed_at":"2026-11-04T22:16:00Z"}
{"id":"d-dddd4444","question":"old Q D?","answer":"yes D","closed_at":"2026-11-04T22:17:00Z","executor":"$EXEC","status":"awaiting_operator_action"}
{"id":"d-eeee5555","question":"old Q E?","answer":"yes E","closed_at":"2026-11-04T22:18:00Z","status":"closed"}
{"id":"$C1","question":"dup","answer":"dup","closed_at":"2026-11-05T02:57:00Z"}
JSON
BEFORE="$(cat "$D"/*.json | wc -c | tr -d ' ')"
od backfill --from "$TEST_TMP/bf.jsonl"; assert_eq "$RC" 0 "NC3 backfill dry run: exit 0"
assert_contains "$OUT" "DRY RUN" "NC3 says dry run"; assert_contains "$OUT" "would add d-aaaa1111" "NC3 lists what it would add"
assert_contains "$OUT" "status=awaiting_operator_action" "dry run shows the status of an awaiting line"
assert_eq "$(cat "$D"/*.json | wc -c | tr -d ' ')" "$BEFORE" "NC3 dry run wrote nothing"
od show --id d-aaaa1111; assert_eq "$RC" 1 "NC3 dry run: the card is not in the store"
od backfill --from "$TEST_TMP/bf.jsonl" --apply; assert_eq "$RC" 0 "backfill --apply: exit 0"; assert_contains "$OUT" "4 to add, 1 already" "apply counts"
od show --id d-aaaa1111; assert_eq "$RC" 0 "applied card found by show --id"; assert_contains "$OUT" "yes A" "applied card has the answer"; assert_contains "$OUT" "closed_at: 2026-11-05T02:57:00.000Z" "applied card has closed_at"
assert_eq "$(field d-aaaa1111 status)" "closed" "no status on the line = closed"; assert_eq "$(field d-eeee5555 status)" "closed" "status closed on the line = closed"
assert_eq "$(field d-dddd4444 status)" "awaiting_operator_action" "status awaiting_operator_action on the line is kept"
assert_eq "$(field d-dddd4444 executor)" "$EXEC" "the awaiting card keeps its executor"; assert_eq "$(field d-dddd4444 closed_at)" "<undef>" "an awaiting card has no closed_at"
od list; assert_contains "$OUT" "d-dddd4444" "a backfilled awaiting card is listed as live"; assert_not_contains "$OUT" "d-aaaa1111" "a backfilled closed card is not"
assert_eq "$(field "$C1" answer)" "$ANS" "backfill did not overwrite an existing card"
od backfill --from "$TEST_TMP/bf.jsonl" --apply; assert_contains "$OUT" "0 to add, 5 already" "second apply adds nothing"
printf '{"id":"d-cccc3333","question":"q","answer":"","closed_at":"2026-11-05T02:57:00Z"}\n' > "$TEST_TMP/bad.jsonl"
od backfill --from "$TEST_TMP/bad.jsonl" --apply; assert_eq "$RC" 2 "a bad line refuses the run (even with --apply)"; od show --id d-cccc3333; assert_eq "$RC" 1 "bad line wrote nothing"
# NC4: a good line plus a bad status refuses the whole batch, the good line's id is not written either
for badst in open pending_dispatch bogus ""; do
  printf '{"id":"d-good0001","question":"q good","answer":"a","closed_at":"2026-11-05T02:57:00Z"}\n{"id":"d-bad00002","question":"q bad","answer":"a","closed_at":"2026-11-05T02:57:00Z","status":"%s"}\n' "$badst" > "$TEST_TMP/mix.jsonl"
  od backfill --from "$TEST_TMP/mix.jsonl" --apply; assert_eq "$RC" 2 "NC4 status \"$badst\": whole batch refused"; assert_contains "$ERR" "status" "NC4 the reason names status"
  od show --id d-good0001; assert_eq "$RC" 1 "NC4 status \"$badst\": the GOOD line was not written"; od show --id d-bad00002; assert_eq "$RC" 1 "NC4 status \"$badst\": the bad line was not written"
done

# 7. PM 01M79X7T: done --note closes pending_dispatch executed without a dispatch; check order keeps open vs pending_dispatch distinct
od done --id d-dddd4444 >/dev/null
opencard "Q-PD?" --executor "$EXEC"; assert_eq "$RC" 0 "open pending_dispatch test card: exit 0"; CP="$OUT"
od close --id "$CP" --answer "executed directly outside dispatch" >/dev/null; assert_eq "$RC" 0 "park CP in pending_dispatch: exit 0"
assert_eq "$(field "$CP" status)" "pending_dispatch" "CP parked in pending_dispatch"
has_live() { node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const {hasOpenDecision}=require(process.argv[1]);process.stdout.write(String(hasOpenDecision({identity:v.repo_identity,key:v.project_key})))' "$REPO_ROOT/src/status/decision-input.js" "$(ls "$D"/*.json | head -1)"; }
assert_eq "$(has_live)" "true" "patrol/panel reader sees pending_dispatch card as live before done --note"
od close --id "$CP"; assert_eq "$RC" 2 "plain close on pending_dispatch: refused (exit 2)"
assert_contains "$ERR" "--dispatched" "close refusal on pending_dispatch still names --dispatched"
assert_contains "$ERR" "done --id $CP --note" "close refusal on pending_dispatch also names done --id <id> --note"
# (a) done on pending_dispatch without --note (or blank --note) -> exit 2, card unchanged
SNAP_PD="$(cat "$D"/*.json)"
od done --id "$CP"; assert_eq "$RC" 2 "(a) done on pending_dispatch without --note: exit 2"
assert_contains "$ERR" "pending_dispatch" "(a) done without --note names pending_dispatch"
assert_contains "$ERR" "--note" "(a) done without --note tells caller to pass --note"
assert_contains "$ERR" "--dispatched" "(a) done without --note also names close --dispatched"
assert_not_contains "$ERR" "is open," "(a) done on pending_dispatch does not misreport card as open"
assert_eq "$(cat "$D"/*.json)" "$SNAP_PD" "(a) card unchanged after done without --note"
od done --id "$CP" --note "   "; assert_eq "$RC" 2 "(a) done on pending_dispatch with blank --note: exit 2"
assert_contains "$ERR" "--note" "(a) blank --note tells caller to pass non-empty --note"
assert_eq "$(cat "$D"/*.json)" "$SNAP_PD" "(a) card unchanged after blank --note"
# (b) done on pending_dispatch with --note -> closed, closed_via done_without_dispatch, done_note stored, show hides it, show --all shows it closed
od done --id "$CP" --note "  executed directly in commit abc1234  "; assert_eq "$RC" 0 "(b) done on pending_dispatch with --note: exit 0"
assert_eq "$(field "$CP" status)" "closed" "(b) card status is closed"
case "$(field "$CP" closed_at)" in 20??-??-??T??:??:??.???Z) assert_eq 1 1 "(b) closed_at is ISO UTC";; *) fail "(b) closed_at not ISO UTC: $(field "$CP" closed_at)";; esac
assert_eq "$(field "$CP" closed_via)" "done_without_dispatch" "(b) closed_via is done_without_dispatch"
assert_eq "$(field "$CP" done_note)" "executed directly in commit abc1234" "(b) done_note stores trimmed note"
assert_eq "$(field "$CP" dispatched_task_id)" "<undef>" "(b) no dispatched_task_id fabricated"
od show; assert_eq "$RC" 1 "(b) show exits 1 when no live cards remain"; assert_not_contains "$OUT" "$CP" "(b) show no longer lists closed card"
od show --all; assert_eq "$RC" 0 "(b) show --all: exit 0"; assert_contains "$OUT" "$CP" "(b) show --all lists the card"
assert_contains "$OUT" "status: closed" "(b) show --all shows status closed"
assert_contains "$OUT" "closed_via: done_without_dispatch" "(b) show --all shows closed_via"
assert_contains "$OUT" "done_note: executed directly in commit abc1234" "(b) show --all shows done_note"
assert_eq "$(has_live)" "false" "(b) patrol/panel reader treats done_without_dispatch card as closed"
od redeliver --id "$CP"; assert_eq "$RC" 0 "(b) redeliver ignores card closed via done --note"; assert_contains "$OUT" "nothing to redeliver" "(b) redeliver says nothing to redeliver"
# (c) done on an open card -> refused with the open message (negative control for the reorder)
opencard "Q-OPEN?"; CO="$OUT"
od done --id "$CO"; assert_eq "$RC" 2 "(c) done on open card: refused (exit 2)"
assert_contains "$ERR" "$CO is open, not awaiting_operator_action" "(c) done on open card prints the open message"
assert_not_contains "$ERR" "pending_dispatch" "(c) done on open card does not mention pending_dispatch"
assert_eq "$(field "$CO" status)" "open" "(c) open card stays open"
od done --id "$CO" --note "try bypass"; assert_eq "$RC" 2 "(c) done --note on open card: still refused (exit 2)"
assert_contains "$ERR" "$CO is open, not awaiting_operator_action" "(c) done --note on open card still prints the open message"
assert_eq "$(field "$CO" status)" "open" "(c) open card stays open even with --note"
od close --id "$CO" >/dev/null
# (d) awaiting_operator_action done unchanged (--note optional; if given, stored as done_note)
opencard "Q-AW1?" --executor "$EXEC"; CAW1="$OUT"
od close --id "$CAW1" --answer "op step 1" --awaiting-operator "run step 1" >/dev/null
od done --id "$CAW1"; assert_eq "$RC" 0 "(d) awaiting_operator_action done without --note: exit 0"
assert_eq "$(field "$CAW1" status)" "closed" "(d) awaiting card closed"; assert_eq "$(field "$CAW1" done_note)" "<undef>" "(d) no done_note when --note omitted"; assert_eq "$(field "$CAW1" closed_via)" "<undef>" "(d) no closed_via on awaiting done"
opencard "Q-AW2?" --executor "$EXEC"; CAW2="$OUT"
od close --id "$CAW2" --answer "op step 2" --awaiting-operator "run step 2" >/dev/null
od done --id "$CAW2" --note "  operator ran step 2  "; assert_eq "$RC" 0 "(d) awaiting_operator_action done with --note: exit 0"
assert_eq "$(field "$CAW2" status)" "closed" "(d) awaiting card closed with --note"; assert_eq "$(field "$CAW2" done_note)" "operator ran step 2" "(d) awaiting done_note trimmed and stored"; assert_eq "$(field "$CAW2" closed_via)" "<undef>" "(d) awaiting done with --note keeps closed_via unset"
od show --note x; assert_eq "$RC" 2 "stray --note on show: exit 2"
od close --id "$CAW2" --note x; assert_eq "$RC" 2 "stray --note on close: exit 2"

# NC2: a copy of the script whose close --executor goes straight to closed must fail the assertion above (the test sees that mutation)
M="$TEST_TMP/mut"; mkdir -p "$M/scripts"; ln -s "$REPO_ROOT/src" "$M/src"
for f in "$REPO_ROOT"/scripts/*; do [ "$(basename "$f")" = open-decision.js ] || ln -s "$f" "$M/scripts/$(basename "$f")"; done
sed "s/status: 'pending_dispatch', pending_dispatch_at/status: 'closed', closed_at/" "$REPO_ROOT/scripts/open-decision.js" > "$M/scripts/open-decision.js"
cmp -s "$REPO_ROOT/scripts/open-decision.js" "$M/scripts/open-decision.js" && fail "mutation did not change the file"
opencard "Q-MUT?"; CM="$OUT"
node "$M/scripts/open-decision.js" close --id "$CM" --answer "z" --executor "$EXEC" --cwd "$R" --root-run-id rt >/dev/null 2>&1
assert_neq "$(field "$CM" status)" "pending_dispatch" "NC2 the sabotaged close --executor does NOT leave pending_dispatch (so the real assertion would fail on it)"
assert_eq "$(field "$CM" status)" "closed" "NC2 the sabotaged copy closed it directly"
assert_eq "$(cat "$STUBLOG")" "" "fleet was never called in this whole test"
finalize_test
