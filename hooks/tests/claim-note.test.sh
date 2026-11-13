#!/usr/bin/env bash
# A panel answer can carry an option AND a note (補充). The claim must send both (`--option L --free-text T`); an old courier that exits 2 on the
# combined form gets option only, and the note still reaches the executor's delivery text (marked local, not covered by the digest).
# Negative control: the fake courier mode `old` (exit 2 on the combined form) is the broken case for the fallback.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_CLAIM_RETRY_MS=0
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
OD="$REPO_ROOT/scripts/open-decision.js"; HOOK="$REPO_ROOT/hooks/advisory-relay.js"; CLAIM="$REPO_ROOT/scripts/decision-claim.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
NOTE='那測試是給自己看的，你處理就好了'
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
# fake fleet: records argv; mode ok = stores option and free text; mode old = exit 2 on claim with both flags; mode drop = stores option only (new CLI is not
# expected to do this, but a courier that drops the note must still not lose it); send records its text
cat > "$STUB/fleet" <<'JS'
#!/usr/bin/env node
const fs = require('fs'); const crypto = require('crypto');
const D = process.env.STUB_DIR; const a = process.argv.slice(2);
fs.appendFileSync(D + '/calls', a.join(' ') + '\n');
const mode = () => { try { return fs.readFileSync(D + '/mode', 'utf8').trim(); } catch { return 'ok'; } };
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (a[0] === '--help') { process.stdout.write('fleet — courier CLI\n\nUSAGE:\n  fleet send x\n  fleet decision claim|verify|list <card_id>\n'); process.exit(1); }
if (a[0] === 'send') { fs.appendFileSync(D + '/sent', a.slice(2).join(' ') + '\n----\n'); out({ ok: true, member: a[1], message_id: '01MSGNOTE' }); process.exit(0); }
const [, sub, card] = a;
const rows = () => (fs.existsSync(D + '/answers') ? fs.readFileSync(D + '/answers', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const shape = (r, outcome) => ({ outcome, card_id: r.card_id, answer_id: r.answer_id, via: 'local', option: r.option || null, free_text: r.free_text || null, card_revision: 1, answered_at: '2026-11-03T09:12:44Z', operator: null });
if (sub === 'claim') {
  const i = a.indexOf('--option'); const j = a.indexOf('--free-text');
  if (mode() === 'old' && i >= 0 && j >= 0) { process.stderr.write('Invalid usage\n'); process.exit(2); }
  const r = { card_id: card, answer_id: 'A' + crypto.createHash('sha256').update(card + a.join('|')).digest('hex').slice(0, 25).toUpperCase(), option: i >= 0 ? a[i + 1] : null, free_text: j >= 0 && mode() !== 'drop' ? a[j + 1] : null };
  fs.appendFileSync(D + '/answers', JSON.stringify(r) + '\n'); out(shape(r, 'claimed')); process.exit(0);
}
if (sub === 'verify') {
  const r = rows().find((x) => x.card_id === card && x.answer_id === a[3]);
  if (!r || a.indexOf('--content-sha256') >= 0) process.exit(7);
  out(shape(r, 'verified')); process.exit(0);
}
process.exit(1);
JS
chmod +x "$STUB/fleet"
export STUB_DIR="$STUB" AUTOPILOT_FLEET_BIN="$STUB/fleet"
reset() { rm -f "$STUB/calls" "$STUB/answers" "$STUB/sent"; printf '%s' "$1" > "$STUB/mode"; }
claimjs() { node -e 'const fd=require(process.argv[1]+"/scripts/lib/fleet-decision.js");process.stdout.write(JSON.stringify(fd.claim("d-00000001",{option:"Alpha",freeText:process.argv[2]}))+"\n")' "$REPO_ROOT" "$NOTE"; }

# (a) option + note -> one claim carrying both flags (lib and the decision-claim.js wrapper)
reset ok; claimjs >/dev/null
assert_contains "$(cat "$STUB/calls")" "decision claim d-00000001 --option Alpha --free-text $NOTE" "(a) lib claim sends --option and --free-text together"
reset ok; node "$CLAIM" d-00000001 --option Alpha --free-text "$NOTE" >/dev/null
assert_contains "$(cat "$STUB/calls")" "decision claim d-00000001 --option Alpha --free-text $NOTE" "(a) decision-claim.js passes both flags through"

# (b) old courier: exit 2 on the combined form -> retry once with option only, flag the dropped note
reset old; J="$(claimjs)"
assert_eq "$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.outcome,j.note_dropped_by_courier,j.note)' "$J")" "claimed true $NOTE" "(b) fallback returns claimed + note_dropped_by_courier + the note"
assert_eq "$(grep -c 'decision claim' "$STUB/calls")" 2 "(b) exactly one retry"
assert_eq "$(grep 'decision claim' "$STUB/calls" | tail -1)" "decision claim d-00000001 --option Alpha" "(b) the retry is option only"
reset ok; J="$(claimjs)"
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).note_dropped_by_courier===true)' "$J")" false "(b) control: a courier that takes both flags is not flagged"

# (c) end to end: pane line -> hook -> parkAnswer -> deliveryText; the delivered text carries the exact note, also when the courier dropped it
for M in old drop ok; do
  reset $M
  C="$(node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --question "Should the panel keep the note?" --option "Alpha::a" --option "Beta::b" --not-authorized irreversible 2>/dev/null | head -1)"
  CO="$(node "$CLAIM" "$C" --option Alpha --free-text "$NOTE")"
  AID="$(node -e 'console.log(JSON.parse(process.argv[1]).answer_id)' "$CO")"
  LINE="$(node -e 'const {excerptOf,wire}=require(process.argv[1]+"/scripts/lib/decide-line.js");console.log(process.argv[2]+"｜"+wire(excerptOf("Should the panel keep the note?"))+" → Alpha｜補充："+process.argv[3]+"｜"+process.argv[4])' "$REPO_ROOT" "$C" "$NOTE" "$AID")"
  node -e 'process.stdout.write(JSON.stringify({session_id:"vf",cwd:process.argv[1],prompt:"[待決回覆]\n"+process.argv[2]}))' "$R" "$LINE" | node "$HOOK" >/dev/null 2>&1
  SENT="$(cat "$STUB/sent" 2>/dev/null)"
  assert_contains "$SENT" "$NOTE" "(c) mode $M: the delivered text contains the exact note"
  case $M in old|drop) assert_contains "$SENT" "free_text_source: local" "(c) mode $M: marked as a local note"; assert_contains "$SENT" "digest" "(c) mode $M: says the digest does not cover it";;
    ok) assert_not_contains "$SENT" "free_text_source: local" "(c) mode ok: the courier's own free text is used as is";; esac
done
finalize_test
