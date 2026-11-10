#!/usr/bin/env bash
# Panel answer delivery by PROGRAM code (PM 01M6ZXJYTQ, 2026-11-09; overrides PM ruling 01M6RV0Y02 "open-decision never sends"):
# a verified [待決回覆] line for a card WITH an executor makes hooks/advisory-relay.js park the card in pending_dispatch (answer stored) and run the shell
# `fleet send <executor> <text>` (session-signed inside Claude Code); success closes the card with dispatched_message_id and prints ONE receipt line;
# failure keeps it pending_dispatch with dispatch_error; `open-decision.js redeliver` retries; a sent card is never sent twice. `open` without --executor is refused.
# fleet is a stub (AUTOPILOT_FLEET_BIN): the real fleet is never called.
# Negative controls: NC1 the stub logs `dispatch` calls and the env of every `send`; the test exports FLEET_AS_CLI=1 and FLEET_FYI=1, so a sender that
# used `fleet dispatch`, or let those through, fails the assertions; NC2 a failing stub (exit 4, exit 0 + garbage) must leave the card NOT closed;
# NC3 a replay after success must send nothing.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_CLAIM_RETRY_MS=0
export FLEET_AS_CLI=1 FLEET_FYI=1   # NC1: the sender must strip both
OD="$REPO_ROOT/scripts/open-decision.js"; HOOK="$REPO_ROOT/hooks/advisory-relay.js"; FD="$REPO_ROOT/scripts/lib/fleet-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
EXEC="ns/cc/exec--claude"

STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const crypto = require('crypto');
const D = process.env.STUB_DIR; const a = process.argv.slice(2);
const mode = () => { try { return fs.readFileSync(D + '/mode', 'utf8').trim(); } catch { return 'ok'; } };
if (a[0] === '--help') { process.stdout.write(mode() === 'nocourier' ? 'fleet\n\nUSAGE:\n  fleet send x\n  fleet peers\n' : 'fleet\n\nUSAGE:\n  fleet send x\n  fleet decision claim|verify|list <card_id>\n'); process.exit(1); }
if (a[0] === 'send') {
  fs.appendFileSync(D + '/sends.jsonl', JSON.stringify({ to: a[1], text: a[2], argc: a.length, as_cli: process.env.FLEET_AS_CLI === undefined ? null : process.env.FLEET_AS_CLI, fyi: process.env.FLEET_FYI === undefined ? null : process.env.FLEET_FYI }) + '\n');
  const m = mode();
  try { const ms = Number(fs.readFileSync(D + '/sleepms', 'utf8')); if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
  if (m === 'fail4') { process.stderr.write('hub refused\n'); process.exit(4); }
  if (m === 'garbage') { process.stdout.write('accepted, probably\n'); process.exit(0); }
  const n = fs.readFileSync(D + '/sends.jsonl', 'utf8').split('\n').filter(Boolean).length;
  process.stdout.write(JSON.stringify({ ok: true, member: a[1], message_id: '01MSGSTUB' + String(n).padStart(6, '0') }) + '\n');
  if (m === 'late') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000); // the hub committed and printed the id, then the call hangs past the caller's timeout
  process.exit(0);
}
if (a[0] === 'dispatch') { fs.appendFileSync(D + '/dispatch.log', a.join(' ') + '\n'); process.exit(0); }
const [, sub, card] = a;
const idOf = (c, v) => 'A' + crypto.createHash('sha256').update(c + '|' + v).digest('hex').slice(0, 25).toUpperCase();
const rows = () => (fs.existsSync(D + '/answers') ? fs.readFileSync(D + '/answers', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const shape = (r, outcome) => { const o = { outcome, card_id: r.card_id, answer_id: r.answer_id, via: 'local', option: r.option || null, free_text: r.free_text || null, card_revision: 1, answered_at: '2026-11-09T09:12:44Z', operator: 'local' }; if (typeof r.answer_digest === 'string' && r.answer_digest !== '') o.answer_digest = r.answer_digest; return o; };
if (sub === 'claim') {
  const i = a.indexOf('--option'); const j = a.indexOf('--free-text'); const v = i >= 0 ? a[i + 1] : a[j + 1];
  const r = { card_id: card, answer_id: idOf(card, v), option: i >= 0 ? v : null, free_text: j >= 0 ? v : null };
  fs.appendFileSync(D + '/answers', JSON.stringify(r) + '\n'); process.stdout.write(JSON.stringify(shape(r, 'claimed')) + '\n'); process.exit(0);
}
if (sub === 'verify') {
  const r = rows().find((x) => x.card_id === card && x.answer_id === a[3]);
  if (!r) process.exit(7);
  process.stdout.write(JSON.stringify(shape(r, 'verified')) + '\n'); process.exit(0);
}
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
setmode() { printf '%s' "$1" > "$STUB/mode"; }
nsends() { if [ -f "$STUB/sends.jsonl" ]; then wc -l < "$STUB/sends.jsonl" | tr -d ' '; else echo 0; fi; }
hook() { HOUT="$(node -e 'process.stdout.write(JSON.stringify({session_id:"cd",cwd:process.argv[1],prompt:process.argv[2]}))' "$R" "$1" | node "$HOOK" 2>"$TEST_TMP/herr")"; HRC=$?; HERR="$(cat "$TEST_TMP/herr")"; }
card() { node "$OD" show --cwd "$R" --id "$1" --json; }
cf() { card "$1" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")).decisions[0];const x=j[process.argv[1]];process.stdout.write(x===undefined?"<undef>":(typeof x==="string"?x:JSON.stringify(x)))' "$2"; }
claim() { node -e 'const{claim}=require(process.argv[1]);const o=process.argv[3]==="o"?{option:process.argv[4]}:{freeText:process.argv[4]};process.stdout.write(claim(process.argv[2],o).answer_id)' "$FD" "$1" "$2" "$3"; }
mkcard() { node "$OD" open --executor "$EXEC" --cwd "$R" --root-run-id root-t --question "$1" "${@:2}" --not-authorized irreversible 2>/dev/null | head -1; }
sendfield() { node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);const o=JSON.parse(l[Number(process.argv[2])]);const x=o[process.argv[3]];process.stdout.write(x===null?"<null>":String(x))' "$STUB/sends.jsonl" "$1" "$2"; }

# 0. open without --executor is refused, nothing written
OUT="$(node "$OD" open --cwd "$R" --root-run-id root-t --question "No executor?" --option "A::a" --option "B::b" --not-authorized irreversible 2>"$TEST_TMP/err")"; RC=$?
assert_eq "$RC" 2 "open without --executor: refused (exit 2)"; assert_contains "$(cat "$TEST_TMP/err")" "--executor" "refusal names --executor"; assert_eq "$OUT" "" "refused open prints no id"
node "$OD" show --cwd "$R" --all >/dev/null 2>&1; assert_eq "$?" 1 "refused open wrote no card"

# 1. option card, multi-line description, non-ASCII; answered in the panel -> one send, exact text, card closed, one receipt line
setmode ok; rm -f "$STUB/sends.jsonl" "$STUB/dispatch.log" "$STUB/answers"
Q1="要不要發版？"
C1="$(mkcard "$Q1" --option $'甲::走 A 路線\n第二行：含 | 與 → 符號' --option "乙::走 B")"
AID1="$(claim "$C1" o "甲")"
hook "$(printf '[待決回覆]\n%s｜%s → 甲｜%s\n' "$C1" "$Q1" "$AID1")"
assert_eq "$(nsends)" 1 "option card: exactly one fleet send"
assert_eq "$(sendfield 0 to)" "$EXEC" "send goes to the executor"
DIG1="$(node -e 'const [aid,cid]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:null,option:"甲"})).digest("hex"))' "$AID1" "$C1")"
EXP1="$(printf '[操作員答覆] %s\nanswer_id: %s\nexecutor: %s\nquestion: %s\noption: 甲 — 走 A 路線\n第二行：含 | 與 → 符號\nfree_text: (none)\nanswer_digest: %s' "$C1" "$AID1" "$EXEC" "$Q1" "$DIG1")"
assert_eq "$(sendfield 0 text)" "$EXP1" "delivery text: every field verbatim, in order"
assert_eq "$(sendfield 0 argc)" 3 "send argv is exactly: send <to> <text>"
assert_eq "$(cf "$C1" status)" closed "answered card is closed after the send"
assert_eq "$(cf "$C1" dispatched_message_id)" "01MSGSTUB000001" "message id recorded"; assert_eq "$(cf "$C1" dispatched_via)" send "dispatched_via send"
assert_eq "$(cf "$C1" answer_id)" "$AID1" "answer id stored"; assert_eq "$(cf "$C1" answer)" "甲" "answer stored"
assert_eq "$(printf '%s' "$HOUT" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const c=j.hookSpecificOutput.additionalContext;process.stdout.write(c.split("\n").length+"|"+c)')" "1|[答覆已送達] $C1 → $EXEC message_id=01MSGSTUB000001" "exactly one receipt line (card id, executor, message id)"
# NC1: signing. The sender used `send`, never `dispatch`, and stripped FLEET_AS_CLI / FLEET_FYI that this test exported
assert_eq "$(sendfield 0 as_cli)" "<null>" "NC1 FLEET_AS_CLI is not passed to fleet send"; assert_eq "$(sendfield 0 fyi)" "<null>" "NC1 FLEET_FYI is not passed (the executor must act)"
assert_eq "$([ -f "$STUB/dispatch.log" ] && echo called || echo never)" never "NC1 fleet dispatch was never called"
# NC3: a replayed prompt sends nothing
hook "$(printf '[待決回覆]\n%s｜%s → 甲｜%s\n' "$C1" "$Q1" "$AID1")"
assert_eq "$(nsends)" 1 "NC3 replay of the same answer: no second send"
node "$OD" redeliver --cwd "$R" --root-run-id root-t >"$TEST_TMP/o" 2>&1; assert_eq "$?" 0 "redeliver with nothing parked: exit 0"; assert_eq "$(nsends)" 1 "NC3 redeliver does not resend a sent card"

# 2. free-text card, multi-line + non-ASCII free text
Q2="寫什麼理由？"
C2="$(mkcard "$Q2" --free-text)"
FT2=$'第一行：理由 A\n第二行 with "quotes" and $(not run) \\ back'
AID2="$(claim "$C2" f "$FT2")"
FT2WIRE="第一行：理由 A 第二行 with \"quotes\" and \$(not run) \\ back"
hook "$(printf '[待決回覆]\n%s｜%s → %s｜%s\n' "$C2" "$Q2" "$FT2WIRE" "$AID2")"
assert_eq "$(nsends)" 2 "free-text card: one more send"
DIG2="$(node -e 'const [aid,cid,ft]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:ft,option:null})).digest("hex"))' "$AID2" "$C2" "$FT2")"
EXP2="$(printf '[操作員答覆] %s\nanswer_id: %s\nexecutor: %s\nquestion: %s\noption: (none)\nfree_text: %s\nanswer_digest: %s' "$C2" "$AID2" "$EXEC" "$Q2" "$FT2" "$DIG2")"
assert_eq "$(sendfield 1 text)" "$EXP2" "free text delivered verbatim (multi-line, non-ASCII, shell metacharacters)"
assert_eq "$(cf "$C2" status)" closed "free-text card closed"

# 3. failures: exit 4, and exit 0 with garbage output -> pending_dispatch, never closed, dispatch_error set
for m in fail4 garbage; do
  setmode "$m"; Q3="失敗 $m？"
  C3="$(mkcard "$Q3" --option "A::a" --option "B::b")"; AID3="$(claim "$C3" o "A")"; BEFORE="$(nsends)"
  hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C3" "$Q3" "$AID3")"
  assert_eq "$(( $(nsends) - BEFORE ))" 1 "NC2 $m: one send attempted"
  assert_eq "$(cf "$C3" status)" pending_dispatch "NC2 $m: card stays pending_dispatch, NOT closed"
  assert_neq "$(cf "$C3" dispatch_error)" "<undef>" "NC2 $m: dispatch_error set"; assert_eq "$(cf "$C3" dispatch_attempts)" 1 "NC2 $m: attempt count 1"
  assert_eq "$(cf "$C3" dispatched_message_id)" "<undef>" "NC2 $m: no message id"
  assert_contains "$HOUT" "[答覆未送達]" "NC2 $m: the session is told it was not delivered"
  RB="$(nsends)"; node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$C3" >"$TEST_TMP/o" 2>&1; assert_eq "$?" 9 "$m: redeliver while still failing: exit 9"; assert_eq "$(cf "$C3" dispatch_attempts)" 2 "$m: attempts counted"; assert_eq "$(cf "$C3" status)" pending_dispatch "$m: still pending after a failed redeliver"
  setmode ok; RB="$(nsends)"
  OUT="$(node "$OD" redeliver --cwd "$R" --root-run-id root-t 2>&1)"; assert_eq "$?" 0 "$m: redeliver with a working stub: exit 0"
  assert_eq "$(( $(nsends) - RB ))" 1 "$m: redeliver sent once"; assert_eq "$(cf "$C3" status)" closed "$m: redeliver closes the card"
  assert_eq "$(printf '%s\n' "$OUT" | grep -c .)" 1 "$m: redeliver prints one receipt line"; assert_contains "$OUT" "[答覆已送達] $C3 → $EXEC message_id=" "$m: receipt line content"
  assert_eq "$(sendfield "$(( $(nsends) - 1 ))" text | head -1)" "[操作員答覆] $C3" "$m: redelivered text starts with the card id line"
  RB="$(nsends)"; OUT="$(node "$OD" redeliver --cwd "$R" --root-run-id root-t 2>&1)"; assert_eq "$(nsends)" "$RB" "$m: a second redeliver sends nothing"
done
setmode ok

# 4. a card without an executor (library card, e.g. AskUserQuestion) still closes directly and sends nothing
C4="$(node -e 'process.stdout.write(require(process.argv[1]).openDecision({cwd:process.argv[2],root:"root-t",session:null,question:"No exec lib?",options:[{label:"A",description:""},{label:"B",description:""}],not_authorized:"irreversible"}).id)' "$OD" "$R")"
AID4="$(claim "$C4" o A)"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜No exec lib? → A｜%s\n' "$C4" "$AID4")"
assert_eq "$(cf "$C4" status)" closed "no executor: closed directly as before"; assert_eq "$(nsends)" "$RB" "no executor: nothing sent"
# 5. an executor card whose answer cannot be delivered is never closed: no courier, and a verify failure -> pending_dispatch + dispatch_error naming the reason
setmode nocourier; Q5="沒有 courier？"
C5="$(mkcard "$Q5" --option "A::a" --option "B::b")"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C5" "$Q5" "AAAAAAAAAAAAAAAAAAAAAAAAAA")"
assert_eq "$(cf "$C5" status)" pending_dispatch "no courier + executor: parked in pending_dispatch, NOT closed"
assert_eq "$(cf "$C5" dispatch_error)" no_courier "no courier + executor: dispatch_error names the reason"
assert_eq "$(nsends)" "$RB" "no courier + executor: nothing sent"
assert_eq "$(cf "$C5" dispatch_attempts)" 1 "no courier + executor: dispatch_attempts counted (1)"
setmode ok
OUT="$(node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$C5" 2>&1)"; assert_eq "$?" 0 "redeliver reports a card with no stored answer (exit 0)"
assert_eq "$(printf '%s\n' "$OUT" | grep -c .)" 1 "redeliver: one line for the skipped card"; assert_contains "$OUT" "[略過] $C5" "redeliver: the skipped card is named"
assert_eq "$(cf "$C5" status)" pending_dispatch "redeliver leaves the skipped card parked"
Q6="驗證失敗？"; C6="$(mkcard "$Q6" --option "A::a" --option "B::b")"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C6" "$Q6" "BBBBBBBBBBBBBBBBBBBBBBBBBB")"
assert_eq "$(cf "$C6" status)" pending_dispatch "verify failure + executor: parked, NOT closed"
assert_contains "$(cf "$C6" dispatch_error)" verify_failed "verify failure + executor: dispatch_error names verify_failed"
assert_eq "$(nsends)" "$RB" "verify failure + executor: nothing sent"
assert_eq "$(cf "$C6" dispatch_attempts)" 1 "verify failure + executor: dispatch_attempts counted (1)"
# legacy close --answer on an executor card parks it too
C7="$(mkcard "旧路徑？" --option "A::a" --option "B::b")"; node "$OD" close --cwd "$R" --root-run-id root-t --id "$C7" --answer "A" >/dev/null 2>&1
assert_eq "$(cf "$C7" status)" pending_dispatch "legacy close --answer on an executor card: parked, not closed"

# 8. class D: a card parked with NO stored answer (no_courier) gets a later verified answer through the hook -> delivered
setmode ok; AIDX="$(claim "$C5" o A)"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C5" "$Q5" "$AIDX")"
assert_eq "$(( $(nsends) - RB ))" 1 "D no_courier-parked card: a later verified answer is sent"
assert_eq "$(cf "$C5" status)" closed "D no_courier-parked card: closed after delivery"
assert_eq "$(cf "$C5" answer_id)" "$AIDX" "D no_courier-parked card: answer stored"

# 9. class D: parked after a failed send, then a NEW verified answer with a different option -> the new option and answer_id go out; a third answer after dispatch sends nothing
setmode fail4; Q9="三選一？"
C9="$(mkcard "$Q9" --option "A::a" --option "B::b" --option "C::c")"; AID9A="$(claim "$C9" o A)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C9" "$Q9" "$AID9A")"
assert_eq "$(cf "$C9" status)" pending_dispatch "D stale: first send failed, card parked"
setmode ok; AID9B="$(claim "$C9" o B)"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → B｜%s\n' "$C9" "$Q9" "$AID9B")"
assert_eq "$(( $(nsends) - RB ))" 2 "D stale: the unsent first answer and the new one are both sent (append-only, nothing dropped)"
assert_contains "$(sendfield "$RB" text)" "answer_id: $AID9A" "D stale: the older unsent answer goes first"
assert_contains "$(sendfield "$(( $(nsends) - 1 ))" text)" "answer_id: $AID9B" "D stale: delivery carries the NEW answer_id"
assert_contains "$(sendfield "$(( $(nsends) - 1 ))" text)" "option: B — b" "D stale: delivery carries the NEW option"
assert_eq "$(cf "$C9" answer)" B "D stale: the card shows its latest answer"; assert_eq "$(cf "$C9" status)" closed "D stale: closed after the send"
AID9C="$(claim "$C9" o C)"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → C｜%s\n' "$C9" "$Q9" "$AID9C")"
assert_eq "$(nsends)" "$RB" "D stale: a third answer after dispatch sends nothing"
assert_eq "$(cf "$C9" answer_id)" "$AID9B" "D stale: a dispatched card keeps its delivered answer"

# 10. class A: two concurrent redeliver on one parked card with a slow stub -> exactly one send
setmode fail4; Q10="並行？"
C10="$(mkcard "$Q10" --option "A::a" --option "B::b")"; AID10="$(claim "$C10" o A)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$C10" "$Q10" "$AID10")"
setmode ok; printf 2000 > "$STUB/sleepms"; RB="$(nsends)"
node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$C10" >"$TEST_TMP/rd1" 2>&1 &
P1=$!
node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$C10" >"$TEST_TMP/rd2" 2>&1 &
P2=$!
wait $P1; RC1=$?; wait $P2; RC2=$?
assert_eq "$(( $(nsends) - RB ))" 1 "A two concurrent redeliver: exactly one fleet send"
assert_eq "$(cf "$C10" status)" closed "A concurrent: card closed"; assert_neq "$(cf "$C10" dispatched_message_id)" "<undef>" "A concurrent: message id recorded"
assert_eq "$(cf "$C10" dispatch_claim)" "<undef>" "A concurrent: claim cleared after the send"
assert_eq "$((RC1 + RC2))" 0 "A concurrent: neither redeliver reports a failure"
# a live claim blocks sending; a dispatched id blocks sending even if the status patch never happened
node -e 'const o=require(process.argv[1]);const f=o.projectScopeFiles(process.argv[2],{all:true}).find((x)=>o.readEntries(x,{all:true}).some((e)=>e.id===process.argv[3]));o.patchDecision(f,process.argv[3],{status:"pending_dispatch",dispatched_message_id:null,dispatch_claim:{pid:process.pid,at:new Date().toISOString()}},{any:true})' "$OD" "$R" "$C10"
RB="$(nsends)"; OUT="$(node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$C10" 2>&1)"; assert_eq "$(nsends)" "$RB" "A live claim: redeliver sends nothing"
rm -f "$STUB/sleepms"

# 11. class B: 3 answered cards in one prompt, a slow stub, a small total budget -> sends in order until the budget is gone, the rest parked as hook_budget; the hook exits in time
setmode ok; printf 3000 > "$STUB/sleepms"; RB="$(nsends)"
QB="預算？"; CB1="$(mkcard "$QB" --option "A::a" --option "B::b")"; CB2="$(mkcard "$QB" --option "A::a" --option "B::b")"; CB3="$(mkcard "$QB" --option "A::a" --option "B::b")"
AB1="$(claim "$CB1" o A)"; AB2="$(claim "$CB2" o A)"; AB3="$(claim "$CB3" o A)"
T0="$(date +%s)"
AUTOPILOT_RELAY_SEND_BUDGET_MS=8000 hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n%s｜%s → A｜%s\n%s｜%s → A｜%s\n' "$CB1" "$QB" "$AB1" "$CB2" "$QB" "$AB2" "$CB3" "$QB" "$AB3")"
T1="$(date +%s)"
assert_eq "$(( $(nsends) - RB ))" 1 "B budget: only the first card is sent before the deadline"
assert_eq "$(cf "$CB1" status)" closed "B budget: first card closed"
for c in "$CB2" "$CB3"; do
  assert_eq "$(cf "$c" status)" pending_dispatch "B budget: $c stays pending_dispatch"
  assert_eq "$(cf "$c" dispatch_error)" hook_budget "B budget: $c dispatch_error hook_budget"
  assert_neq "$(cf "$c" answer_id)" "<undef>" "B budget: $c answer stored before sending"
done
assert_eq "$([ $((T1 - T0)) -le 7 ] && echo in_time || echo late)" in_time "B budget: hook exited within the budget (took $((T1 - T0))s)"
assert_contains "$HOUT" "hook_budget" "B budget: the session is told about the deferred cards"
rm -f "$STUB/sleepms"; RB="$(nsends)"
node "$OD" redeliver --cwd "$R" --root-run-id root-t >"$TEST_TMP/o" 2>&1; assert_eq "$(( $(nsends) - RB ))" 2 "B budget: redeliver sends the two parked cards"

# 12. review gen 2 (card answer dispatch state machine). A: answer B parked while the send of answer A is in flight -> both sent in order, closed after B, closed card holds B
setmode ok; printf 3000 > "$STUB/sleepms"; QR="進行中？"
CR1="$(mkcard "$QR" --option "A::a" --option "B::b")"; AR1A="$(claim "$CR1" o A)"; AR1B="$(claim "$CR1" o B)"; RB="$(nsends)"
( hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CR1" "$QR" "$AR1A")" ) &
PA=$!; sleep 1
hook "$(printf '[待決回覆]\n%s｜%s → B｜%s\n' "$CR1" "$QR" "$AR1B")"
assert_eq "$(cf "$CR1" status)" pending_dispatch "R1 mid-send: the card is NOT closed by the second hook while A is in flight"
wait $PA
assert_eq "$(( $(nsends) - RB ))" 2 "R1 mid-send: both answers sent"
assert_contains "$(sendfield "$RB" text)" "answer_id: $AR1A" "R1 mid-send: A sent first"
assert_contains "$(sendfield "$(( RB + 1 ))" text)" "answer_id: $AR1B" "R1 mid-send: B sent second"
assert_eq "$(cf "$CR1" status)" closed "R1 mid-send: closed after the last send"
assert_eq "$(cf "$CR1" answer_id)" "$AR1B" "R1 mid-send: the closed card's answer is B (the last one sent)"
assert_neq "$(cf "$CR1" dispatched_message_id)" "<undef>" "R1 mid-send: message id of the last send recorded"
rm -f "$STUB/sleepms"

# B: persisting dispatched_message_id fails -> the card is not closed
setmode ok; QI="寫入失敗？"; CI="$(mkcard "$QI" --option "A::a" --option "B::b")"; AI="$(claim "$CI" o A)"
setmode fail4; hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CI" "$QI" "$AI")"; setmode ok
IDR="$(node -e '
const fs=require("fs");const o=require(process.argv[1]);const f=o.projectScopeFiles(process.argv[2],{all:true}).find((x)=>o.readEntries(x,{all:true}).some((e)=>e.id===process.argv[3]));
let writes=0;const rn=fs.renameSync;
const sender=()=>{ fs.renameSync=(a,b)=>{ fs.renameSync=rn; throw new Error("disk full"); }; return {ok:true,message_id:"01MSGIDFAIL"}; }; // the first write after the send (the id patch) fails
const r=o.sendParked(f,process.argv[3],sender);fs.renameSync=rn;process.stdout.write(r.status);
' "$OD" "$R" "$CI")"
assert_eq "$IDR" error "R2 id write fails: sendParked reports an error"
assert_neq "$(cf "$CI" status)" closed "R2 id write fails: the card is NOT closed"

# C: the send hangs past the timeout after the hub printed the id -> one send, id recorded, redeliver does not resend
setmode fail4; QT="逾時？"; CT="$(mkcard "$QT" --option "A::a" --option "B::b")"; AT="$(claim "$CT" o A)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CT" "$QT" "$AT")"; setmode late; RB="$(nsends)"
TR="$(node -e 'const o=require(process.argv[1]);const f=o.projectScopeFiles(process.argv[2],{all:true}).find((x)=>o.readEntries(x,{all:true}).some((e)=>e.id===process.argv[3]));process.stdout.write(o.sendParked(f,process.argv[3],undefined,{deadline:Date.now()+6000}).status)' "$OD" "$R" "$CT")"
assert_eq "$TR" sent "R3 timeout: a message id printed before the timeout counts as sent"
assert_eq "$(( $(nsends) - RB ))" 1 "R3 timeout: one send"
assert_neq "$(cf "$CT" dispatched_message_id)" "<undef>" "R3 timeout: message id recorded"
assert_eq "$(cf "$CT" status)" closed "R3 timeout: card closed"
setmode ok; RB="$(nsends)"; node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CT" >/dev/null 2>&1
assert_eq "$(nsends)" "$RB" "R3 timeout: redeliver does not send again"

# D: a message id is stored but the status is still pending_dispatch -> the next run closes the card with no new send
setmode fail4; QD="殘留？"; CD="$(mkcard "$QD" --option "A::a" --option "B::b")"; AD="$(claim "$CD" o A)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CD" "$QD" "$AD")"; setmode ok
node -e 'const o=require(process.argv[1]);const f=o.projectScopeFiles(process.argv[2],{all:true}).find((x)=>o.readEntries(x,{all:true}).some((e)=>e.id===process.argv[3]));o.patchDecision(f,process.argv[3],{dispatched_message_id:"01MSGLEFT",answers:undefined},{any:true})' "$OD" "$R" "$CD"
assert_eq "$(cf "$CD" status)" pending_dispatch "R4 leftover: precondition, id stored and still pending_dispatch"
RB="$(nsends)"; node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CD" >/dev/null 2>&1
assert_eq "$(nsends)" "$RB" "R4 leftover: no new send"
assert_eq "$(cf "$CD" status)" closed "R4 leftover: the next run closes the card"

# 13. card-answer redesign (review gen 3): answers[] is append-only, one claim held across the send loop. Scenarios run the library in a node child (scripts in $TEST_TMP).
PRE='const o=require(process.argv[2]);const id=process.argv[4];const f=o.projectScopeFiles(process.argv[3],{all:true}).find((x)=>o.readEntries(x,{all:true}).some((e)=>e.id===id));const ans=(opt,aid)=>({answer:{option:opt,free_text:null},answer_id:aid});const sleep=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};const ents=()=>o.readEntries(f,{all:true}).find((e)=>e.id===id);'
scen() { printf '%s\n%s\n' "$PRE" "$(cat)" > "$TEST_TMP/scen.js"; node "$TEST_TMP/scen.js" "$OD" "$R" "$1"; }
cards() { card "$1" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).decisions[0].answers.map((x)=>[x.answer_id,!!x.sent_message_id])))'; }
setmode ok; rm -f "$STUB/sleepms"; QG="重送？"

# (a) A sent, B in flight, a replay of A: A is not sent again, nothing replaced
CGA="$(mkcard "$QG" --option "A::a" --option "B::b")"
scen "$CGA" > "$TEST_TMP/o" <<'JS'
const seq = [];
const sender = (to, t) => {
  seq.push(t.match(/answer_id: (\S+)/)[1]);
  if (seq.length === 2) { const r = o.parkAnswer(f, id, ans('A', 'GA1')); seq.push('replayA:' + r.status + ':' + JSON.stringify(ents().answers.map((x) => x.answer_id))); }
  return { ok: true, message_id: 'M' + seq.length };
};
o.parkAnswer(f, id, ans('A', 'GA1')); o.parkAnswer(f, id, ans('B', 'GA2'));
const r = o.sendParked(f, id, sender, { deadline: Date.now() + 60000 });
process.stdout.write(r.status + '|' + seq.join(','));
JS
assert_eq "$(cat "$TEST_TMP/o")" 'sent|GA1,GA2,replayA:ok:["GA1","GA2"]' "(a) replay of A while B is in flight: A once, B once, answers[] unchanged"
assert_eq "$(cf "$CGA" status)" closed "(a) closed after the last send"; assert_eq "$(cards "$CGA")" '[["GA1",true],["GA2",true]]' "(a) both entries sent"
scen "$CGA" > "$TEST_TMP/o" <<'JS'
const r = o.parkAnswer(f, id, ans('A', 'GA1')); const s = o.sendParked(f, id, () => { throw new Error('must not send'); });
process.stdout.write(r.status + s.status);
JS
assert_eq "$(cat "$TEST_TMP/o")" okalready "(a) replay after close: ok, already, no send"

# (b) three queued answers, small budget: returns inside it, the rest stay pending_dispatch with hook_budget, a later redeliver sends them in order
CGB="$(mkcard "$QG" --option "A::a" --option "B::b" --option "C::c")"; RB="$(nsends)"; printf 3000 > "$STUB/sleepms"
T0="$(date +%s)"
scen "$CGB" > "$TEST_TMP/o" <<'JS'
o.parkAnswer(f, id, ans('A', 'GB1')); o.parkAnswer(f, id, ans('B', 'GB2')); o.parkAnswer(f, id, ans('C', 'GB3'));
const r = o.sendParked(f, id, undefined, { deadline: Date.now() + 8000 });
process.stdout.write(r.status + '|' + r.error);
JS
T1="$(date +%s)"
assert_eq "$(cat "$TEST_TMP/o")" "deferred|hook_budget" "(b) budget runs out: deferred with hook_budget"
assert_eq "$([ $((T1 - T0)) -le 8 ] && echo in_time || echo late)" in_time "(b) returned within the budget (took $((T1 - T0))s)"
assert_eq "$(( $(nsends) - RB ))" 1 "(b) one send fitted the budget"
assert_eq "$(cf "$CGB" status)" pending_dispatch "(b) card stays pending_dispatch"; assert_eq "$(cf "$CGB" dispatch_error)" hook_budget "(b) dispatch_error hook_budget"
assert_eq "$(cf "$CGB" dispatch_claim)" "<undef>" "(b) claim dropped"
rm -f "$STUB/sleepms"; node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CGB" >/dev/null 2>&1
assert_eq "$(( $(nsends) - RB ))" 3 "(b) redeliver sent the other two"
assert_contains "$(sendfield "$(( RB + 1 ))" text)" "answer_id: GB2" "(b) B second"; assert_contains "$(sendfield "$(( RB + 2 ))" text)" "answer_id: GB3" "(b) C third"
assert_eq "$(cf "$CGB" status)" closed "(b) closed after the last"

# (c) the claim expires with A sent and B unsent, then C is parked: B then C are sent, card closed, nothing dropped
CGC="$(mkcard "$QG" --option "A::a" --option "B::b" --option "C::c")"; RB="$(nsends)"
scen "$CGC" > "$TEST_TMP/o" <<'JS'
o.parkAnswer(f, id, ans('A', 'GC1')); o.parkAnswer(f, id, ans('B', 'GC2'));
let n = 0;
const r = o.sendParked(f, id, () => { n += 1; return n === 1 ? { ok: true, message_id: 'MC1' } : { ok: false, error: 'boom' }; }, { deadline: Date.now() + 60000 });
o.patchDecision(f, id, { dispatch_claim: { pid: 99999999, at: new Date(Date.now() - 600000).toISOString() } }, { any: true });
o.parkAnswer(f, id, ans('C', 'GC3'));
process.stdout.write(r.status);
JS
assert_eq "$(cat "$TEST_TMP/o")" failed "(c) setup: B's send failed after A was sent"
assert_eq "$(cards "$CGC")" '[["GC1",true],["GC2",false],["GC3",false]]' "(c) A sent, B and C unsent, nothing replaced"
node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CGC" >/dev/null 2>&1
assert_eq "$(( $(nsends) - RB ))" 2 "(c) B and C sent, A not again"
assert_contains "$(sendfield "$RB" text)" "answer_id: GC2" "(c) B first"; assert_contains "$(sendfield "$(( RB + 1 ))" text)" "answer_id: GC3" "(c) then C"
assert_eq "$(cf "$CGC" status)" closed "(c) closed"; assert_eq "$(cards "$CGC")" '[["GC1",true],["GC2",true],["GC3",true]]' "(c) every entry sent"

# (d) a second sender (redeliver, another pid) racing between loop iterations: in_flight, no double send
CGD="$(mkcard "$QG" --option "A::a" --option "B::b")"; RB="$(nsends)"
scen "$CGD" > "$TEST_TMP/o" <<'JS'
const cp = require('child_process'); const out = []; let n = 0;
const sender = (to, t) => {
  n += 1;
  if (n === 2) { const c = cp.spawnSync('node', [process.argv[2], 'redeliver', '--cwd', process.argv[3], '--root-run-id', 'root-t', '--id', id], { encoding: 'utf8', env: process.env }); out.push(c.stdout.trim()); }
  return { ok: true, message_id: 'MD' + n };
};
o.parkAnswer(f, id, ans('A', 'GD1')); o.parkAnswer(f, id, ans('B', 'GD2'));
const r = o.sendParked(f, id, sender, { deadline: Date.now() + 60000 });
process.stdout.write(r.status + '|' + out.join('') + '|' + n);
JS
assert_contains "$(cat "$TEST_TMP/o")" "sent|[答覆送出中]" "(d) the racing redeliver saw the claim: in_flight"
assert_eq "$(( $(nsends) - RB ))" 0 "(d) the racing redeliver sent nothing through the stub"
assert_eq "$(cf "$CGD" status)" closed "(d) closed by the loop owner"; assert_eq "$(cards "$CGD")" '[["GD1",true],["GD2",true]]' "(d) both sent once"

# (e) an answer arriving after the last sent id is written and before the closing check: sent, and the card closes only after it
CGE="$(mkcard "$QG" --option "A::a" --option "B::b")"
scen "$CGE" > "$TEST_TMP/o" <<'JS'
const fs = require('fs'); const cp = require('child_process'); const rn = fs.renameSync; const ex = fs.existsSync; let wrote = false; let parked = false;
const child = 'const o=require(process.argv[1]);process.stdout.write(o.parkAnswer(process.argv[2],process.argv[3],{answer:{option:"B",free_text:null},answer_id:"GE2"}).status)';
fs.renameSync = (a, b) => { rn(a, b); if (fs.readFileSync(b, 'utf8').includes('"ME1"')) wrote = true; };
// the lock is free between the id write and the next locked check (the first existsSync(f) after it): a second process parks B right there
fs.existsSync = (p) => { if (wrote && !parked && p === f) { parked = true; fs.existsSync = ex; process.stdout.write('child:' + cp.spawnSync('node', ['-e', child, process.argv[2], f, id], { encoding: 'utf8' }).stdout + '|'); } return ex(p); };
o.parkAnswer(f, id, ans('A', 'GE1'));
const r = o.sendParked(f, id, (to, t) => ({ ok: true, message_id: /GE2/.test(t) ? 'ME2' : 'ME1' }), { deadline: Date.now() + 60000 });
fs.renameSync = rn; fs.existsSync = ex;
process.stdout.write(r.status);
JS
assert_eq "$(cat "$TEST_TMP/o")" "child:ok|sent" "(e) the second answer was parked at the closing edge and the loop sent"
assert_eq "$(cards "$CGE")" '[["GE1",true],["GE2",true]]' "(e) the answer arriving at the closing edge is sent, not dropped"
assert_eq "$(cf "$CGE" status)" closed "(e) card closed after it"; assert_eq "$(cf "$CGE" dispatch_claim)" "<undef>" "(e) claim released"

# legacy cards: single answer fields / next_answer / id stored while pending_dispatch are read as answers[]
CGL="$(mkcard "$QG" --option "A::a" --option "B::b")"; RB="$(nsends)"
scen "$CGL" <<'JS' >/dev/null
o.patchDecision(f, id, { status: 'pending_dispatch', pending_dispatch_at: '2026-11-09T00:00:00.000Z', answer: 'A', answer_id: 'GL1', answer_option: 'A', answer_free_text: null, answer_digest: 'd1', dispatched_message_id: 'MLEG', next_answer: { answer: 'B', answer_id: 'GL2', answer_option: 'B', answer_free_text: null, answer_digest: 'd2' } }, { any: true });
JS
node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CGL" >/dev/null 2>&1
assert_eq "$(( $(nsends) - RB ))" 1 "legacy: the sent answer is not resent, next_answer is sent once"
assert_contains "$(sendfield "$RB" text)" "answer_id: GL2" "legacy: the queued next_answer went out"
assert_eq "$(cf "$CGL" status)" closed "legacy: closed"; assert_eq "$(cards "$CGL")" '[["GL1",true],["GL2",true]]' "legacy: normalised into answers[]"
CGM="$(mkcard "$QG" --option "A::a" --option "B::b")"; RB="$(nsends)"
scen "$CGM" <<'JS' >/dev/null
o.patchDecision(f, id, { status: 'pending_dispatch', answer: 'A', answer_id: 'GM1', answer_option: 'A', answer_free_text: null, answer_digest: 'd1', dispatched_message_id: 'MLEG2' }, { any: true });
JS
node "$OD" redeliver --cwd "$R" --root-run-id root-t --id "$CGM" >/dev/null 2>&1
assert_eq "$(nsends)" "$RB" "legacy: every entry sent and pending_dispatch: closed without sending"; assert_eq "$(cf "$CGM" status)" closed "legacy: closed without a send"

# 14. answer_digest binds the card. The old digest was sha256({free_text, option}) and ignored which card the answer was for.
digline() { sendfield "$1" text | sed -n 's/^answer_digest: //p'; }
# (a) two different cards, the same option, one batch: every card's digest differs
setmode ok; QA14="同選項？"; CA14="$(mkcard "$QA14" --option "A::a" --option "B::b")"; CB14="$(mkcard "$QA14" --option "A::a" --option "B::b")"
AA14="$(claim "$CA14" o A)"; AB14="$(claim "$CB14" o A)"; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n%s｜%s → A｜%s\n' "$CA14" "$QA14" "$AA14" "$CB14" "$QA14" "$AB14")"
assert_eq "$(( $(nsends) - RB ))" 2 "(a) same option, two cards, one batch: both sent"
DA14="$(digline "$RB")"; DB14="$(digline "$(( RB + 1 ))")"
EXPA14="$(node -e 'const [aid,cid]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:null,option:"A"})).digest("hex"))' "$AA14" "$CA14")"
EXPB14="$(node -e 'const [aid,cid]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:null,option:"A"})).digest("hex"))' "$AB14" "$CB14")"
assert_neq "$DA14" "$DB14" "(a) two cards, same option: every digest differs"
assert_eq "$DA14" "$EXPA14" "(a) first digest binds that card_id and answer_id"
assert_eq "$DB14" "$EXPB14" "(a) second digest binds that card_id and answer_id"
assert_eq "$(cf "$CA14" answer_digest)" "$DA14" "(a) first stored digest is the one delivered"
assert_eq "$(cf "$CB14" answer_digest)" "$DB14" "(a) second stored digest is the one delivered"
# (b) the same card re-sent (replay of the same answer_id): the digest does not change
setmode fail4; QB14="重送摘要？"; CC14="$(mkcard "$QB14" --option "A::a" --option "B::b")"; AC14="$(claim "$CC14" o A)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CC14" "$QB14" "$AC14")"
assert_eq "$(cf "$CC14" status)" pending_dispatch "(b) first send failed: answer parked, not closed"
DBEFORE="$(cf "$CC14" answer_digest)"
EXP14="$(node -e 'const [aid,cid]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:null,option:"A"})).digest("hex"))' "$AC14" "$CC14")"
assert_eq "$DBEFORE" "$EXP14" "(b) parked digest binds this card and this answer_id"
setmode ok; RB="$(nsends)"
hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CC14" "$QB14" "$AC14")"
assert_eq "$(( $(nsends) - RB ))" 1 "(b) replay of the same unsent answer_id sends once"
DRE="$(digline "$RB")"
assert_eq "$DRE" "$DBEFORE" "(b) re-sent digest unchanged"
assert_eq "$(cf "$CC14" answer_digest)" "$DBEFORE" "(b) stored digest unchanged after the replay send"
RB="$(nsends)"; hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CC14" "$QB14" "$AC14")"
assert_eq "$(nsends)" "$RB" "(b) a second replay after delivery sends nothing"
assert_eq "$(cf "$CC14" answer_digest)" "$DBEFORE" "(b) digest still unchanged after the second replay"
# (c) a courier-supplied answer_digest on the verify stdout is stored verbatim
setmode ok; QD14="快遞摘要？"; CD14="$(mkcard "$QD14" --option "A::a" --option "B::b")"; AD14="$(claim "$CD14" o A)"
COURIER14="courier-digest-verbatim-not-a-local-hash"
node -e 'const fs=require("fs");const p=process.argv[1],card=process.argv[2],d=process.argv[3];const lines=fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map((l)=>JSON.parse(l));for(const r of lines)if(r.card_id===card)r.answer_digest=d;fs.writeFileSync(p,lines.map((r)=>JSON.stringify(r)).join("\n")+"\n")' "$STUB/answers" "$CD14" "$COURIER14"
RB="$(nsends)"; hook "$(printf '[待決回覆]\n%s｜%s → A｜%s\n' "$CD14" "$QD14" "$AD14")"
assert_eq "$(( $(nsends) - RB ))" 1 "(c) courier digest: the answer is sent"
DCOUR="$(digline "$RB")"
assert_eq "$DCOUR" "$COURIER14" "(c) delivery carries the courier answer_digest verbatim"
assert_eq "$(cf "$CD14" answer_digest)" "$COURIER14" "(c) stored digest is the courier value"
LOCAL14="$(node -e 'const [aid,cid]=process.argv.slice(1);process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify({answer_id:aid,card_id:cid,free_text:null,option:"A"})).digest("hex"))' "$AD14" "$CD14")"
assert_neq "$DCOUR" "$LOCAL14" "(c) the courier value is not the local fallback"

finalize_test
