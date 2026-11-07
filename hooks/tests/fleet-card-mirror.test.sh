#!/usr/bin/env bash
# fleetcards phase 1 (PM ruling 01M6W4RNP6): open-decision.js tells the PM when a card opens or leaves "open" (AUTOPILOT-CARD/1 fleet message),
# scripts/fleet-card-mirror.js folds those messages into a mirror the live panel reads. Against a STUB `fleet`.
# Negative controls (sed_mutant, shown red before green): drop the open notice; drop the validation of state; let anyone close a card; clear the table on a
# failed sync; stale at exactly 5 minutes; reconcile everything; make the sync call something other than `fleet recent`; drop the dedup.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_CARD_NOTIFY_TO
export CLAUDE_CODE_SESSION_ID=FAKE-sess-1
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_CARD_NOTIFY=on
export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror"
S="$REPO_ROOT/scripts"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const D = process.env.STUB_DIR; const a = process.argv.slice(2);
fs.appendFileSync(D + '/calls.log', JSON.stringify({ args: a, fyi: process.env.FLEET_FYI || null }) + '\n');
if (a[0] === 'send') { if (fs.existsSync(D + '/send-fails')) process.exit(1); process.stdout.write('{"ok":true}\n'); process.exit(0); }
if (a[0] === 'recent') { if (fs.existsSync(D + '/recent-fails')) { process.stderr.write('boom\n'); process.exit(1); } process.stdout.write(fs.readFileSync(D + '/recent.json', 'utf8')); process.exit(0); }
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
export PATH="$STUB:$PATH" # a bare `fleet` is the stub too: this suite can never reach the real one
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
reset_calls() { : > "$STUB/calls.log"; rm -f "$STUB/send-fails" "$STUB/recent-fails"; }
sends() { grep -c '"args":\["send"' "$STUB/calls.log" | tr -d ' '; }
open_card() { # <OD script> [env prefix via export] -> OUT=id
  OUT="$(node "$1" open --cwd "$R" --root-run-id root-t --question "${2:-Which way?}" --option "A::a" --option "B::b" --not-authorized irreversible 2>"$TEST_TMP/err" < /dev/null)"; RC=$?
}
OD="$S/open-decision.js"
# build a mutant tree: scripts/ with every file symlinked except <rel> (a copy the sed edits), src symlinked
MUT="$TEST_TMP/mut"
mk_mut() { # <rel path under scripts/> <sed cmd> -> $MUT/scripts/<rel> mutated
  local rel="$1" cmd="$2" d
  rm -rf "$MUT"; mkdir -p "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"
  for f in "$S"/*; do ln -s "$f" "$MUT/scripts/$(basename "$f")"; done
  case "$rel" in
    lib/*) rm "$MUT/scripts/lib"; mkdir -p "$MUT/scripts/lib"; for f in "$S"/lib/*; do ln -s "$f" "$MUT/scripts/lib/$(basename "$f")"; done; rm "$MUT/scripts/$rel" ;;
    *) rm "$MUT/scripts/$rel" ;;
  esac
  # the two entry scripts are copied (not linked) so their ./lib requires resolve inside the mutant tree
  for f in fleet-card-mirror.js open-decision.js; do [ "$f" = "$rel" ] || { rm "$MUT/scripts/$f"; cp "$S/$f" "$MUT/scripts/$f"; }; done
  sed_mutant "$S/$rel" "$MUT/scripts/$rel" "$cmd" || return 1
}

# ---- 1. open sends one notice ----
reset_calls
open_card "$OD"; ID="$OUT"
assert_eq "$RC" 0 "open: exit 0"
assert_eq "$(sends)" 1 "open: one fleet send"
LINE="$(grep '"args":\["send"' "$STUB/calls.log" | head -1)"
assert_contains "$LINE" '"cookys/aimax395/pm--claude"' "open: sent to the PM"
assert_contains "$LINE" '"fyi":"1"' "open: sent as FYI"
PARSED="$(node -e 'const n=require(process.argv[1]);const l=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8").split("\n")[0]);const r=n.parse(l.args[2]);process.stdout.write(r.ok?r.notice.event+" "+r.notice.card_id+" "+r.notice.state+" "+r.notice.session:"BAD "+r.reason)' "$S/lib/card-notice.js" "$STUB/calls.log")"
assert_eq "$PARSED" "open $ID open FAKE-sess-1" "open: the message parses and carries id, state, session"
# negative control: without the notify call the same scenario sends nothing
mk_mut open-decision.js "/notifyPm('open', /d" && { reset_calls; open_card "$MUT/scripts/open-decision.js"; assert_eq "$(sends)" 0 "open mutant (notice dropped): nothing sent, so the check above would be red"; }

# ---- 1a. under the suite environment nothing reaches any fleet, stub or real ----
reset_calls
( unset AUTOPILOT_FLEET_BIN; export AUTOPILOT_CARD_NOTIFY=off; open_card "$OD"; node "$OD" close --cwd "$R" --root-run-id root-t --id "$OUT" > /dev/null 2>&1 < /dev/null ); assert_eq "$(sends)" 0 "suite default (AUTOPILOT_CARD_NOTIFY=off, bare fleet on PATH): no send on open or close"
reset_calls
( unset AUTOPILOT_FLEET_BIN AUTOPILOT_CARD_NOTIFY; export NODE_TEST_CONTEXT=child-v8; node -e 'const r=require(process.argv[1]).notify("open",{card_id:"d-00000001",question:"q",state:"open",session:null});process.stdout.write(r.why)' "$S/lib/card-notice.js" > "$TEST_TMP/nt" ); assert_eq "$(cat "$TEST_TMP/nt")" "node test without a stub" "node:test tree without AUTOPILOT_FLEET_BIN: refuses to send"; assert_eq "$(sends)" 0 "node:test tree: no send"
assert_eq "$(grep -c 'AUTOPILOT_CARD_NOTIFY=off' "$REPO_ROOT/hooks/tests/lib.sh" | tr -d ' ')" 1 "lib.sh exports AUTOPILOT_CARD_NOTIFY=off for every suite"
mk_mut open-decision.js "/notifyPm('open', /d" >/dev/null
sed_mutant "$REPO_ROOT/hooks/tests/lib.sh" "$TEST_TMP/lib-mut.sh" 's/^export AUTOPILOT_CARD_NOTIFY=off$/export AUTOPILOT_CARD_NOTIFY=on/' && assert_eq "$(grep -c 'AUTOPILOT_CARD_NOTIFY=off' "$TEST_TMP/lib-mut.sh" | tr -d ' ')" 0 "lib.sh mutant (default on): the check above would be red"

# ---- 1b. never fails the card ----
reset_calls; touch "$STUB/send-fails"; open_card "$OD"; assert_eq "$RC" 0 "open: a refused send does not fail the card"; assert_contains "$OUT" "d-" "open: id still printed"
reset_calls; ( export AUTOPILOT_FLEET_BIN=/nonexistent/fleet; open_card "$OD"; echo "$RC" > "$TEST_TMP/rc" ); assert_eq "$(cat "$TEST_TMP/rc")" 0 "open: no fleet binary is silent"
reset_calls; ( export AUTOPILOT_CARD_NOTIFY=off; open_card "$OD" ); assert_eq "$(sends)" 0 "AUTOPILOT_CARD_NOTIFY=off sends nothing"

# ---- 2. close sends; mirror clears; 3. replay does not duplicate ----
reset_calls; open_card "$OD"; ID2="$OUT"
node "$OD" close --cwd "$R" --root-run-id root-t --id "$ID2" > /dev/null 2>&1 < /dev/null
assert_eq "$(sends)" 2 "close: a second send"
# turn the stub's sent lines into the messages the PM seat would be handed
mkrecent() { # <from> -> $STUB/recent.json from calls.log
  node -e 'const fs=require("fs");const from=process.argv[1];const ms=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter(c=>c.args[0]==="send").map((c,i)=>({message_id:"01FAKE"+String(i+1).padStart(6,"0"),from,kind:"chat",content:c.args[2]}));fs.writeFileSync(process.argv[3],JSON.stringify({member:"pm--claude",truncated:false,messages:ms}))' "$1" "$STUB/calls.log" "$STUB/recent.json"
}
FROM="cookys/hostb/proj--claude@FAKE-sess-1"
ing() { node "$S/fleet-card-mirror.js" ingest --json 2>/dev/null < /dev/null; }
cardcount() { node "$S/fleet-card-mirror.js" view --json < /dev/null | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).cards.length))'; }
# first only the open message
reset_calls; open_card "$OD"; ID3="$OUT"
mkrecent "$FROM"; R1="$(ing)"
assert_contains "$R1" '"accepted":1' "ingest: open accepted"
assert_eq "$(cardcount)" 1 "mirror: one open card"
node "$S/fleet-card-mirror.js" view --json < /dev/null | grep -q '"session":"FAKE-sess-1"' && assert_eq 1 1 "mirror: session is the one in from" || fail "mirror: session missing"
# the same messages again (cursor reset) -> no duplicate
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.cursor=null;fs.writeFileSync(f,JSON.stringify(m))' "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-mirror.json"
R2="$(ing)"; assert_contains "$R2" '"duplicate":1' "replay of the same open: duplicate"
assert_eq "$(cardcount)" 1 "replay: still one card"
# same card, a different message id (a re-send): still one
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.messages=m.messages.map(x=>({...x,message_id:"01FAKE9"+x.message_id.slice(7)}));fs.writeFileSync(f,JSON.stringify(m))' "$STUB/recent.json"
R3="$(ing)"; assert_contains "$R3" '"duplicate":1' "re-sent open (new message id): duplicate"; assert_eq "$(cardcount)" 1 "re-send: still one card"
# negative control: dedup removed -> a second copy would be added under another sender... check by mutant that drops the owner/duplicate return
mk_mut fleet-card-mirror.js "s/return owner.member === from.member && owner.courier === from.courier ? 'duplicate' : 'reject:card id held by another sender';/delete m.cards[n.card_id];/" && {
  ( export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror-mut"; mkdir -p "$AUTOPILOT_CARD_MIRROR_DIR"; cp "$TEST_TMP/mirror/fleet-card-mirror.json" "$AUTOPILOT_CARD_MIRROR_DIR/"
    node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.cursor=null;fs.writeFileSync(f,JSON.stringify(m))' "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-mirror.json"
    node "$MUT/scripts/fleet-card-mirror.js" ingest --json < /dev/null > "$TEST_TMP/mutout" 2>&1 ); assert_contains "$(cat "$TEST_TMP/mutout")" '"accepted":1' "dedup mutant: the re-sent open is accepted again, so the duplicate check above would be red"; }
# now the close
CLOSE_LINE="$(grep '"args":\["send"' "$STUB/calls.log" | head -1)"
reset_calls; node "$OD" close --cwd "$R" --root-run-id root-t --id "$ID3" > /dev/null 2>&1 < /dev/null
assert_eq "$(sends)" 1 "close: sent"
mkrecent "$FROM"; sed -i 's/01FAKE000001/01FAKEB00001/' "$STUB/recent.json"
R4="$(ing)"; assert_contains "$R4" '"accepted":1' "close accepted"
assert_eq "$(cardcount)" 0 "close: the mirror entry is gone"
# a replayed old open after the close must not bring the card back
mkrecent "$FROM"; reset_calls
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.messages=[{message_id:"01FAKEC00001",from:"cookys/hostb/proj--claude@FAKE-sess-1",kind:"chat",content:process.argv[2]}];fs.writeFileSync(f,JSON.stringify(m))' "$STUB/recent.json" "$(node -e 'process.stdout.write(require(process.argv[1]).encode("open",{card_id:process.argv[2],question:"old",state:"open",session:"FAKE-sess-1"}))' "$S/lib/card-notice.js" "$ID3")"
ing > /dev/null; assert_eq "$(cardcount)" 0 "a replayed open of a closed card does not reopen it"
# negative control: a mutant that forgets the closed ids resurrects it
mk_mut fleet-card-mirror.js "s/    if (tomb) return 'duplicate';/    void tomb;/" && ( export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror-mut2"; mkdir -p "$AUTOPILOT_CARD_MIRROR_DIR"; cp "$TEST_TMP/mirror/fleet-card-mirror.json" "$AUTOPILOT_CARD_MIRROR_DIR/"; node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.cursor=null;fs.writeFileSync(f,JSON.stringify(m))' "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-mirror.json"; node "$MUT/scripts/fleet-card-mirror.js" ingest < /dev/null > /dev/null 2>&1; node "$MUT/scripts/fleet-card-mirror.js" view --json < /dev/null | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).cards.length))' > "$TEST_TMP/mutcount" ); assert_eq "$(cat "$TEST_TMP/mutcount")" 1 "tombstone mutant: the closed card comes back, so the check above would be red"

# ---- 4. validation ----
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"
mkmsgs() { node -e 'const fs=require("fs");const rows=JSON.parse(process.argv[1]);fs.writeFileSync(process.argv[2],JSON.stringify({truncated:false,messages:rows.map((r,i)=>({message_id:"01VAL"+String(i+1).padStart(6,"0"),kind:"chat",...r}))}))' "$1" "$STUB/recent.json"; }
CASES="$(node -e '
const body=(ov)=>{const o={at:new Date().toISOString(),card_id:"d-0000000b",event:"open",question:"Q",session:null,state:"open"};for(const[k,v]of Object.entries(ov)){if(k.startsWith("-"))delete o[k.slice(1)];else o[k]=v}return "AUTOPILOT-CARD/1 "+JSON.stringify(o)};
const f="cookys/hostb/proj--claude@FAKE-sess-1";
console.log(JSON.stringify([
 {from:f,content:body({"extra":1})},
 {from:f,content:body({"-session":0})},
 {from:f,content:body({"card_id":"x-1"})},
 {from:f,content:body({"question":"  "})},
 {from:f,content:body({"state":"weird"})},
 {from:f,content:body({"event":"close","state":"open"})},
 {from:f,content:body({"event":"close","state":"weird"})},
 {from:"not an address",content:body({})},
 {from:f,content:body({})+"\nmore"},
 {from:f,content:body({"session":"OTHER-sess"})},
 {from:f,content:body({"at":"2999-01-01T00:00:00Z"})},
 {from:f,content:"just chatting"},
 {from:f,content:" AUTOPILOT-CARD/1 {}"}
]))')"
mkmsgs "$CASES"; RV="$(ing)"
assert_contains "$RV" '"accepted":0' "validation: nothing forged accepted"
assert_contains "$RV" '"rejected":11' "validation: eleven malformed notices rejected (plain chat ignored)"
assert_eq "$(cardcount)" 0 "validation: mirror empty"
# negative control: state validation removed -> the unknown state gets in
mk_mut lib/card-notice.js "/bad state/d" && ( export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror-mut3"; node "$MUT/scripts/fleet-card-mirror.js" ingest --json < /dev/null > "$TEST_TMP/mutout3" 2>&1 ); assert_contains "$(cat "$TEST_TMP/mutout3")" '"accepted":1' "state-validation mutant: an unknown state is accepted, so the rejection above would be red"
# a close from a sender that did not open it is refused
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"
node -e 'const n=require(process.argv[1]);const fs=require("fs");fs.writeFileSync(process.argv[3],JSON.stringify({truncated:false,messages:[
 {message_id:"01OWN000001",from:"cookys/hostb/proj--claude@S1",kind:"chat",content:n.encode("open",{card_id:"d-0000000c",question:"mine",state:"open",session:"S1"})},
 {message_id:"01OWN000002",from:"cookys/hostc/evil--claude@S9",kind:"chat",content:n.encode("close",{card_id:"d-0000000c",question:"mine",state:"closed",session:"S9"})}]}))' "$S/lib/card-notice.js" x "$STUB/recent.json"
RC1="$(ing)"; assert_contains "$RC1" '"rejected":1' "a close by another sender is rejected"; assert_eq "$(cardcount)" 1 "the card stays open"
mk_mut fleet-card-mirror.js "/close from a sender that did not open the card/d" && ( export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror-mut4"; node "$MUT/scripts/fleet-card-mirror.js" ingest --json < /dev/null > /dev/null 2>&1; node "$MUT/scripts/fleet-card-mirror.js" view --json < /dev/null | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).cards.length))' > "$TEST_TMP/mutcount4" ); assert_eq "$(cat "$TEST_TMP/mutcount4")" 0 "owner-check mutant: a stranger clears the card, so the check above would be red"

# ---- 5. sync failure keeps the old table; 6. stale boundary ----
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"
mkmsgs "$(node -e 'console.log(JSON.stringify([{from:"cookys/hostb/proj--claude@S1",content:require(process.argv[1]).encode("open",{card_id:"d-0000000d",question:"keep me",state:"open",session:"S1"})}]))' "$S/lib/card-notice.js")"
node "$S/fleet-card-mirror.js" sync --json < /dev/null > "$TEST_TMP/sync1"
SYNCED="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).synced_at)' "$TEST_TMP/sync1")"
touch "$STUB/recent-fails"; node "$S/fleet-card-mirror.js" sync --json < /dev/null > "$TEST_TMP/sync2"; rm -f "$STUB/recent-fails"
assert_eq "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.cards.length+"|"+(v.last_error||"").slice(0,17)+"|"+v.synced_at)' "$TEST_TMP/sync2")" "1|fleet recent exit|$SYNCED" "failed sync: the old card stays, the error is recorded, synced_at is the last good one"
node "$S/fleet-card-mirror.js" ingest < /dev/null > /dev/null 2>&1 || true
touch "$STUB/recent-fails"; node "$S/fleet-card-mirror.js" ingest < /dev/null > /dev/null 2>&1; assert_eq "$?" 1 "failed ingest: exit 1"; rm -f "$STUB/recent-fails"
mk_mut fleet-card-mirror.js "s/        if (r.error) { m.last_error = r.error;/        if (r.error) { m.cards = {}; m.last_error = r.error;/" && ( export AUTOPILOT_CARD_MIRROR_DIR="$TEST_TMP/mirror-mut5"; mkdir -p "$AUTOPILOT_CARD_MIRROR_DIR"; cp "$TEST_TMP/mirror/fleet-card-mirror.json" "$AUTOPILOT_CARD_MIRROR_DIR/"; touch "$STUB/recent-fails"; node "$MUT/scripts/fleet-card-mirror.js" sync --json < /dev/null | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).cards.length))' > "$TEST_TMP/mutcount5"; rm -f "$STUB/recent-fails" ); assert_eq "$(cat "$TEST_TMP/mutcount5")" 0 "clear-on-failure mutant: the table empties (a false '0 cards'), so the check above would be red"
# never synced
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"
touch "$STUB/recent-fails"; NV="$(node "$S/fleet-card-mirror.js" sync --json < /dev/null)"; rm -f "$STUB/recent-fails"
assert_contains "$NV" '"synced_at":null' "never synced: synced_at null"; assert_contains "$NV" '"stale":true' "never synced: stale"
# stale boundary
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"; node "$S/fleet-card-mirror.js" ingest --now 2026-11-08T00:00:00Z < /dev/null > /dev/null 2>&1
stale_at() { node "$1" view --json --now "$2" < /dev/null | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).stale))'; }
assert_eq "$(stale_at "$S/fleet-card-mirror.js" 2026-11-08T00:04:59.999Z)" false "stale: just before 5 minutes is fresh"
assert_eq "$(stale_at "$S/fleet-card-mirror.js" 2026-11-08T00:05:00Z)" false "stale: exactly 5 minutes is fresh"
assert_eq "$(stale_at "$S/fleet-card-mirror.js" 2026-11-08T00:05:00.001Z)" true "stale: past 5 minutes is stale"
mk_mut fleet-card-mirror.js "s/now - syncedMs > STALE_MS/now - syncedMs >= STALE_MS/" && assert_eq "$(AUTOPILOT_CARD_MIRROR_DIR="$AUTOPILOT_CARD_MIRROR_DIR" stale_at "$MUT/scripts/fleet-card-mirror.js" 2026-11-08T00:05:00Z)" true "stale mutant (>=): exactly 5 minutes turns stale, so the boundary check above would be red"

# ---- 7. read-only ----
reset_calls; node "$S/fleet-card-mirror.js" sync < /dev/null > /dev/null 2>&1
BAD="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter(c=>c.args[0]!=="recent");process.stdout.write(String(l.length))' "$STUB/calls.log")"
assert_eq "$BAD" 0 "read-only: sync calls only fleet recent"
assert_eq "$(grep -c '"args":\["recent"' "$STUB/calls.log" | tr -d ' ')" 1 "read-only: exactly one fleet recent per sync"
mk_mut fleet-card-mirror.js "s/const args = \['recent', /const args = ['decision', 'claim', /" && { reset_calls; node "$MUT/scripts/fleet-card-mirror.js" sync < /dev/null > /dev/null 2>&1; BAD2="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter(c=>c.args[0]!=="recent");process.stdout.write(String(l.length))' "$STUB/calls.log")"; assert_eq "$BAD2" 1 "read-only mutant (a claim call): the log shows it, so the check above would be red"; }

# ---- 8. to-do reconciliation ----
rm -rf "$AUTOPILOT_CARD_MIRROR_DIR"
node -e 'const n=require(process.argv[1]);require("fs").writeFileSync(process.argv[2],JSON.stringify({truncated:false,messages:[
 {message_id:"01T0000001",from:"cookys/hostb/proj--claude@S1",kind:"chat",content:n.encode("open",{card_id:"d-00000e01",question:"open one",state:"open",session:"S1"})},
 {message_id:"01T0000002",from:"cookys/hostb/proj--claude@S1",kind:"chat",content:n.encode("open",{card_id:"d-00000e02",question:"answered one",state:"open",session:"S1"})},
 {message_id:"01T0000003",from:"cookys/hostb/proj--claude@S1",kind:"chat",content:n.encode("close",{card_id:"d-00000e02",question:"answered one",state:"awaiting_operator_action",session:"S1"})}]}))' "$S/lib/card-notice.js" "$STUB/recent.json"
ing > /dev/null
mkdir -p "$AUTOPILOT_CARD_MIRROR_DIR"
cat > "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-todo.json" <<'JSON'
{"items":[
 {"card_id":"d-00000e01","step":"flip the switch","owner_session":"cookys/hostb/proj--claude@S1","since":"2026-11-07T10:00:00Z","due":null},
 {"card_id":"d-00000e02","step":"change DNS","owner_session":"cookys/hostb/proj--claude@S1","since":"2026-11-06T10:00:00Z","due":"2026-11-09T00:00:00Z"},
 {"card_id":"d-00000e99","step":"nobody knows this one","owner_session":"somewhere","since":"2026-11-05T10:00:00Z"},
 {"card_id":"bad","step":"x","owner_session":"y","since":"2026-11-05T10:00:00Z"}
]}
JSON
TV="$(node "$S/fleet-card-mirror.js" view --json < /dev/null)"
rec() { node -e 'const v=JSON.parse(process.argv[1]);process.stdout.write(v.todo.items.map(i=>i.card_id.slice(-3)+":"+i.reconciled).join(",")+"|skipped="+v.todo.skipped)' "$1"; }
assert_eq "$(rec "$TV")" "e01:true,e02:true,e99:false|skipped=1" "todo: matched by card_id (open and answered); the unknown one is unreconciled; the bad item is skipped"
mk_mut fleet-card-mirror.js "s/const known = (id) => .*/const known = (id) => true;/" && assert_eq "$(rec "$(AUTOPILOT_CARD_MIRROR_DIR="$AUTOPILOT_CARD_MIRROR_DIR" node "$MUT/scripts/fleet-card-mirror.js" view --json < /dev/null)")" "e01:true,e02:true,e99:true|skipped=1" "reconcile mutant (always known): the unknown card looks reconciled, so the check above would be red"
printf 'not json' > "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-todo.json"
TV2="$(node "$S/fleet-card-mirror.js" view --json < /dev/null)"
assert_contains "$TV2" '"error":"not JSON"' "todo: a broken file is reported, not guessed"
rm "$AUTOPILOT_CARD_MIRROR_DIR/fleet-card-todo.json"
assert_contains "$(node "$S/fleet-card-mirror.js" view --json < /dev/null)" '"present":false' "todo: absent file is absent"
finalize_test
