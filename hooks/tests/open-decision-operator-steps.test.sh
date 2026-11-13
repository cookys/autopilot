#!/usr/bin/env bash
# PM 01M78866 item b: operator_steps on an answered card become awaiting_operator_action;
# a decline stays open with reask_at. Explicit --awaiting-operator still wins.
# Negative control (run by hand, not left in the tree): in awaitingTextFor, replace
# `return joinedOperatorSteps(entry)` with `return null` so the auto transition is skipped.
# (a) and (b) then go red (pending_dispatch, no step N: lines). Restore the return.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export AUTOPILOT_AWAITING_OWNER=off
STUBLOG="$TEST_TMP/fleet.log"; : > "$STUBLOG"
cat > "$TEST_TMP/fleet" <<'STUB'
#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.STUBLOG, a.join(' ') + '\n');
if (a[0] === '--help') {
  const decision = process.env.NO_DECISION ? '' : '  fleet decision claim|verify\n';
  process.stdout.write('usage:\n  fleet send x\n' + decision);
  process.exit(1);
}
if (a[0] === 'send') {
  process.stdout.write(JSON.stringify({ ok: true, message_id: '01MSGSTUBCLAIM' }) + '\n');
  process.exit(0);
}
if (a[0] === 'decision' && a[1] === 'verify') {
  process.stdout.write(JSON.stringify({ outcome: 'verified', option: process.env.STUB_OPTION || '兩個都換', free_text: null }) + '\n');
  process.exit(0);
}
process.exit(1);
STUB
chmod +x "$TEST_TMP/fleet"
export AUTOPILOT_FLEET_BIN="$TEST_TMP/fleet" STUBLOG
export NO_DECISION=1
OD="$REPO_ROOT/scripts/open-decision.js"
HOOK="$REPO_ROOT/hooks/advisory-relay.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
STORE="$R/.git/autopilot/decisions"
EXEC="ns/cc/exec--claude"
od() { OUT="$(node "$OD" "$@" --cwd "$R" --root-run-id rt 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
libcard() { OUT="$(node -e 'const r=require(process.argv[1]).openDecision({cwd:process.argv[2],root:"rt",session:null,question:process.argv[3],options:null,not_authorized:"irreversible",executor:process.argv[4]||undefined,operator_steps:process.argv[5]?process.argv[5].split("\n"):undefined});if(r.status!=="ok"){process.stderr.write(r.message+"\n");process.exit(4)}process.stdout.write(r.id)' "$OD" "$R" "$1" "${2:-}" "${3:-}" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
field() { node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const e=v.decisions.find(d=>d.id===process.argv[2]);const x=e?e[process.argv[3]]:undefined;process.stdout.write(x===undefined?"<undef>":(Array.isArray(x)?JSON.stringify(x):String(x)))' "$(ls "$STORE"/*.json | head -1)" "$1" "$2"; }
schema_ok() { node -e 'const {validateJsonSchema}=require(process.argv[1]+"/scripts/validate-json-schema.js");const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1]+"/schemas/decision.schema.json","utf8"));const r=validateJsonSchema(s,JSON.parse(fs.readFileSync(process.argv[2],"utf8")));if(!r.valid){process.stderr.write(JSON.stringify(r)+"\n");process.exit(1)}' "$REPO_ROOT" "$(ls "$STORE"/*.json | head -1)"; }
first_id() { printf '%s\n' "$1" | sed -n 's/^\[[0-9][0-9]*\] \(d-[0-9a-f][0-9a-f]*\).*/\1/p' | head -1; }
pane_line() { node -e 'const dl=require(process.argv[1]);process.stdout.write(process.argv[2]+"｜"+dl.wire(dl.excerptOf(process.argv[3]))+" → "+dl.wire(process.argv[4])+(process.argv[5]?"｜"+process.argv[5]:""))' "$REPO_ROOT/scripts/lib/decide-line.js" "$1" "$2" "$3" "${4:-}"; }
hook() { HOUT="$(node -e 'process.stdout.write(JSON.stringify({session_id:"opstep",cwd:process.argv[1],prompt:process.argv[2]}))' "$R" "$1" | env AUTOPILOT_AWAITING_OWNER=off AUTOPILOT_RUNS_WATCH_AUTOSTART=0 node "$HOOK" 2>"$TEST_TMP/herr")"; HRC=$?; HERR="$(cat "$TEST_TMP/herr")"; }

# cardState ignores the new fields and gains no status.
node -e '
const { cardState } = require(process.argv[1]);
const open = { status: "open", operator_steps: ["a"], last_answer: "現在不方便", reask_at: "2020-01-01T00:00:00.000Z" };
const awaiting = { status: "awaiting_operator_action", operator_steps: ["a", "b"], awaiting_operator: "a\nb" };
if (cardState(open) !== "open") process.exit(1);
if (cardState(awaiting) !== "awaiting_operator_action") process.exit(2);
if (cardState({ status: "reask", operator_steps: ["a"] }) !== "open") process.exit(3);
if (cardState({}) !== "open") process.exit(4);
' "$REPO_ROOT/src/status/scope-key.js"
assert_eq "$?" 0 "cardState treats operator_steps, last_answer, reask_at as optional and adds no status"

# (a) three steps, newline-separated, answer 兩個都換 -> awaiting, steps 1-3
od open --executor "$EXEC" --question "換哪一把？" --free-text --not-authorized irreversible --operator-step $'換第一把\n換第二把\n登出再登入'
assert_eq "$RC" 0 "(a) open with three newline steps: exit 0"; A="$OUT"
assert_eq "$(field "$A" operator_steps)" '["換第一把","換第二把","登出再登入"]' "(a) operator_steps stored"
schema_ok; assert_eq "$?" 0 "(a) schema accepts operator_steps"
od close --id "$A" --answer "兩個都換"
assert_eq "$RC" 0 "(a) close --answer: exit 0"
assert_eq "$(field "$A" status)" "awaiting_operator_action" "(a) status awaiting"
assert_eq "$(field "$A" awaiting_operator)" $'換第一把\n換第二把\n登出再登入' "(a) awaiting_operator is the steps joined"
assert_eq "$(field "$A" answer)" "兩個都換" "(a) answer stored"
assert_eq "$(field "$A" closed_at)" "<undef>" "(a) not closed"
od show --id "$A"
assert_contains "$OUT" "status: awaiting_operator_action" "(a) show says awaiting"
assert_contains "$OUT" "step 1: 換第一把" "(a) step 1"
assert_contains "$OUT" "step 2: 換第二把" "(a) step 2"
assert_contains "$OUT" "step 3: 登出再登入" "(a) step 3"
assert_not_contains "$OUT" "step 4:" "(a) no fourth step"
assert_not_contains "$OUT" "awaiting_operator:" "(a) multi-line steps are numbered, not one awaiting_operator line"
schema_ok; assert_eq "$?" 0 "(a) schema accepts the awaiting card"

# (b) four separate --operator-step flags
od open --executor "$EXEC" --question "四步？" --free-text --not-authorized irreversible --operator-step 甲 --operator-step 乙 --operator-step 丙 --operator-step 丁
assert_eq "$RC" 0 "(b) open four steps: exit 0"; B="$OUT"
od close --id "$B" --answer "兩個都換"
assert_eq "$RC" 0 "(b) close: exit 0"
assert_eq "$(field "$B" status)" "awaiting_operator_action" "(b) status awaiting"
od show --id "$B"
assert_contains "$OUT" "step 1: 甲" "(b) step 1"
assert_contains "$OUT" "step 2: 乙" "(b) step 2"
assert_contains "$OUT" "step 3: 丙" "(b) step 3"
assert_contains "$OUT" "step 4: 丁" "(b) step 4"
assert_not_contains "$OUT" "step 5:" "(b) no fifth step"

# (c) decline stays open, reask_at about now+4h, last_answer recorded, answer not set
od open --executor "$EXEC" --question "現在能做嗎？" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "(c) open: exit 0"; C="$OUT"
od close --id "$C" --answer "現在不方便"
assert_eq "$RC" 0 "(c) decline: exit 0"
assert_contains "$OUT" "still open $C" "(c) stdout says still open"
assert_eq "$(field "$C" status)" "open" "(c) status stays open"
assert_eq "$(field "$C" last_answer)" "現在不方便" "(c) last_answer"
assert_eq "$(field "$C" answer)" "<undef>" "(c) answer is not set"
assert_eq "$(field "$C" closed_at)" "<undef>" "(c) no closed_at"
assert_eq "$(field "$C" awaiting_operator)" "<undef>" "(c) decline does not await"
node -e 'const t=Date.parse(process.argv[1]); const d=t-Date.now(); if(!(d>3.5*3600e3 && d<4.5*3600e3)) process.exit(1)' "$(field "$C" reask_at)"
assert_eq "$?" 0 "(c) reask_at is about now + 4h"
od show --id "$C"
assert_contains "$OUT" "last_answer: 現在不方便" "(c) show prints last_answer"
assert_contains "$OUT" "reask_at:" "(c) show prints reask_at"
assert_not_contains "$OUT" "re-ask due" "(c) a future reask_at is not due"
schema_ok; assert_eq "$?" 0 "(c) schema accepts last_answer and reask_at"
# case-fold, and an explicit --awaiting-operator does not beat a decline
od open --executor "$EXEC" --question "Later?" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "Later open: exit 0"; CL="$OUT"
od close --id "$CL" --answer "Later" --awaiting-operator "仍不該等" --reask-after 30m
assert_eq "$RC" 0 "Later is a decline: exit 0"
assert_eq "$(field "$CL" status)" "open" "Later stays open"
assert_eq "$(field "$CL" last_answer)" "Later" "Later stored as last_answer"
assert_eq "$(field "$CL" awaiting_operator)" "<undef>" "decline wins over --awaiting-operator"
node -e 'const d=Date.parse(process.argv[1])-Date.now(); if(!(d>20*60e3 && d<40*60e3)) process.exit(1)' "$(field "$CL" reask_at)"
assert_eq "$?" 0 "--reask-after 30m overrides the 4h default"
od open --executor "$EXEC" --question "Not Now?" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "Not Now open"; CN="$OUT"
od close --id "$CN" --answer "Not Now"
assert_eq "$RC" 0 "Not Now decline: exit 0"
assert_eq "$(field "$CN" status)" "open" "Not Now stays open"
assert_eq "$(field "$CN" last_answer)" "Not Now" "Not Now case-folds onto not now"

# (d) no operator_steps: the old close. executor -> pending_dispatch; no executor -> closed
od open --executor "$EXEC" --question "普通題？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "(d) open: exit 0"; D="$OUT"
od close --id "$D" --answer "就這樣"
assert_eq "$RC" 0 "(d) close: exit 0"
assert_eq "$(field "$D" status)" "pending_dispatch" "(d) executor card without steps stays pending_dispatch"
assert_eq "$(field "$D" awaiting_operator)" "<undef>" "(d) no awaiting_operator"
assert_eq "$(field "$D" operator_steps)" "<undef>" "(d) no operator_steps"
libcard "沒有執行者？"; DN="$OUT"
od close --id "$DN" --answer "照舊關閉"
assert_eq "$RC" 0 "(d) no executor: exit 0"
assert_eq "$(field "$DN" status)" "closed" "(d) no executor and no steps closes as before"
od open --executor "$EXEC" --question "later please?" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "later please open"; DP="$OUT"
od close --id "$DP" --answer "later please"
assert_eq "$RC" 0 "later please: exit 0"
assert_eq "$(field "$DP" status)" "pending_dispatch" "later please is not a decline"
assert_eq "$(field "$DP" last_answer)" "<undef>" "later please is a normal answer"
assert_eq "$(field "$DP" reask_at)" "<undef>" "later please sets no reask_at"

# (e) explicit --awaiting-operator still works, and wins over stored steps
od open --executor "$EXEC" --question "顯式步驟？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "(e) open without steps: exit 0"; E="$OUT"
od close --id "$E" --answer "去做" --awaiting-operator "跑 scripts/x.sh"
assert_eq "$RC" 0 "(e) explicit awaiting: exit 0"
assert_eq "$(field "$E" status)" "awaiting_operator_action" "(e) status awaiting"
assert_eq "$(field "$E" awaiting_operator)" "跑 scripts/x.sh" "(e) the explicit step is stored"
od show --id "$E"
assert_contains "$OUT" "awaiting_operator: 跑 scripts/x.sh" "(e) show keeps the single-step line"
od open --executor "$EXEC" --question "覆蓋步驟？" --free-text --not-authorized irreversible --operator-step 換第一把 --operator-step 換第二把
assert_eq "$RC" 0 "(e) open with steps: exit 0"; EO="$OUT"
od close --id "$EO" --answer "兩個都換" --awaiting-operator "只做這一步"
assert_eq "$RC" 0 "(e) explicit overrides steps: exit 0"
assert_eq "$(field "$EO" awaiting_operator)" "只做這一步" "(e) explicit text wins"
assert_eq "$(field "$EO" status)" "awaiting_operator_action" "(e) still awaiting"
od show --id "$EO"
assert_contains "$OUT" "awaiting_operator: 只做這一步" "(e) show prints the explicit step"
assert_not_contains "$OUT" "step 1:" "(e) joined steps are not listed"

# withdrawal still closes, even with steps. --reask-after without an answer is refused.
od open --executor "$EXEC" --question "撤回？" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "withdrawal open"; W="$OUT"
od close --id "$W" --reask-after 1h
assert_eq "$RC" 2 "--reask-after without an answer: exit 2"
od close --id "$W"
assert_eq "$RC" 0 "plain close with steps: exit 0"
assert_eq "$(field "$W" status)" "closed" "withdrawal closes"
assert_eq "$(field "$W" answer)" "null" "withdrawal answer is null"
od close --id "$C" --answer "現在不方便" --reask-after 4hours
assert_eq "$RC" 2 "bad --reask-after: exit 2"
assert_eq "$(field "$C" status)" "open" "bad duration did not change the card"

# re-ask due is listed first
od open --executor "$EXEC" --question "先開的普通卡？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "keeper open"; K="$OUT"
od open --executor "$EXEC" --question "該再問了？" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "due open"; DU="$OUT"
od close --id "$DU" --answer "晚點" --reask-after 0m
assert_eq "$RC" 0 "0m decline: exit 0"
assert_eq "$(field "$DU" status)" "open" "0m decline stays open"
od show
assert_contains "$OUT" "re-ask due" "show marks a past reask_at"
assert_eq "$(first_id "$OUT")" "$DU" "a due card is shown first"
assert_eq "$(printf '%s\n' "$OUT" | grep -c 're-ask due')" "1" "only the due card is marked"

# warning: credential and presence are not boundaries (exit 2) but still warn; external warns and opens; steps suppress the warning
od open --executor "$EXEC" --question "憑證？" --free-text --not-authorized "credential: log in"
assert_eq "$RC" 2 "credential is still an unknown boundary"
assert_contains "$ERR" "pass --operator-step" "credential warns to pass --operator-step"
assert_contains "$ERR" "not a known boundary" "credential is refused by the existing gate"
od open --executor "$EXEC" --question "在場？" --free-text --not-authorized "presence: be there"
assert_eq "$RC" 2 "presence is still an unknown boundary"
assert_contains "$ERR" "pass --operator-step" "presence warns to pass --operator-step"
od open --executor "$EXEC" --question "外部？" --free-text --not-authorized "external: outside"
assert_eq "$RC" 0 "external without steps still opens"
assert_contains "$ERR" "pass --operator-step" "external warns when --operator-step is absent"
EX="$OUT"
od open --executor "$EXEC" --question "外部有步驟？" --free-text --not-authorized "external: outside" --operator-step 登入
assert_eq "$RC" 0 "external with a step opens"
assert_not_contains "$ERR" "pass --operator-step" "a step suppresses the warning"

# panel, no courier: no executor, steps -> awaiting; decline stays open; no steps still closes
unset NO_DECISION
export NO_DECISION=1
: > "$STUBLOG"
libcard "面板三步？" "" $'登入\n跑設定\n人在現場'; P1="$OUT"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$P1" "面板三步？" "兩個都換")")"
assert_eq "$HRC" 0 "panel steps: hook exit 0"
assert_eq "$(field "$P1" status)" "awaiting_operator_action" "panel no-executor with steps is awaiting"
od show --id "$P1"
assert_contains "$OUT" "step 1: 登入" "panel show step 1"
assert_contains "$OUT" "step 2: 跑設定" "panel show step 2"
assert_contains "$OUT" "step 3: 人在現場" "panel show step 3"
libcard "面板稍後？" "" "登入"; P2="$OUT"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$P2" "面板稍後？" "現在不方便")")"
assert_eq "$HRC" 0 "panel decline: hook exit 0"
assert_eq "$(field "$P2" status)" "open" "panel decline stays open"
assert_eq "$(field "$P2" last_answer)" "現在不方便" "panel decline records last_answer"
assert_neq "$(field "$P2" reask_at)" "<undef>" "panel decline sets reask_at"
od show; assert_contains "$OUT" "$P2" "panel decline is still listed"
libcard "面板普通？" ; P3="$OUT"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$P3" "面板普通？" "甲")")"
assert_eq "$HRC" 0 "panel no steps: hook exit 0"
assert_eq "$(field "$P3" status)" "closed" "panel no steps and no decline still closes"
od show; assert_not_contains "$OUT" "$P3" "closed panel card leaves the live list"

# panel, courier: executor + steps is delivered then awaiting; a decline is not sent
unset NO_DECISION
: > "$STUBLOG"
export STUB_OPTION="兩個都換"
od open --executor "$EXEC" --question "派工三步？" --free-text --not-authorized irreversible --operator-step 登入 --operator-step 跑設定 --operator-step 人在現場
assert_eq "$RC" 0 "courier panel open"; P4="$OUT"
AID="ABCDEFGHIJ0123456789ABCD"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$P4" "派工三步？" "兩個都換" "$AID")")"
assert_eq "$HRC" 0 "courier panel: hook exit 0"
assert_eq "$(field "$P4" status)" "awaiting_operator_action" "delivered executor card with steps is awaiting, not closed"
assert_eq "$(field "$P4" dispatched_message_id)" "01MSGSTUBCLAIM" "delivery id kept"
assert_eq "$(field "$P4" closed_at)" "<undef>" "awaiting delivery sets no closed_at"
assert_contains "$(cat "$STUBLOG")" "send " "the answer was sent"
od show --id "$P4"
assert_contains "$OUT" "step 1: 登入" "courier panel step 1"
assert_contains "$OUT" "step 3: 人在現場" "courier panel step 3"
: > "$STUBLOG"
export STUB_OPTION="現在不方便"
od open --executor "$EXEC" --question "派工稍後？" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "courier decline open"; P5="$OUT"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$P5" "派工稍後？" "現在不方便" "$AID")")"
assert_eq "$HRC" 0 "courier decline: hook exit 0"
assert_eq "$(field "$P5" status)" "open" "courier decline stays open"
assert_eq "$(field "$P5" last_answer)" "現在不方便" "courier decline records last_answer"
assert_not_contains "$(cat "$STUBLOG")" "send " "a decline is not sent"
assert_contains "$HERR" "稍後再問" "the hook says the card stays open"

# leaving open (answered or closed) clears reask_at and stops "re-ask due" + list priority
node -e '
const { reaskDue } = require(process.argv[1]);
const past = "2020-01-01T00:00:00.000Z";
if (!reaskDue({ status: "open", reask_at: past })) process.exit(1);
if (!reaskDue({ reask_at: past })) process.exit(2);
if (reaskDue({ status: "closed", reask_at: past })) process.exit(3);
if (reaskDue({ status: "awaiting_operator_action", reask_at: past })) process.exit(4);
if (reaskDue({ status: "pending_dispatch", reask_at: past })) process.exit(5);
if (reaskDue(null)) process.exit(6);
' "$OD"
assert_eq "$?" 0 "reaskDue is true only for open entries with a past reask_at"

# $DU was declined above with --reask-after 0m (past due); answering it clears reask_at and "re-ask due"
od close --id "$DU" --answer "兩個都換"
assert_eq "$RC" 0 "due card answered: exit 0"
assert_eq "$(field "$DU" status)" "awaiting_operator_action" "answered due card is awaiting_operator_action"
assert_eq "$(field "$DU" reask_at)" "<undef>" "answering drops reask_at from stored entry"
od show --id "$DU"
assert_not_contains "$OUT" "re-ask due" "show --id on answered card prints no re-ask due"
assert_not_contains "$OUT" "reask_at:" "show --id on answered card prints no reask_at"
od show
assert_not_contains "$OUT" "re-ask due" "show prints no re-ask due after the due card is answered"
assert_neq "$(first_id "$OUT")" "$DU" "answered card is no longer sorted ahead as re-ask due"
od done --id "$DU"
assert_eq "$RC" 0 "done on answered due card: exit 0"
assert_eq "$(field "$DU" status)" "closed" "done closes answered due card"
assert_eq "$(field "$DU" reask_at)" "<undef>" "closed entry still has no reask_at"

# plain close (withdrawal) and pending_dispatch transitions on past-due declined cards
od open --executor "$EXEC" --question "撤回到期卡？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "withdraw-due open: exit 0"; DW="$OUT"
od close --id "$DW" --answer "稍後" --reask-after 0m
assert_eq "$RC" 0 "withdraw-due 0m decline: exit 0"
od show
assert_contains "$OUT" "re-ask due" "withdraw-due is due before close"
assert_eq "$(first_id "$OUT")" "$DW" "withdraw-due sorts first while open"
od close --id "$DW"
assert_eq "$RC" 0 "withdraw-due plain close: exit 0"
assert_eq "$(field "$DW" status)" "closed" "withdraw-due status closed"
assert_eq "$(field "$DW" reask_at)" "<undef>" "plain close drops reask_at"
od show --id "$DW"
assert_not_contains "$OUT" "re-ask due" "show --id on withdrawn due card prints no re-ask due"
od show --all
assert_not_contains "$OUT" "re-ask due" "show --all prints no re-ask due for closed card"
assert_neq "$(first_id "$OUT")" "$DW" "closed card does not sort first in show --all"

od open --executor "$EXEC" --question "待派工到期卡？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "park-due open: exit 0"; DPK="$OUT"
od close --id "$DPK" --answer "稍後" --reask-after 0m
assert_eq "$RC" 0 "park-due 0m decline: exit 0"
od close --id "$DPK" --answer "照辦"
assert_eq "$RC" 0 "park-due answer: exit 0"
assert_eq "$(field "$DPK" status)" "pending_dispatch" "park-due is pending_dispatch"
assert_eq "$(field "$DPK" reask_at)" "<undef>" "pending_dispatch transition drops reask_at"
od show
assert_not_contains "$OUT" "re-ask due" "pending_dispatch card is not re-ask due"
assert_neq "$(first_id "$OUT")" "$DPK" "pending_dispatch card does not sort first"
od close --id "$DPK" --dispatched task-due-1
assert_eq "$RC" 0 "park-due dispatched: exit 0"
assert_eq "$(field "$DPK" status)" "closed" "park-due closed"
assert_eq "$(field "$DPK" reask_at)" "<undef>" "dispatched close keeps reask_at absent"

# closePanelAnswer (awaiting) and closeDecisionById (closed) on past-due declined cards
export NO_DECISION=1
libcard "面板到期三步？" "" "登入"; DP1="$OUT"
od close --id "$DP1" --answer "晚點" --reask-after 0m
assert_eq "$RC" 0 "panel-await-due 0m decline: exit 0"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$DP1" "面板到期三步？" "兩個都換")")"
assert_eq "$HRC" 0 "panel-await-due hook: exit 0"
assert_eq "$(field "$DP1" status)" "awaiting_operator_action" "panel-await-due is awaiting"
assert_eq "$(field "$DP1" reask_at)" "<undef>" "closePanelAnswer awaiting drops reask_at"
od show --id "$DP1"
assert_not_contains "$OUT" "re-ask due" "panel-await-due prints no re-ask due"

libcard "面板到期普通？"; DP2="$OUT"
od close --id "$DP2" --answer "晚點" --reask-after 0m
assert_eq "$RC" 0 "panel-close-due 0m decline: exit 0"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$DP2" "面板到期普通？" "甲")")"
assert_eq "$HRC" 0 "panel-close-due hook: exit 0"
assert_eq "$(field "$DP2" status)" "closed" "panel-close-due is closed"
assert_eq "$(field "$DP2" reask_at)" "<undef>" "closeDecisionById drops reask_at"
od show --id "$DP2"
assert_not_contains "$OUT" "re-ask due" "panel-close-due prints no re-ask due"

# parkAnswer / sendParked (courier panel, awaiting and closed) on past-due declined cards
unset NO_DECISION
: > "$STUBLOG"
export STUB_OPTION="兩個都換"
AID2="BCDEFGHIJK0123456789BCDE"
od open --executor "$EXEC" --question "派工到期三步？" --free-text --not-authorized irreversible --operator-step 登入
assert_eq "$RC" 0 "courier-await-due open: exit 0"; DP3="$OUT"
od close --id "$DP3" --answer "晚點" --reask-after 0m
assert_eq "$RC" 0 "courier-await-due 0m decline: exit 0"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$DP3" "派工到期三步？" "兩個都換" "$AID2")")"
assert_eq "$HRC" 0 "courier-await-due hook: exit 0"
assert_eq "$(field "$DP3" status)" "awaiting_operator_action" "courier-await-due is awaiting"
assert_eq "$(field "$DP3" reask_at)" "<undef>" "sendParked awaiting drops reask_at"
od show --id "$DP3"
assert_not_contains "$OUT" "re-ask due" "courier-await-due prints no re-ask due"

AID3="CDEFGHIJKL0123456789CDEF"
od open --executor "$EXEC" --question "派工到期普通？" --free-text --not-authorized irreversible
assert_eq "$RC" 0 "courier-close-due open: exit 0"; DP4="$OUT"
od close --id "$DP4" --answer "晚點" --reask-after 0m
assert_eq "$RC" 0 "courier-close-due 0m decline: exit 0"
hook "$(printf '[待決回覆]\n%s\n' "$(pane_line "$DP4" "派工到期普通？" "兩個都換" "$AID3")")"
assert_eq "$HRC" 0 "courier-close-due hook: exit 0"
assert_eq "$(field "$DP4" status)" "closed" "courier-close-due is closed"
assert_eq "$(field "$DP4" reask_at)" "<undef>" "sendParked closed drops reask_at"
od show --id "$DP4"
assert_not_contains "$OUT" "re-ask due" "courier-close-due prints no re-ask due"

# pre-existing non-open records on disk that still carry a past reask_at do not print re-ask due or sort first
node -e '
const fs = require("fs");
const f = process.argv[1];
const v = JSON.parse(fs.readFileSync(f, "utf8"));
for (const id of [process.argv[2], process.argv[3]]) {
  const e = v.decisions.find((d) => d.id === id);
  e.reask_at = "2020-01-01T00:00:00.000Z";
}
fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
' "$(ls "$STORE"/*.json | head -1)" "$EO" "$W"
od show
assert_not_contains "$OUT" "re-ask due" "legacy reask_at on awaiting card is not shown as re-ask due"
assert_neq "$(first_id "$OUT")" "$EO" "legacy reask_at on awaiting card does not sort first"
od show --all
assert_not_contains "$OUT" "re-ask due" "legacy reask_at on closed card is not shown as re-ask due"
assert_neq "$(first_id "$OUT")" "$W" "legacy reask_at on closed card does not sort first in --all"
od show --id "$W"
assert_not_contains "$OUT" "re-ask due" "show --id on legacy closed card prints no re-ask due"
assert_not_contains "$OUT" "reask_at:" "show --id on legacy closed card prints no reask_at"

finalize_test
