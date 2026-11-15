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
od() { OUT="$(node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --not-authorized irreversible "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
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
  od --category "$c"; assert_eq "$RC" 0 "--category $c: exit 0"; assert_eq "$(field "$OUT" category)" "$c" "--category $c: category stored"
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
finalize_test
