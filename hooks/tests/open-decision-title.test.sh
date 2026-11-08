#!/usr/bin/env bash
# Card short title, write side: `open-decision.js open --title <t>` stores an additive `title` (<= 20 code points, refused over, never cut), the open notice
# to the PM carries it, the PM mirror keeps it, `show` prints it; without --title the card entry is byte-identical to before (no title field).
# Negative control (sed_mutant, shown red before green): the 20-code-point check removed -> the 21-character case FAILs.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export CLAUDE_CODE_SESSION_ID=FAKE-sess-1
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_CARD_NOTIFY=on AUTOPILOT_CARD_NOTIFY_TO=example/host-a/pm--claude
export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror"
S="$REPO_ROOT/scripts"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const a = process.argv.slice(2);
fs.appendFileSync(D + '/calls.log', JSON.stringify({ args: a }) + '\n');
if (a[0] === 'send') { process.stdout.write('{"ok":true}\n'); process.exit(0); }
if (a[0] === 'recent') { process.stdout.write(fs.readFileSync(D + '/recent.json', 'utf8')); process.exit(0); }
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
export PATH="$STUB:$PATH"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
: > "$STUB/calls.log"
od() { local script="$1"; shift; OUT="$(node "$script" open --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --not-authorized irreversible "$@" 2>"$TEST_TMP/err" < /dev/null)"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
store() { cat "$R"/.git/autopilot/decisions/*.json 2>/dev/null; }
entry() { node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(v.decisions.find(d=>d.id===process.argv[2])))' "$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)" "$1"; }
OD="$S/open-decision.js"
T20="$(node -e 'process.stdout.write("字".repeat(20))')"; T21="$(node -e 'process.stdout.write("字".repeat(21))')"

# no --title: no title field, no title in the notice
od "$OD"; assert_eq "$RC" 0 "no --title: exit 0"; OLD="$OUT"
assert_eq "$(entry "$OLD" | grep -c '"title"')" 0 "no --title: the entry has no title field"
assert_eq "$(grep -c '"title"' "$STUB/calls.log")" 0 "no --title: the open notice has no title"
# 20 code points pass
od "$OD" --title "$T20"; assert_eq "$RC" 0 "--title of 20 characters: exit 0"; ID20="$OUT"
assert_eq "$(entry "$ID20" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).title)')" "$T20" "20 characters stored verbatim"
assert_contains "$(node "$OD" show --id "$ID20" --cwd "$R")" "title: $T20" "show prints the title"
assert_contains "$(tail -1 "$STUB/calls.log")" "\\\"title\\\":\\\"$T20\\\"" "the open notice carries the title"
# 21 refused, nothing written
BEFORE="$(store | md5sum)"
od "$OD" --title "$T21"; assert_eq "$RC" 2 "--title of 21 characters: exit 2"; assert_contains "$ERR" "at most 20 characters" "21: reason named"; assert_eq "$OUT" "" "21: no id printed"
assert_eq "$(store | md5sum)" "$BEFORE" "21: the store file is byte-identical"
od "$OD" --title ""; assert_eq "$RC" 2 "--title empty: exit 2"
assert_eq "$(store | md5sum)" "$BEFORE" "empty title: the store file is byte-identical"
# a control character (newline, ESC, U+2028) is refused like a length error: the PM mirror would reject the whole notice ("bad title"), the pane would draw it raw
BEFORE="$(store | md5sum)"
for BAD in $'發版\n時機' $'發版\033[31m' $'發版\xe2\x80\xa8時機'; do
  SENT="$(wc -l < "$STUB/calls.log")"
  od "$OD" --title "$BAD"; assert_eq "$RC" 2 "--title with a control character: exit 2"; assert_contains "$ERR" "control characters" "control title: reason named"; assert_eq "$OUT" "" "control title: no id printed"
  assert_eq "$(store | md5sum)" "$BEFORE" "control title: the store file is byte-identical"
  assert_eq "$(wc -l < "$STUB/calls.log")" "$SENT" "control title: no notice sent"
done
# reader side: an entry already holding a control-character title (old data, hand-written store) is read as having no title, so cardTitle derives one from the question
CARD="$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)"
node -e 'const fs=require("fs");const f=process.argv[1];const v=JSON.parse(fs.readFileSync(f,"utf8"));for(const d of v.decisions){if(d.id===process.argv[2])d.title="發版\n時機"}fs.writeFileSync(f,JSON.stringify(v))' "$CARD" "$ID20"
READ="$(R="$R" REPO_ROOT="$REPO_ROOT" node -e '
const path=require("path");const {scopeFromCwd}=require(path.join(process.env.REPO_ROOT,"src/status/project-key"));
const sc=scopeFromCwd(process.env.R);const di=require(path.join(process.env.REPO_ROOT,"src/status/decision-input"));
const rd=di.readDecision({commonDir:require(path.join(process.env.REPO_ROOT,"src/status/scope-key")).commonDirOf(sc.repo_identity),key:sc.project_key,identity:sc.repo_identity,nowMs:Date.now(),liveBase:null});
const d=rd.value.find(x=>x.id===process.argv[1]);process.stdout.write(JSON.stringify({title:d.title,shown:di.cardTitle(d)}))' "$ID20")"
assert_eq "$READ" '{"title":null,"shown":"Q?"}' "reader: a stored control-character title is dropped, the title shown is derived from the question"
# the mirror keeps the title (new notice) and still takes the old notice
FROM="example/host-b/proj--claude@FAKE-sess-1"
node -e 'const fs=require("fs");const from=process.argv[1];const ms=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter(c=>c.args[0]==="send").map((c,i)=>({message_id:"01FAKE"+String(i+1).padStart(6,"0"),from,kind:"chat",content:c.args[2]}));fs.writeFileSync(process.argv[3],JSON.stringify({member:"pm--claude",truncated:false,messages:ms}))' "$FROM" "$STUB/calls.log" "$STUB/recent.json"
ING="$(node "$S/fleet-card-mirror.js" ingest --json 2>/dev/null < /dev/null)"
assert_contains "$ING" '"accepted":2' "ingest: the old-format and the titled open are both accepted"
V="$(node "$S/fleet-card-mirror.js" view --json < /dev/null)"
assert_eq "$(node -e 'const v=JSON.parse(process.argv[1]);const c=Object.fromEntries(v.cards.map(x=>[x.card_id,x]));process.stdout.write(String(c[process.argv[2]].title)+"|"+("title" in c[process.argv[3]]))' "$V" "$ID20" "$OLD")" "$T20|false" "mirror: the titled card keeps its title, the old one has none"
# negative control: the length check removed -> a 21-character title is written
MUT="$TEST_TMP/mut"; rm -rf "$MUT"; mkdir -p "$MUT"; ln -s "$REPO_ROOT/src" "$MUT/src"; mkdir -p "$MUT/scripts"
for f in "$S"/*; do ln -s "$f" "$MUT/scripts/$(basename "$f")"; done
rm "$MUT/scripts/open-decision.js"
sed_mutant "$S/open-decision.js" "$MUT/scripts/open-decision.js" "s/ || Array.from(ex.title).length > TITLE_MAX//"
od "$MUT/scripts/open-decision.js" --title "$T21"; assert_eq "$RC" 0 "mutant (length check removed): the 21-character title is accepted, so the refusal check above would be red"
# negative control: the control-character check removed -> a newline title is written
rm -rf "$MUT"; mkdir -p "$MUT"; ln -s "$REPO_ROOT/src" "$MUT/src"; mkdir -p "$MUT/scripts"
for f in "$S"/*; do ln -s "$f" "$MUT/scripts/$(basename "$f")"; done
rm "$MUT/scripts/open-decision.js"
sed_mutant "$S/open-decision.js" "$MUT/scripts/open-decision.js" "s/ || require('.\/lib\/card-notice.js').CONTROL.test(ex.title)//"
od "$MUT/scripts/open-decision.js" --title $'發版\n時機'; assert_eq "$RC" 0 "mutant (control check removed): the newline title is accepted, so the refusal check above would be red"
finalize_test
