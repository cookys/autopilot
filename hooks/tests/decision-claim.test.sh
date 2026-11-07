#!/usr/bin/env bash
# Panel claim (F4 panel side, PM go 2026-11-07): scripts/decision-claim.js against a STUB `fleet` (same stub as decision-verify.test.sh), and the round trip
# pane line -> scripts/lib/decide-line.js -> hooks/advisory-relay.js. The pane's own line is built by the REAL mods/live/model.ts decideLine / decideclaim.ts claimReply
# (loaded by node's type stripping plus a tiny loader that resolves extensionless imports to .ts), with the claim step running the real decision-claim.js.
# Negative controls (each shown red, then green): (1) a decision-claim.js that never claims / reports ok on failure -> the "mutant is caught" counts are > 0;
# (2) a line whose answer_id is forged is NOT closed by the hook; (3) a pane line built WITHOUT the claimed id is not closed (no id = no auto close).
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_CLAIM_RETRY_MS=0
OD="$REPO_ROOT/scripts/open-decision.js"; HOOK="$REPO_ROOT/hooks/advisory-relay.js"; CLAIM="$REPO_ROOT/scripts/decision-claim.js"
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
reset() { rm -f "$STUB/calls" "$STUB/answers"; printf '%s' "${1:-ok}" > "$STUB/mode"; }
Q="Should the panel claim before it sends?"
open_card() { node "$OD" open --cwd "$R" --root-run-id root-t --question "$Q" --option "Alpha::a" --option "Beta::b" --not-authorized irreversible 2>/dev/null | head -1; }
is_open() { node "$OD" show --cwd "$R" 2>/dev/null | grep -q "$1"; }
hook() { HOUT="$(node -e 'process.stdout.write(JSON.stringify({session_id:"vf",cwd:process.argv[1],prompt:process.argv[2]}))' "$R" "$1" | node "$HOOK" 2>"$TEST_TMP/herr")"; HRC=$?; }
jf() { node -e 'const j=JSON.parse(process.argv[1]);const v=j[process.argv[2]];console.log(v===null?"null":v)' "$1" "$2"; }

# --- (a) decision-claim.js. check_script <script> prints how many expectations FAIL (0 = all hold); the real script must give 0, a mutant must give > 0.
check_script() {
  local S="$1" bad=0 o C
  exp() { [ "$2" = "$3" ] || { bad=$((bad+1)); [ -z "${DBG:-}" ] || echo "exp fail: [$2] != [$3]" >&2; }; }
  reset ok; C="$(open_card)"
  o="$(node "$S" "$C" --option Alpha)"; exp x "$(jf "$o" ok)" true; exp x "$(jf "$o" reason)" null
  case "$(jf "$o" answer_id)" in A[0-9A-F]*) ;; *) bad=$((bad+1)) ;; esac
  grep -q "decision claim $C --option Alpha" "$STUB/calls" || bad=$((bad+1))
  o="$(node "$S" "$C" --free-text 'my own words')"; exp x "$(jf "$o" ok)" false; exp x "$(jf "$o" reason)" "already answered" # a different answer lost the card above
  reset ok; C="$(open_card)"; o="$(node "$S" "$C" --free-text 'my own words')"; exp x "$(jf "$o" ok)" true
  grep -q "decision claim $C --free-text my own words" "$STUB/calls" || bad=$((bad+1))
  for m in "down:courier unreachable" "unknown:unknown card" "closed:card closed" "console:already answered" "probe_error:courier probe failed"; do
    reset "${m%%:*}"; o="$(node "$S" "$C" --option Alpha)"; exp x "$(jf "$o" ok)" false; exp x "$(jf "$o" answer_id)" null; exp x "$(jf "$o" reason)" "${m#*:}"
  done
  reset ok; o="$(AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet" node "$S" "$C" --option Alpha)"; exp x "$(jf "$o" ok)" true; exp x "$(jf "$o" answer_id)" null
  reset ok; o="$(NO_DECISION=1 node "$S" "$C" --option Alpha)"; exp x "$(jf "$o" ok)" true; exp x "$(jf "$o" answer_id)" null
  [ -z "$(grep 'decision claim' "$STUB/calls")" ] || bad=$((bad+1))   # no courier that speaks decision: nothing claimed
  node "$S" "$C" >/dev/null 2>&1; [ $? -eq 2 ] || bad=$((bad+1))
  node "$S" "$C" --option >/dev/null 2>&1; [ $? -eq 2 ] || bad=$((bad+1))
  node "$S" "$C" --bogus x >/dev/null 2>&1; [ $? -eq 2 ] || bad=$((bad+1))
  echo "$bad"
}
assert_eq "$(check_script "$CLAIM")" 0 "(a) decision-claim.js: claimed / free text / every failure / no courier / bad argv all hold"
# negative controls: mutants of the script must be caught
# the copies sit outside scripts/, so first point the require() at the real lib; every mutant starts from that copy
sed_mutant "$CLAIM" "$TEST_TMP/claim-abs.js" "s#'./lib/fleet-decision'#'$REPO_ROOT/scripts/lib/fleet-decision'#" || fail "claim-abs copy"
sed_mutant "$TEST_TMP/claim-abs.js" "$TEST_TMP/mut-ok.js" 's/ok: false, answer_id: null, reason }/ok: true, answer_id: null, reason }/' || fail "mut-ok did not apply"
sed_mutant "$TEST_TMP/claim-abs.js" "$TEST_TMP/mut-noclaim.js" "s/const r = fd.claim(card, flag === '--option' ? { option: value } : { freeText: value });/const r = { outcome: 'claimed', answer_id: 'A0000000000000000000000000' };/" || fail "mut-noclaim did not apply"
M1="$(check_script "$TEST_TMP/mut-ok.js")"; M2="$(check_script "$TEST_TMP/mut-noclaim.js")"
[ "$M1" -gt 0 ]; assert_eq "$?" 0 "(a) control: a script that reports ok on a failed claim is caught ($M1 expectations red)"
[ "$M2" -gt 0 ]; assert_eq "$?" 0 "(a) control: a script that never claims (invented id) is caught ($M2 expectations red)"

# --- (b) round trip. The pane side runs in node with the real model.ts / decideclaim.ts; its claim step runs the script given in $PANE_CLAIM.
LDR="$TEST_TMP/ldr.mjs"
cat > "$LDR" <<'E1'
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(`
import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('.') && !/[.][a-z]+$/.test(spec) && ctx.parentURL) {
    const base = new URL(spec, ctx.parentURL);
    if (fs.existsSync(fileURLToPath(base) + '.ts')) return next(base.href + '.ts', ctx);
  }
  return next(spec, ctx);
}`), import.meta.url)
E1
PANE="$TEST_TMP/pane.mjs"
cat > "$PANE" <<'E2'
import { spawnSync } from 'node:child_process'
const [, , root, id, question, pick, note] = process.argv
const { NO_DECIDE } = await import(root + '/mods/live/model.ts')
const { claimReply } = await import(root + '/mods/live/decideclaim.ts')
const d = { id, question, background: null, options: [{ label: 'Alpha', description: '' }, { label: 'Beta', description: '' }], recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 1, orphaned: false, origin: null }
const st = { ...NO_DECIDE, picks: pick === '' ? {} : { [id]: Number(pick) }, notes: note === '' ? {} : { [id]: note } }
const claimCard = async (card, answer) => {
  const args = [process.env.PANE_CLAIM, card.id, ...('option' in answer ? ['--option', answer.option] : ['--free-text', answer.freeText])]
  return JSON.parse(spawnSync('node', args, { encoding: 'utf8' }).stdout)
}
const r = await claimReply([d], st, claimCard)
process.stdout.write(JSON.stringify({ text: r.reply === null ? null : r.reply.text, failed: r.failed }) + '\n')
E2
pane() { PANE_CLAIM="${PANE_CLAIM:-$CLAIM}" node --import "$LDR" "$PANE" "$REPO_ROOT" "$@"; }
verify_json() { node "$REPO_ROOT/scripts/open-decision.js" verify --cwd "$R" --id "$1" --answer-id "$2" 2>/dev/null; }

reset ok; C="$(open_card)"
P="$(pane "$C" "$Q" 0 '')"; LINE="$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.text.split("\n")[1])' "$P")"
HEAD1="$(node -e 'console.log(JSON.parse(process.argv[1]).text.split("\n")[0])' "$P")"; assert_eq "$HEAD1" "[待決回覆]" "(b) the pane reply starts with the head line"
RES="$(node -e '
const { parseDecideLine, lineSaysAnswer } = require(process.argv[1]);
const line = process.argv[2], question = process.argv[3], aid = process.argv[4];
const p = parseDecideLine(line);
const ok = lineSaysAnswer(line, { option: "Alpha", free_text: null }, question);
console.log(JSON.stringify({ parsed: p !== null, same_id: p !== null && p.answerId === aid, says: ok.ok }));
' "$REPO_ROOT/scripts/lib/decide-line.js" "$LINE" "$Q" "$(node "$CLAIM" "$C" --option Alpha | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).answer_id))')")"
assert_contains "$RES" '"parsed":true' "(b) parseDecideLine accepts the pane line"
assert_contains "$RES" '"same_id":true' "(b) the line's last field is the answer_id claim returned (idempotent re-claim gives the same id)"
assert_contains "$RES" '"says":true' "(b) lineSaysAnswer: the line says the stored answer"
hook "$(printf '[待決回覆]\n%s\n' "$LINE")"; is_open "$C"; assert_eq "$?" 1 "(b) the hook verifies the pane line and closes the card"
# free text typed on an option card, nothing picked: 都不選｜補充：<text>
reset ok; C="$(open_card)"; P="$(pane "$C" "$Q" '' 'my own words')"; LINE="$(node -e 'console.log(JSON.parse(process.argv[1]).text.split("\n")[1])' "$P")"
hook "$(printf '[待決回覆]\n%s\n' "$LINE")"; is_open "$C"; assert_eq "$?" 1 "(b) free text via the pane: line closes the card"
# control: a forged answer_id on the same line does not close
reset ok; C="$(open_card)"; P="$(pane "$C" "$Q" 0 '')"; LINE="$(node -e 'console.log(JSON.parse(process.argv[1]).text.split("\n")[1])' "$P")"
FORGED="$(printf '%s' "$LINE" | sed 's/｜[^｜]*$/｜AFORGED000000000000000000X/')"
hook "$(printf '[待決回覆]\n%s\n' "$FORGED")"; is_open "$C"; assert_eq "$?" 0 "(b) control: a forged answer_id does not close the card"
assert_contains "$HOUT" "unverified" "(b) control: reported unverified"
# control: a courier-less host (no id): the pane sends the line, the hook does not close
reset ok; C="$(open_card)"; P="$(AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet" pane "$C" "$Q" 0 '')"; LINE="$(node -e 'console.log(JSON.parse(process.argv[1]).text.split("\n")[1])' "$P")"
assert_not_contains "$LINE" "｜A" "(b) control: no courier, no answer_id appended"
hook "$(printf '[待決回覆]\n%s\n' "$LINE")"; is_open "$C"; assert_eq "$?" 0 "(b) control: a line without an id leaves the card open"
# claim fails: the card is not in the reply at all
reset closed; C="$(open_card)"; P="$(pane "$C" "$Q" 0 '')"
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).text)' "$P")" "null" "(b) a failed claim sends nothing"
assert_contains "$P" "card closed" "(b) a failed claim keeps its reason"
finalize_test
