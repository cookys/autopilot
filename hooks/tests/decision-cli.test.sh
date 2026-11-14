#!/usr/bin/env bash
# hooks/tests/decision-cli.test.sh - `autopilot decision list|show|answer --json` (docs/dev/decision-cli.md).
# fleet is a stub (AUTOPILOT_FLEET_BIN): the real fleet is never called. Each refusal asserts NOTHING was written (card unchanged, no delivery, no audit row).
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_CARD_NOTIFY=off AUTOPILOT_CLAIM_RETRY_MS=0
OD="$REPO_ROOT/scripts/open-decision.js"; BIN="$REPO_ROOT/bin/autopilot.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
EXEC="ns/cc/exec--claude"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const a = process.argv.slice(2);
const mode = () => { try { return fs.readFileSync(D + '/mode', 'utf8').trim(); } catch { return 'ok'; } };
if (a[0] === '--help') { process.stdout.write(mode() === 'courier' ? 'fleet\n\nUSAGE:\n  fleet send x\n  fleet decision claim|verify|list <card_id>\n' : 'fleet\n\nUSAGE:\n  fleet send x\n  fleet peers\n'); process.exit(1); }
if (a[0] === 'send') {
  fs.appendFileSync(D + '/sends.jsonl', JSON.stringify({ to: a[1], text: a[2] }) + '\n');
  if (mode() === 'fail') { process.stderr.write('hub refused\n'); process.exit(4); }
  const n = fs.readFileSync(D + '/sends.jsonl', 'utf8').split('\n').filter(Boolean).length;
  process.stdout.write(JSON.stringify({ ok: true, member: a[1], message_id: 'MSGSTUB' + n }) + '\n'); process.exit(0);
}
if (a[0] === 'decision' && a[1] === 'claim') { fs.appendFileSync(D + '/claims.log', a.join(' ') + '\n'); process.stdout.write(JSON.stringify({ outcome: 'claimed', answer_id: 'ACLAIMSTUB0000000000000001', card_id: a[2] }) + '\n'); process.exit(0); }
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
setmode() { printf '%s' "$1" > "$STUB/mode"; }
nsends() { if [ -f "$STUB/sends.jsonl" ]; then wc -l < "$STUB/sends.jsonl" | tr -d ' '; else echo 0; fi; }
dec() { node "$BIN" decision "$@" --cwd "$R" --json 2>"$TEST_TMP/derr" < /dev/null; }
ans() { local id="$1"; shift; dec answer "$id" "$@" --source console --device web-1; }
jf() { node -e 'let v=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const k of process.argv[1].split("."))v=v==null?v:v[k];process.stdout.write(v===undefined?"<undef>":typeof v==="string"?v:JSON.stringify(v))' "$1"; }
mkcard() { node "$OD" open --executor "$EXEC" --cwd "$R" --root-run-id root-t --question "$1" "${@:2}" --not-authorized irreversible 2>/dev/null | head -1; }
STORE="$(node -e 'const p=require("path");const{scopeFromCwd}=require(process.argv[1]);const{commonDirOf}=require(process.argv[2]);process.stdout.write(p.join(commonDirOf(scopeFromCwd(process.argv[3]).repo_identity),"autopilot","decisions"))' "$REPO_ROOT/src/status/project-key.js" "$REPO_ROOT/src/status/scope-key.js" "$R")"
AUDIT="$STORE/answers-audit.jsonl"
naudit() { if [ -f "$AUDIT" ]; then wc -l < "$AUDIT" | tr -d ' '; else echo 0; fi; }
cardstate() { node "$OD" show --cwd "$R" --id "$1" --json | jf decisions.0.status; }

setmode ok   # no `fleet decision`: local answer ids
C1="$(mkcard "要不要發版？" --option "甲::走 A 路線" --option "乙::走 B" --recommendation 甲 --why 因為快 --background 背景)"
C2="$(mkcard "請寫理由" --free-text)"

# list / show shape
OUT="$(dec list)"; assert_eq "$?" 0 "list exit 0"
assert_eq "$(printf '%s' "$OUT" | jf schema)" "autopilot.decision/1" "list schema string"
assert_eq "$(printf '%s' "$OUT" | jf cards.length)" 2 "list: two open cards"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.id)" "$C1" "list: oldest first"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.options)" '[{"label":"甲","desc":"走 A 路線"},{"label":"乙","desc":"走 B"}]' "list: options label/desc"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.recommendation)" "甲" "list: recommendation"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.executor)" "$EXEC" "list: executor"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.free_text)" false "list: option card free_text false"
assert_eq "$(printf '%s' "$OUT" | jf cards.1.free_text)" true "list: free-text card free_text true"
assert_eq "$(printf '%s' "$OUT" | jf cards.0.state)" open "list: state open"
for k in id question options recommendation why executor opened_at state free_text background; do assert_neq "$(printf '%s' "$OUT" | jf cards.0.$k)" "<undef>" "list: field $k present"; done
OUT="$(dec show "$C1")"; assert_eq "$?" 0 "show exit 0"
assert_eq "$(printf '%s' "$OUT" | jf card.id)" "$C1" "show: card id"
assert_eq "$(printf '%s' "$OUT" | jf card.answer)" null "show: unanswered card has answer null"

# bad --device / --source / usage: exit 2, nothing written
dec answer "$C1" --option 甲 --source console --device 'bad device!' >/dev/null; assert_eq "$?" 2 "bad --device -> 2"
dec answer "$C1" --option 甲 --source web --device web-1 >/dev/null; assert_eq "$?" 2 "bad --source -> 2"
dec answer "$C1" --source console --device web-1 >/dev/null; assert_eq "$?" 2 "no answer given -> 2"
assert_eq "$(nsends)" 0 "usage refusals sent nothing"; assert_eq "$(naudit)" 0 "usage refusals wrote no audit row"

# refusals: nothing written
OUT="$(ans d-00000000 --option 甲)"; assert_eq "$?" 4 "unknown id -> 4"; assert_eq "$(printf '%s' "$OUT" | jf code)" not_found "unknown id code"
OUT="$(ans "$C1" --option 丙)"; assert_eq "$?" 6 "bad option -> 6"; assert_eq "$(printf '%s' "$OUT" | jf code)" bad_option "bad option code"
ans "$C1" --free-text hi >/dev/null; assert_eq "$?" 6 "free text on an options card -> 6"
ans "$C2" --option 甲 >/dev/null; assert_eq "$?" 6 "option on a free-text card -> 6"
LONG="$(node -e 'process.stdout.write("字".repeat(4001))')"
OUT="$(ans "$C2" --free-text "$LONG")"; assert_eq "$?" 7 "free text 4001 -> 7"; assert_eq "$(printf '%s' "$OUT" | jf code)" too_long "too_long code"
ans "$C2" --free-text $'a\x01b' >/dev/null; assert_eq "$?" 7 "control char -> 7"
ans "$C1" --option 甲 --note "$(node -e 'process.stdout.write("n".repeat(2001))')" >/dev/null; assert_eq "$?" 7 "note 2001 -> 7"
OK4000="$(node -e 'process.stdout.write("x".repeat(4000))')"
assert_eq "$(nsends)" 0 "refusals sent nothing"; assert_eq "$(naudit)" 0 "refusals wrote no audit row"
assert_eq "$(cardstate "$C1")" open "refused cards stay open"; assert_eq "$(cardstate "$C2")" open "refused card 2 stays open"

# delivery fails -> 8, card open, no audit row; retry works
setmode fail
OUT="$(ans "$C1" --option 甲 --note 加油)"; assert_eq "$?" 8 "delivery failed -> 8"; assert_eq "$(printf '%s' "$OUT" | jf code)" delivery_failed "delivery_failed code"
assert_eq "$(cardstate "$C1")" open "failed delivery: card still open"; assert_eq "$(naudit)" 0 "failed delivery: no audit row"
assert_eq "$(node "$OD" show --cwd "$R" --id "$C1" --json | jf decisions.0.answers)" "<undef>" "failed delivery: no answer recorded on the card"
setmode ok; rm -f "$STUB/sends.jsonl"

# ok: closed, ONE delivery naming the card, one audit row
OUT="$(ans "$C1" --option 甲 --note 加油)"; assert_eq "$?" 0 "answer ok -> 0"
assert_eq "$(printf '%s' "$OUT" | jf ok)" true "ok json"; assert_eq "$(printf '%s' "$OUT" | jf state)" closed "ok: state closed"
assert_eq "$(cardstate "$C1")" closed "card closed"
assert_eq "$(nsends)" 1 "exactly one delivery"
assert_contains "$(cat "$STUB/sends.jsonl")" "$C1" "delivery names the card id"
assert_contains "$(cat "$STUB/sends.jsonl")" "$EXEC" "delivery goes to the executor"
assert_eq "$(naudit)" 1 "one audit row"
assert_eq "$(jf option < "$AUDIT")" 甲 "audit: option label"; assert_eq "$(jf note_len < "$AUDIT")" 2 "audit: note_len"; assert_eq "$(jf device < "$AUDIT")" web-1 "audit: device"; assert_eq "$(jf source < "$AUDIT")" console "audit: source"
assert_not_contains "$(cat "$AUDIT")" 加油 "audit holds no note text"
OUT="$(dec show "$C1")"; assert_eq "$(printf '%s' "$OUT" | jf card.state)" closed "show: closed"; assert_eq "$(printf '%s' "$OUT" | jf card.answer.option)" 甲 "show: answer option"

# duplicate / closed -> 5, no second delivery, no second audit row
OUT="$(ans "$C1" --option 乙)"; assert_eq "$?" 5 "duplicate answer -> 5"; assert_eq "$(printf '%s' "$OUT" | jf code)" closed "closed code"
assert_eq "$(nsends)" 1 "duplicate: no second delivery"; assert_eq "$(naudit)" 1 "duplicate: no second audit row"
assert_eq "$(printf '%s' "$(dec list)" | jf cards.length)" 1 "list: closed card is gone"; assert_eq "$(printf '%s' "$(dec list --all)" | jf cards.length)" 2 "list --all: includes closed"

# free text of exactly 4000 chars is accepted; audit holds the length, not the text
OUT="$(ans "$C2" --free-text "$OK4000")"; assert_eq "$?" 0 "free text 4000 -> 0"
assert_eq "$(tail -1 "$AUDIT" | jf free_text_len)" 4000 "audit: free_text_len"; assert_not_contains "$(tail -1 "$AUDIT")" xxxxxxxx "audit holds no free text"

# a courier host: the claim is made and its answer id is used
setmode courier
C3="$(mkcard "帶 courier" --option "是::y" --option "否::n")"
OUT="$(ans "$C3" --option 是)"; assert_eq "$?" 0 "courier host: ok"; assert_eq "$(printf '%s' "$OUT" | jf answer_id)" ACLAIMSTUB0000000000000001 "courier host: the claim's answer id"
assert_contains "$(cat "$STUB/claims.log")" "decision claim $C3 --option 是" "claim carried the option"
# a card with operator_steps, answered with a non-decline option -> awaiting_operator_action (the operator still has a step), not closed; the default list omits it (answerCard would reject it as closed), --all and show report it
setmode ok
C4="$(mkcard "有手動步驟" --option "做::y" --option "不做::n" --operator-step "到機房按電源鍵")"
OUT="$(ans "$C4" --option 做)"; assert_eq "$?" 0 "operator_steps answer -> 0"
assert_eq "$(printf '%s' "$OUT" | jf state)" awaiting_operator_action "operator_steps: answer state is awaiting_operator_action, not closed"
assert_eq "$(cardstate "$C4")" awaiting_operator_action "operator_steps: stored card awaiting_operator_action"
assert_eq "$(dec list | jf cards.length)" 0 "list: awaiting_operator_action card is not in the default (open-only) list (C4)"
assert_eq "$(dec list --all | jf cards.length)" 4 "list --all: includes the awaiting card"
assert_eq "$(dec list --all | jf cards.3.state)" awaiting_operator_action "list --all: its state"
assert_eq "$(dec show "$C4" | jf card.state)" awaiting_operator_action "show: its state"

finalize_test
