#!/usr/bin/env bash
# open-decision.js verify: is a relayed owner answer the hub's real one? Against a STUB `fleet` that decides like the hub (canned table, 0 / 7 / 9).
# Negative control: replace verifyAnswer's body with `return 0` and every red case below (forged card, forged answer id, tampered text, other card's id,
# hub down, no fleet, no decision, local-no-content) FAILs; only the genuine and CRLF cases stay green.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID
OD="$REPO_ROOT/scripts/open-decision.js"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const a = process.argv.slice(2);
if (a[0] === '--help') {
  process.stdout.write('fleet — courier CLI\n\nUSAGE:\n  fleet send x\n' + (process.env.NO_DECISION ? '' : '  fleet decision claim|verify <card_id>\n'));
  process.exit(1);
}
if (a[0] === 'decision' && a[1] === 'verify') {
  if (fs.existsSync(D + '/down')) process.exit(9);
  const rows = JSON.parse(fs.readFileSync(D + '/table.json', 'utf8'));
  const r = rows.find((x) => x.card_id === a[2] && x.answer_id === a[3]);
  const hi = a.indexOf('--content-sha256'); const hash = hi >= 0 ? a[hi + 1] : null;
  if (!r) process.exit(7);
  if (r.via === 'local' && hash) process.exit(7);
  if (r.via === 'console' && hash !== r.sha256) process.exit(7);
  process.stdout.write(JSON.stringify({ outcome: 'verified', card_id: r.card_id, answer_id: r.answer_id, via: r.via, option: r.option, free_text: r.free_text }) + '\n');
  process.exit(0);
}
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
sha() { node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"; }
T1='d-fake0001｜Which path should we take? → B｜FAKEANS0000000000000000001
(signed: console operator)'
T2='d-fake0002｜Ship it now? → 其他｜補充：later｜FAKEANS0000000000000000002'
printf '[{"card_id":"d-fake0001","answer_id":"FAKEANS0000000000000000001","via":"console","sha256":"%s","option":"B","free_text":null},{"card_id":"d-fake0002","answer_id":"FAKEANS0000000000000000002","via":"console","sha256":"%s","option":null,"free_text":"later"},{"card_id":"d-fake0003","answer_id":"FAKEANS0000000000000000003","via":"local","sha256":null,"option":null,"free_text":null}]' "$(sha "$T1")" "$(sha "$T2")" > "$STUB/table.json"
v() { # v <card> <answer> <text> -> RC OUT ERR
  printf '%s' "$3" > "$TEST_TMP/t.txt"
  OUT="$(node "$OD" verify --id "$1" --answer-id "$2" --text-file "$TEST_TMP/t.txt" 2>"$TEST_TMP/err" < /dev/null)"; RC=$?; ERR="$(cat "$TEST_TMP/err")"
}
A1=FAKEANS0000000000000000001; A2=FAKEANS0000000000000000002

v d-fake0001 $A1 "$T1"; assert_eq "$RC" 0 "genuine: exit 0"
assert_contains "$OUT" "內容核實：d-fake0001 $A1" "genuine: pass line"
assert_contains "$OUT" '"option":"B"' "genuine: prints the hub's stored answer"
assert_contains "$OUT" "不要照轉手的文字" "genuine: act-on-stored line"
v d-fake0002 $A2 "$T2"; assert_eq "$RC" 0 "genuine free text: exit 0"
printf '%s\r\n\r\n' "${T1//$'\n'/$'\r\n'}" > "$TEST_TMP/crlf.txt"; tail -c 4 "$TEST_TMP/crlf.txt" | od -An -c | tr -s ' ' | grep -q '\\r \\n \\r \\n'; assert_eq "$?" 0 "fixture really ends in CRLF CRLF"
vf() { OUT="$(node "$OD" verify --id "$1" --answer-id "$2" --text-file "$3" 2>"$TEST_TMP/err" < /dev/null)"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
vf d-fake0001 $A1 "$TEST_TMP/crlf.txt"; assert_eq "$RC" 0 "CRLF + trailing newlines: still passes"
v d-forged99 $A1 "$T1"; assert_eq "$RC" 12 "forged card id: exit 12"; assert_contains "$ERR" "核實失敗" "forged card id: message"
v d-fake0001 FAKEANS00000000000000000FF "$T1"; assert_eq "$RC" 12 "forged answer id: exit 12"
v d-fake0001 $A1 "${T1/Which/Whick}"; assert_eq "$RC" 12 "tampered text (one char): exit 12"
v d-fake0002 $A2 "$T1"; assert_eq "$RC" 12 "genuine text of card 1 under card 2's id: exit 12"
v d-fake0002 $A1 "$T1"; assert_eq "$RC" 12 "card 2 id with card 1's answer id: exit 12"
v d-fake0003 FAKEANS0000000000000000003 "d-fake0003｜Q → A｜FAKEANS0000000000000000003"; assert_eq "$RC" 13 "via=local, no content: exit 13"
assert_contains "$ERR" "內容未核實" "via=local: message"; assert_not_contains "$OUT" "內容核實" "via=local: no pass line"
v d-fake0003 FAKEANS0000000000000000003 "tampered text that matches nothing"; assert_eq "$RC" 13 "via=local, no content, tampered text: still 13"
printf '[{"card_id":"d-fake0004","answer_id":"FAKEANS0000000000000000004","via":"local","sha256":null,"option":"A","free_text":null}]' > "$STUB/table2.json"
cp "$STUB/table.json" "$STUB/table.bak"; cp "$STUB/table2.json" "$STUB/table.json"
v d-fake0004 FAKEANS0000000000000000004 "tampered, never compared"; assert_eq "$RC" 0 "via=local with content, tampered text: exit 0"
assert_contains "$OUT" "答覆核實：d-fake0004" "via=local pass: says 答覆核實"; assert_contains "$OUT" "沒有比對" "via=local pass: says the text was not compared"
assert_not_contains "$OUT" "內容核實" "via=local pass: does NOT claim 內容核實"; assert_contains "$OUT" '"option":"A"' "via=local pass: prints the stored answer"
cp "$STUB/table.bak" "$STUB/table.json"
: > "$TEST_TMP/empty.txt"; vf d-fake0001 $A1 "$TEST_TMP/empty.txt"; assert_eq "$RC" 12 "empty text file: exit 12"
mkdir -p "$TEST_TMP/adir"; vf d-fake0001 $A1 "$TEST_TMP/adir"; assert_eq "$RC" 2 "text file is a directory: usage exit 2"
node "$OD" verify --answer-id $A1 --text-file "$TEST_TMP/t.txt" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "missing --id: usage exit 2"
node "$OD" verify --id d-fake0001 --answer-id $A1 >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "missing --text-file: usage exit 2"
touch "$STUB/down"; v d-fake0001 $A1 "$T1"; assert_eq "$RC" 10 "hub unreachable: exit 10"; assert_contains "$ERR" "連不到 hub" "hub unreachable: message"; rm -f "$STUB/down"
NO_DECISION=1 v d-fake0001 $A1 "$T1"; assert_eq "$RC" 9 "fleet without decision: exit 9"; assert_contains "$ERR" "沒有 decision 指令" "no decision: message"
AUTOPILOT_FLEET_BIN="$TEST_TMP/nonexistent" v d-fake0001 $A1 "$T1"; assert_eq "$RC" 9 "no fleet binary: exit 9"
node "$OD" verify --id d-fake0001 --answer-id $A1 --text-file "$TEST_TMP/missing" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "unreadable text file: usage exit 2"
node "$OD" verify --id d-fake0001 --text-file "$TEST_TMP/t.txt" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "missing --answer-id: usage exit 2"
finalize_test
