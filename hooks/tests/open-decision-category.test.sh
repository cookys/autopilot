#!/usr/bin/env bash
# Operator rule 2026-11-15: only seven kinds of question go to the operator. `open-decision.js open --category <c>` is REQUIRED; a missing or
# other value is refused (exit 7, 拒絕開卡 message, nothing written). The category is stored and shown; `stats` counts cards per category.
# Negative controls (shown red before green): (1) validation removed -> the "--category reversible" case FAILs (a card would be written);
# (2) the category not stored -> "category stored" FAILs; (3) stats counting every card as one bucket -> the per-category counts FAIL.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
od() { OUT="$(node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --title '要改嗎' --recommendation A --not-authorized irreversible "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
files() { find "$R/.git/autopilot/decisions" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
field() { node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=v.decisions.find(d=>d.id===process.argv[2]);process.stdout.write(String(e[process.argv[3]]))' "$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)" "$1" "$2"; }

# refused: missing, wrong value, empty; nothing written
for bad in reversible Money MONEY goal2 ""; do
  od --category "$bad"; assert_eq "$RC" 7 "--category '$bad': exit 7"; assert_contains "$ERR" "這件 PM 自己決定" "--category '$bad': PM-decides message"
  assert_contains "$ERR" "拒絕開卡" "--category '$bad': refusal word"; assert_eq "$OUT" "" "--category '$bad': no id printed"; assert_eq "$(files)" 0 "--category '$bad': no card file"
done
od; assert_eq "$RC" 7 "missing --category: exit 7"; assert_contains "$ERR" "這件 PM 自己決定" "missing --category: PM-decides message"; assert_eq "$(files)" 0 "missing --category: no card file"
# step cards need it too
node "$OD" open --kind step --cwd "$R" --question "do x" >/dev/null 2>"$TEST_TMP/err"; assert_eq "$?" 7 "--kind step without --category: exit 7"
# each of the seven opens and is stored, and show prints it
for c in money identity presence goal public-release unbackable-loss authority; do
  extra=(); case "$c" in identity|presence) extra=(--operator-step-none "test fixture: the category check, no operator act");; esac; od --category "$c" "${extra[@]}"; assert_eq "$RC" 0 "--category $c: exit 0"; assert_eq "$(field "$OUT" category)" "$c" "--category $c: category stored"
  assert_contains "$(node "$OD" show --cwd "$R" --id "$OUT")" "category: $c" "--category $c: show prints it"
done
# usage text (printed on bad args) lists all seven values, each with its Chinese label
node "$OD" open --cwd "$R" >/dev/null 2>"$TEST_TMP/usage"; USAGE="$(cat "$TEST_TMP/usage")"
for l in "money（錢）" "identity（身分" "presence（到場）" "goal（改目標）" "public-release（對外）" "unbackable-loss（無備份的損失）" "authority（改授權）"; do assert_contains "$USAGE" "$l" "usage lists $l"; done
# stats: per-category counts in a window; an old card without category -> uncategorized
node -e '
const fs=require("fs");const f=process.argv[1];const v=JSON.parse(fs.readFileSync(f,"utf8"));
const old=new Date(Date.now()-30*86400000).toISOString();
v.decisions.push({id:"d-0000aaaa",question:"old",options:null,status:"open",opened_at:old,opened_by_session:null,executor:"ns/cc/exec--claude"});
v.decisions.push({id:"d-0000bbbb",question:"nocat",options:null,status:"open",opened_at:new Date().toISOString(),opened_by_session:null,executor:"ns/cc/exec--claude"});
fs.writeFileSync(f,JSON.stringify(v));' "$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)"
ST="$(node "$OD" stats --since 7d --json --cwd "$R")"
assert_eq "$(printf '%s' "$ST" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(s.schema+" "+Object.entries(s.counts).map(([k,v])=>k+"="+v).join(","))')" "decision-stats/1 money=1,identity=1,presence=1,goal=1,public-release=1,unbackable-loss=1,authority=1,uncategorized=1" "stats 7d: one per category, the new card without category is uncategorized, the 30-day-old one is outside"
assert_contains "$(node "$OD" stats --since 60d --json --cwd "$R" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write("u="+s.counts.uncategorized)')" "u=2" "stats 60d: the old card counts as uncategorized"
node "$OD" stats --since nonsense --cwd "$R" >/dev/null 2>&1; assert_eq "$?" 2 "stats: bad --since is a usage error"

# Decide-card shape (CLI open only). Red before the check existed: the inferred 2180 card still opened,
# and a two-question / question-recommendation / non-label recommendation / non-question title still opened.
# Negative control (sed_mutant, after the check): deleting the premise test makes the inferred card open.
shape() { OUT="$(node "$OD" open --category goal --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --not-authorized irreversible "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
ncards() { node -e 'const fs=require("fs"); const f=process.argv[1]; if(!f){process.stdout.write("0")} else { const v=JSON.parse(fs.readFileSync(f,"utf8")); process.stdout.write(String(v.decisions.length)) }' "$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)"; }
TITLE2180='小孩房櫃高2180要改嗎'
Q2180='小孩房的衣櫃和入口組合櫃，你 10-17 指定櫃頂做到 2180。天花照實測降低之後，那裡的天花只剩約 2037（降板處 1952），2180 做不進去。要怎麼處理？'
BG2180='308 把天花改成「實測值 = 圖面 −163」之後……'
OA2180='A::櫃子跟著天花縮短 — 櫃頂改成貼天花、保留圖面原有的縫……'
OB2180='B::保留 2180，改天花 — 小孩房那段天花局部升高或在櫃上方開槽……'
REC2180='A 櫃子跟著天花縮短'
printf '%s\n' 'living room only, ceiling value inferred' > "$TEST_TMP/premise-inferred.txt"
BEFORE="$(ncards)"
shape --title "$TITLE2180" --question "$Q2180" --background "$BG2180" --option "$OA2180" --option "$OB2180" --recommendation "$REC2180" --premise-source "$TEST_TMP/premise-inferred.txt"
assert_eq "$RC" 2 "2180 inferred premise: exit 2"; assert_contains "$ERR" "open-decision: 前提檢查：" "2180 inferred premise: names the premise rule"; assert_eq "$OUT" "" "2180 inferred premise: no id"; assert_eq "$(ncards)" "$BEFORE" "2180 inferred premise: nothing written"
Q2180_OK='小孩房的衣櫃和入口組合櫃，你 10-17 指定櫃頂做到 2180。天花照實測降低之後，那裡的天花只剩約 2037（降板處 1952），2180 做不進去（推算值）。要怎麼處理？'
shape --title "$TITLE2180" --question "$Q2180_OK" --background "$BG2180" --option "$OA2180" --option "$OB2180" --recommendation "$REC2180" --premise-source "$TEST_TMP/premise-inferred.txt"
assert_eq "$RC" 0 "2180 with 推算值: exit 0"; assert_contains "$OUT" "d-" "2180 with 推算值: an id is printed"
shape --title '要改嗎' --question '要改嗎？還是保留？' --option 'A::a' --option 'B::b' --recommendation 'A'
assert_eq "$RC" 2 "two question marks: exit 2"; assert_contains "$ERR" "一個問號" "two question marks: says what to fix"; assert_eq "$OUT" "" "two question marks: no id"
shape --title '要改嗎' --question '沒有問號' --option 'A::a' --option 'B::b' --recommendation 'A'
assert_eq "$RC" 2 "no question mark: exit 2"; assert_contains "$ERR" "一個問號" "no question mark: says what to fix"
shape --title '要改嗎' --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation '要不要改？'
assert_eq "$RC" 2 "recommendation is a question: exit 2"; assert_contains "$ERR" "問句" "recommendation is a question: says it must be a choice"
shape --title '要改嗎' --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation '兩個都留'
assert_eq "$RC" 2 "recommendation is not an option label: exit 2"; assert_contains "$ERR" "標籤" "recommendation is not an option label: says to start with a label"
shape --title '櫃高2180' --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation 'A'
assert_eq "$RC" 2 "title without a question: exit 2"; assert_contains "$ERR" "title" "title without a question: names --title"
shape --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation 'A'
assert_eq "$RC" 2 "missing title: exit 2"; assert_contains "$ERR" "title" "missing title: names --title"
shape --title '要改嗎' --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation 'A'
assert_eq "$RC" 0 "good decide card: exit 0"; assert_contains "$OUT" "d-" "good decide card: an id is printed"
shape --title '要改嗎' --question '要選哪個？' --option 'A::a' --option 'B::b' --recommendation 'A' --premise-inferred
assert_eq "$RC" 2 "--premise-inferred without 推算/inferred: exit 2"; assert_contains "$ERR" "open-decision: 前提檢查：" "--premise-inferred: names the premise rule"
shape --title '要改嗎' --question '要選哪個（推算）？' --option 'A::a' --option 'B::b' --recommendation 'A' --premise-inferred
assert_eq "$RC" 0 "--premise-inferred with 推算: exit 0"
shape --kind go --question '記一筆' --option 'A::a' --option 'B::b'
assert_eq "$RC" 0 "--kind go is exempt from the decide-card shape rules"
shape --kind remind --question '提醒一件事'
assert_eq "$RC" 0 "--kind remind is exempt from the decide-card shape rules"
node "$OD" open --kind step --category goal --executor ns/cc/exec--claude --cwd "$R" --question "去做這一步" >/dev/null 2>"$TEST_TMP/err"; assert_eq "$?" 0 "--kind step is exempt from the decide-card shape rules"
node "$OD" show --premise-source "$TEST_TMP/premise-inferred.txt" --cwd "$R" >/dev/null 2>"$TEST_TMP/err"; assert_eq "$?" 2 "--premise-source outside open: exit 2"; assert_contains "$(cat "$TEST_TMP/err")" "open-decision: --premise-source 與 --premise-inferred 只用於 open" "--premise-source outside open: names the command"
shape --free-text --title '要改嗎' --question '理由是什麼？' --recommendation '要不要改？'
assert_eq "$RC" 2 "free-text recommendation that is a question: exit 2"; assert_contains "$ERR" "問句" "free-text recommendation: question-mark rule"
shape --free-text --title '要改嗎' --question '理由是什麼？'
assert_eq "$RC" 0 "free-text decide card with no recommendation: exit 0"
MUT="$TEST_TMP/shape-mut"; rm -rf "$MUT"; mkdir -p "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"; ln -s "$REPO_ROOT/hooks" "$MUT/hooks"
for f in "$REPO_ROOT/scripts"/*; do ln -s "$f" "$MUT/scripts/$(basename "$f")"; done
rm "$MUT/scripts/open-decision.js"
sed_mutant "$OD" "$MUT/scripts/open-decision.js" '/DECIDE_CARD_SHAPE/d' || fail "premise mutant did not apply"
OUT="$(node "$MUT/scripts/open-decision.js" open --category identity --operator-step-none "test fixture: mutant probe" --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --not-authorized irreversible --title "$TITLE2180" --question "$Q2180" --background "$BG2180" --option "$OA2180" --option "$OB2180" --recommendation "$REC2180" --premise-source "$TEST_TMP/premise-inferred.txt" 2>"$TEST_TMP/err")"; RC=$?
assert_eq "$RC" 0 "mutant (decide-card shape check removed): the inferred 2180 card opens, so the refusal above would be red"
assert_contains "$OUT" "d-" "mutant: inferred card id printed"
finalize_test
