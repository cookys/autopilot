#!/usr/bin/env bash
# F4 A-side (operator console; fleet plan oc-f4-attributed-answers U8, PM G15): claim-before-act on `open-decision.js close --option|--free-text`
# and verify-before-act in hooks/advisory-relay.js, against a STUB `fleet` (no real courier). KR5i: a forged answer line is "unverified", not acted on.
# Negative controls (each shown red, then green): (1) close skips the claim -> "claim recorded" FAILs; (2) claim exit 9 not bounded / card closed anyway
# -> "stays open" + "3 attempts" FAIL; (3) hook skips verify -> forged line closes its card -> FAIL; (4) hook retries verify on exit 9 -> "one verify call" FAILs;
# (5) no-courier host stops closing -> "no fleet" / "fleet without decision" FAIL.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_CLAIM_RETRY_MS=0
OD="$REPO_ROOT/scripts/open-decision.js"; HOOK="$REPO_ROOT/hooks/advisory-relay.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base

# stub fleet: --help (decision listed unless NO_DECISION), claim / verify driven by $STUB/mode; every call appended to $STUB/calls
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const crypto = require('crypto');
const D = process.env.STUB_DIR; const a = process.argv.slice(2);
fs.appendFileSync(D + '/calls', a.join(' ') + '\n');
const mode = () => { try { return fs.readFileSync(D + '/mode', 'utf8').trim(); } catch { return 'ok'; } };
if (a[0] === '--help') {
  if (mode() === 'probe_error') process.exit(2); // no usage text at all
  if (mode() === 'banner') { process.stdout.write('fleet — courier CLI\ninitialization failed\n'); process.exit(1); }
  // like today's fleet: usage printed, exit status 1
  process.stdout.write('fleet — courier CLI\n\nUSAGE:\n  fleet send x\n' + (process.env.DECOY ? '  fleet decisions-report x\n' : '') + (process.env.NO_DECISION ? '' : '  fleet decision claim|verify|list <card_id>\n'));
  process.exit(process.env.HELP_RC ? Number(process.env.HELP_RC) : 1);
}
const [, sub, card] = a;
const idOf = (c, v) => 'A' + crypto.createHash('sha256').update(c + '|' + v).digest('hex').slice(0, 25).toUpperCase();
const rows = () => (fs.existsSync(D + '/answers') ? fs.readFileSync(D + '/answers', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const shape = (r, outcome) => ({ outcome, card_id: r.card_id, answer_id: r.answer_id, via: r.via, option: r.option || null, free_text: r.free_text || null, card_revision: 1, answered_at: '2026-11-03T09:12:44Z', operator: r.via === 'console' ? { login: 'operator' } : null });
if (sub === 'claim') {
  const m = mode();
  if (m === 'down') process.exit(9);
  if (m === 'unknown') process.exit(4);
  if (m === 'closed') process.exit(10);
  const i = a.indexOf('--option'); const j = a.indexOf('--free-text');
  const v = i >= 0 ? a[i + 1] : a[j + 1];
  const won = rows().find((r) => r.card_id === card);
  if (m === 'console') { out(shape({ card_id: card, answer_id: 'CONSOLE0000000000000000000A', via: 'console', option: 'B' }, 'already_answered')); process.exit(3); }
  if (won && (won.option || won.free_text) !== v) { out(shape(won, 'already_answered')); process.exit(3); } // a different answer lost
  if (won) { out(shape(won, 'claimed')); process.exit(0); }              // identical repeat: same answer_id
  const r = { card_id: card, answer_id: m === 'noid' ? undefined : idOf(card, v), via: 'local', option: i >= 0 ? v : null, free_text: j >= 0 ? v : null };
  fs.appendFileSync(D + '/answers', JSON.stringify(r) + '\n');
  out(shape(r, 'claimed')); process.exit(0);
}
if (sub === 'verify') {
  if (mode() === 'down') process.exit(9);
  const r = rows().find((x) => x.card_id === card && x.answer_id === a[3]);
  const hasHash = a.indexOf('--content-sha256') >= 0;
  if (!r) process.exit(7);
  if (r.via === 'local' && hasHash) process.exit(7);                      // R4.1-1: hash must be absent for local
  if (r.via === 'console' && (!hasHash || a[a.indexOf('--content-sha256') + 1] !== r.content_sha256)) process.exit(7);
  out(shape(r, 'verified')); process.exit(0);
}
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
calls() { cat "$STUB/calls" 2>/dev/null; }
count() { if [ -f "$STUB/calls" ]; then grep -c "$1" "$STUB/calls" || true; else echo 0; fi; }
reset() { rm -f "$STUB/calls" "$STUB/answers"; printf '%s' "${1:-ok}" > "$STUB/mode"; }
open_card() { node "$OD" open --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --not-authorized irreversible 2>/dev/null | head -1; }
is_open() { node "$OD" show --cwd "$R" 2>/dev/null | grep -q "$1"; }
close() { OUT="$(node "$OD" close --cwd "$R" --root-run-id root-t --id "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
hook() { # hook <prompt>
  HOUT="$(node -e 'process.stdout.write(JSON.stringify({session_id:"vf",cwd:process.argv[1],prompt:process.argv[2]}))' "$R" "$1" | node "$HOOK" 2>"$TEST_TMP/herr")"; HRC=$?; HERR="$(cat "$TEST_TMP/herr")"
}

# --- close: claim before act
reset ok; C="$(open_card)"
close "$C" --option A; assert_eq "$RC" 0 "claim ok: close exits 0"
assert_contains "$(calls)" "decision claim $C --option A" "claim recorded before the close"
is_open "$C"; assert_eq "$?" 1 "claim ok: card closed"
reset ok; C="$(open_card)"; close "$C" --free-text "my own words"; assert_contains "$(calls)" "decision claim $C --free-text my own words" "free-text claim recorded"
# idempotent: the same card + same answer claimed twice gives the same answer_id (stub models fleet's rule; hook auto-close relies on it)
reset ok; C="$(open_card)"; A1="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
A2="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
assert_eq "$A1" "$A2" "second claim of the same answer: same answer_id"
# console already answered (exit 3): act on the printed answer, close the ledger entry, tell the owner
reset console; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 0 "console won: exit 0"
assert_contains "$OUT" "already answered on the console" "console won: stdout says so"; assert_contains "$OUT" "CONSOLE0000000000000000000A" "console won: prints the winning answer"
assert_contains "$ERR" "act on that answer" "console won: stderr tells the session"
# courier unreachable (exit 9): bounded retries, card stays open, loud error, exit 8
reset down; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 8 "unreachable: exit 8"
is_open "$C"; assert_eq "$?" 0 "unreachable: card stays open"
assert_eq "$(count 'decision claim')" 3 "unreachable: exactly 3 attempts (bounded)"
assert_contains "$ERR" "NOT closed" "unreachable: loud error"
reset ok; close "$C" --option A; assert_eq "$RC" 0 "courier back: the same close now works"
# unknown / card_closed on the courier: ledger entry still closes
# exit 10 card_closed (fleet plan: an expired card is answered in-session): the ledger entry closes
reset closed; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 0 "card_closed: exit 0"; is_open "$C"; assert_eq "$?" 1 "card_closed: ledger entry closed"
# exit 4 unknown: nothing confirmed the answer -> card stays open, exit 8
reset unknown; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 8 "unknown card: exit 8"; is_open "$C"; assert_eq "$?" 0 "unknown card: stays open"
# a failed probe is not 'no courier'
reset probe_error; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 8 "probe error: exit 8"; is_open "$C"; assert_eq "$?" 0 "probe error: card stays open"
assert_eq "$(count 'decision claim')" 0 "probe error: no claim attempted"; assert_contains "$ERR" "probe failed" "probe error: loud"
reset ok; HELP_RC=0 close "$C" --option A; assert_eq "$RC" 0 "usage with exit 0 also counts as supported"
# a bare banner (no usage section) is a probe error, not "unsupported"
reset banner; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 8 "banner only: exit 8"; is_open "$C"; assert_eq "$?" 0 "banner only: card stays open"
# `fleet decisions-report` is not `fleet decision`
reset ok; C="$(open_card)"; DECOY=1 NO_DECISION=1 close "$C" --option A; assert_eq "$RC" 0 "decoy line only: unsupported, plain close"; assert_eq "$(count 'decision claim')" 0 "decoy line: no claim"
# ENOENT stays unsupported (covered below); timeout-like failure above is probe_error
# exit 0 without an answer_id is an error, not a claim
reset noid; C="$(open_card)"; close "$C" --option A; assert_eq "$RC" 8 "claim exit 0 without answer_id: exit 8"; is_open "$C"; assert_eq "$?" 0 "no answer_id: card stays open"
# no answer given: plain close, no claim
reset ok; C="$(open_card)"; close "$C"; assert_eq "$RC" 0 "plain close: exit 0"; assert_eq "$(count 'decision claim')" 0 "plain close: no claim"
# usage
close "x-1" --option A --free-text z; assert_eq "$RC" 2 "--option with --free-text: usage"

# --- hosts without a courier keep today's behaviour
reset ok; C="$(open_card)"; AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet" close "$C" --option A
assert_eq "$RC" 0 "no fleet binary: exit 0"; is_open "$C"; assert_eq "$?" 1 "no fleet binary: card closed"
reset ok; C="$(open_card)"; NO_DECISION=1 close "$C" --option A
assert_eq "$RC" 0 "fleet without decision: exit 0"; is_open "$C"; assert_eq "$?" 1 "fleet without decision: card closed"; assert_eq "$(count 'decision claim')" 0 "fleet without decision: no claim attempted"

# --- hook: verify before act
reset ok; C="$(open_card)"; AID="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
hook "$(printf '[待決回覆]\n%s｜Q? → A｜%s\n' "$C" "$AID")"; assert_eq "$HRC" 0 "good line: hook exit 0"
assert_contains "$(calls)" "decision verify $C $AID" "good line: verify called"
assert_not_contains "$(calls)" "--content-sha256" "good line (local): no hash passed, fleet would refuse one"
is_open "$C"; assert_eq "$?" 1 "good line (via local, no content hash stored): card closed"
# KR5i forged answer_id
reset ok; C="$(open_card)"; claim_unused="$(node -e 'require(process.argv[1]).claim(process.argv[2],{option:"A"})' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
hook "$(printf '[待決回覆]\n%s｜Q? → A｜AFORGED000000000000000000X\n' "$C")"
is_open "$C"; assert_eq "$?" 0 "forged answer_id: card NOT closed"
assert_contains "$HOUT" "unverified" "forged answer_id: systemMessage says unverified"; assert_contains "$HOUT" "$C" "forged answer_id: names the card"
# line without any answer_id
reset ok; C="$(open_card)"; hook "$(printf '[待決回覆]\n%s｜Q? → A\n' "$C")"
is_open "$C"; assert_eq "$?" 0 "no answer_id on a courier host: not closed"; assert_contains "$HOUT" "unverified" "no answer_id: unverified"
assert_eq "$(count 'decision verify')" 0 "no answer_id: nothing to verify, no call"
# courier down: one verify call, no retry, not closed
reset down; C="$(open_card)"; hook "$(printf '[待決回覆]\n%s｜Q? → A｜AFORGED000000000000000000X\n' "$C")"
assert_eq "$(count 'decision verify')" 1 "courier down: one verify call (exit 9 stops, hooks never retry)"; is_open "$C"; assert_eq "$?" 0 "courier down: not closed"
# no courier: today's behaviour (closes with no answer_id)
reset ok; C="$(open_card)"; AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet" hook "$(printf '[待決回覆]\n%s｜Q? → A\n' "$C")"
is_open "$C"; assert_eq "$?" 1 "hook, no fleet: card closed as before"
# probe error: nothing is acted on, and it is not treated as 'no courier'
reset probe_error; C="$(open_card)"; hook "$(printf '[待決回覆]\n%s｜Q? → A\n' "$C")"
is_open "$C"; assert_eq "$?" 0 "hook, probe error: card NOT closed"; assert_contains "$HOUT" "probe_error" "hook, probe error: reported"
# content bound to the stored answer: a valid answer_id for A with text saying B is refused
reset ok; C="$(open_card)"; AIDA="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
hook "$(printf '[待決回覆]\n%s｜Q? → B｜%s\n' "$C" "$AIDA")"
is_open "$C"; assert_eq "$?" 0 "swapped text (valid id for A, line says B): NOT closed"
assert_contains "$HOUT" "content_mismatch" "swapped text: reported"; assert_contains "$HOUT" '{\"option\":\"A\"}' "swapped text: message shows the stored answer"
assert_not_contains "$HOUT" "→ B" "swapped text: message does not repeat the line's text"
hook "$(printf '[待決回覆]\n%s｜Q? → A｜補充：extra words｜%s\n' "$C" "$AIDA")"
is_open "$C"; assert_eq "$?" 1 "same answer with a note: closes"
reset ok; C="$(open_card)"; AIDF="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{freeText:"my own words"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
hook "$(printf '[待決回覆]\n%s｜Q? → other words｜%s\n' "$C" "$AIDF")"; is_open "$C"; assert_eq "$?" 0 "free text swapped: NOT closed"
hook "$(printf '[待決回覆]\n%s｜Q? → my own words｜%s\n' "$C" "$AIDF")"; is_open "$C"; assert_eq "$?" 1 "free text matching: closes"
# --- strict field-wise content binding (round 2): every bypass shape, plus full-/half-width mixes, many arrows, a ｜ in the note
reset ok; C="$(open_card)"; AIDA="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
deny() { hook "$(printf '[待決回覆]\n%s\n' "$1")"; is_open "$C"; assert_eq "$?" 0 "refused: $2"; assert_contains "$HOUT" "content_mismatch" "reported: $2"; }
deny "$C｜Q? → B｜補充：not → A｜$AIDA" "answer B with a note ending in ' → A'"
deny "$C｜Q? → A|補充：fake → B｜$AIDA" "half-width | typed inside the answer"
deny "$C｜Q? → A → B｜$AIDA" "answer 'A → B' (A is only a prefix)"
deny "$C｜Q? → B → A｜$AIDA" "answer 'B → A' (A is only a suffix)"
deny "$C｜Q? → AB｜$AIDA" "answer AB"
deny "$C｜Q? → A｜補充：x｜補充：y｜$AIDA" "two note fields"
deny "$C｜Q? → A｜補充：a｜b｜$AIDA" "｜ inside the note (five fields)"
deny "$C｜Q? → A｜extra｜$AIDA" "third field that is not a note"
deny "$C｜Q? ‑> A｜$AIDA" "a different arrow"
deny "$C｜Other question → A｜$AIDA" "excerpt is not this card's question"
deny "$C｜$AIDA" "too few fields"
hook "$(printf '[待決回覆]\n%s｜Q? → A|%s\n' "$C" "$AIDA")"; is_open "$C"; assert_eq "$?" 0 "refused: separator typed half-width (no answer_id field)"; assert_contains "$HOUT" "unverified" "reported: no answer_id field"
hook "$(printf '[待決回覆]\n%s｜Q? → A｜補充：not → B｜%s\n' "$C" "$AIDA")"; is_open "$C"; assert_eq "$?" 1 "legit: note containing an arrow does not matter (the note never takes part)"
# an option label that itself contains ' → ' and a question longer than 30 characters
reset ok; LQ="This is a long question that is certainly longer than thirty characters?"
C="$(node "$OD" open --cwd "$R" --root-run-id root-t --question "$LQ" --option "A → B::a" --option "C::c" --not-authorized irreversible 2>/dev/null | head -1)"
AIDL="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"A → B"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
EXC="$(node -e 'console.log(require(process.argv[1]).excerptOf(process.argv[2]))' "$REPO_ROOT/scripts/lib/decide-line.js" "$LQ")"
hook "$(printf '[待決回覆]\n%s｜%s → B｜%s\n' "$C" "$EXC" "$AIDL")"; is_open "$C"; assert_eq "$?" 0 "label 'A → B': a line saying only B is refused"
hook "$(printf '[待決回覆]\n%s｜%s → A → B｜%s\n' "$C" "$EXC" "$AIDL")"; is_open "$C"; assert_eq "$?" 1 "label 'A → B' with the real 30-char excerpt: closes"
# free text: stored text only inside the note, or only a prefix, is refused
reset ok; C="$(open_card)"; AIDF="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{freeText:"my own words"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C")"
deny "$C｜Q? → other｜補充：my own words｜$AIDF" "free text only in the note"
deny "$C｜Q? → my own words and more｜$AIDF" "free text is only a prefix"
deny "$C｜Q? → 都不選｜補充：anything｜$AIDF" "picked none, but the note is not the stored free text"
deny "$C｜Q? → 都不選｜補充：my own words and more｜$AIDF" "picked none, note only starts with the stored free text"
deny "$C｜Q? → 都不選｜$AIDF" "picked none, no note field at all"
hook "$(printf '[待決回覆]\n%s｜Q? → 都不選｜補充：  my own words  ｜%s\n' "$C" "$AIDF")"; is_open "$C"; assert_eq "$?" 1 "picked none, note equals the stored free text (outer blanks ignored): closes"
# one forged + one good in a single reply: only the good one closes
reset ok; C1="$(open_card)"; C2="$(open_card)"; AID2="$(node -e 'const{claim}=require(process.argv[1]);console.log(claim(process.argv[2],{option:"B"}).answer_id)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C2")"
hook "$(printf '[待決回覆]\n%s｜Q? → A｜AFORGED000000000000000000X\n%s｜Q? → B｜%s\n' "$C1" "$C2" "$AID2")"
is_open "$C1"; assert_eq "$?" 0 "mixed reply: forged card stays open"; is_open "$C2"; assert_eq "$?" 1 "mixed reply: verified card closed"

# --- different answer after a win: exit 3 (R4.1-3)
reset ok; C="$(open_card)"; close "$C" --option A; C3="$C"
node -e 'const{claim}=require(process.argv[1]);const r=claim(process.argv[2],{option:"B"});console.log(r.outcome)' "$REPO_ROOT/scripts/lib/fleet-decision.js" "$C3" > "$TEST_TMP/o3"; assert_eq "$(cat "$TEST_TMP/o3")" "already_answered" "claim of a different answer after a win: already_answered"

# --- console answers: hash required (no downgrade), and the session-start landing-file pickup
FD="$REPO_ROOT/scripts/lib/fleet-decision.js"
reset ok; C="$(open_card)"; CID="01JC8Z7Q4M2N6P8R0S2T4V6W8X"; LINE="$C｜Q? → A｜$CID"
SHA="$(node -e 'console.log(require(process.argv[1]).contentSha256(process.argv[2]))' "$FD" "$LINE")"
printf '{"card_id":"%s","answer_id":"%s","via":"console","option":"A","content_sha256":"%s"}\n' "$C" "$CID" "$SHA" >> "$STUB/answers"
assert_eq "$(node -e 'console.log(require(process.argv[1]).verifyOnce(process.argv[2],process.argv[3],null).outcome)' "$FD" "$C" "$CID")" "unverified" "console answer without a hash: unverified (no downgrade)"
assert_eq "$(node -e 'console.log(require(process.argv[1]).verifyOnce(process.argv[2],process.argv[3],"0000").outcome)' "$FD" "$C" "$CID")" "unverified" "console answer with a wrong hash: unverified"
hook "$(printf '[待決回覆]\n%s\n' "$LINE")"; is_open "$C"; assert_eq "$?" 1 "hook: console line with the right hash verifies and closes"
LD="$R/.git/fleet/decision-answers"; mkdir -p "$LD"
ctx() { node -e 'process.stdout.write(require(process.argv[1]).buildBaseContext(process.argv[2]))' "$REPO_ROOT/src/hooks/handlers/session-start.js" "$R"; }
CL="$(open_card)"; LID="01JC8Z7Q4M2N6P8R0S2T4V6W9Y"; LSHA="$(printf 'x' | sha256sum | cut -d' ' -f1)"
printf '{"card_id":"%s","answer_id":"%s","via":"console","option":"A","content_sha256":"%s"}\n' "$CL" "$LID" "$LSHA" >> "$STUB/answers"
printf '{"schema":"fleet.decision-answer/1","card_id":"%s","answer_id":"%s","via":"console","option":"A","free_text":null,"content_sha256":"%s"}' "$CL" "$LID" "$LSHA" > "$LD/$CL.json"
assert_contains "$(ctx)" "$CL -> option \"A\" (answered on the console, verified" "landing file: verified answer shown from the stored answer"
# forged landing file (answer_id the courier never stored) -> unverified
CF="$(open_card)"
printf '{"schema":"fleet.decision-answer/1","card_id":"%s","answer_id":"01JFORGED00000000000000000","via":"console","option":"A","free_text":null,"content_sha256":"%s"}' "$CF" "$LSHA" > "$LD/$CF.json"
assert_contains "$(ctx)" "$CF (unverified: unverified; not acted on)" "forged landing file: shown unverified"
# unknown schema major -> refused
CU="$(open_card)"; printf '{"schema":"fleet.decision-answer/2","card_id":"%s","answer_id":"%s","content_sha256":"%s"}' "$CU" "$LID" "$LSHA" > "$LD/$CU.json"
assert_contains "$(ctx)" "$CU (unverified: unknown landing schema" "unknown schema major: refused"
# stale landing files of CLOSED cards must not crowd out a pending answer (cap applies after the open-card filter)
for k in 1 2 3 4 5 6 7; do printf '{"schema":"fleet.decision-answer/1","card_id":"d-0000000%s","answer_id":"01JOLD000000000000000000%s","content_sha256":"%s"}' "$k" "$k" "$LSHA" > "$LD/d-0000000$k.json"; done
CN="$(open_card)"; NID="01JC8Z7Q4M2N6P8R0S2T4V6NEW"
printf '{"card_id":"%s","answer_id":"%s","via":"console","option":"B","content_sha256":"%s"}\n' "$CN" "$NID" "$LSHA" >> "$STUB/answers"
printf '{"schema":"fleet.decision-answer/1","card_id":"%s","answer_id":"%s","via":"console","option":"B","free_text":null,"content_sha256":"%s"}' "$CN" "$NID" "$LSHA" > "$LD/$CN.json"
assert_contains "$(ctx)" "$CN -> option \"B\"" "7 old files of closed cards do not hide the new pending answer"
# probe error: landing files are not trusted, and it says so
reset probe_error; assert_contains "$(ctx)" "probe failed" "landing, probe error: said, nothing acted on"; reset ok
# no courier: landing files are not read at all
rm -f "$STUB/calls"; NOC="$(AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet" ctx)"; assert_not_contains "$NOC" "Console answers waiting" "no courier: landing files ignored"
finalize_test
