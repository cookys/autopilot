#!/usr/bin/env bash
# 待決 pane: an option press only SELECTS, send opens a DECIDE_UNDO_MS undo window, the send runs when it ends (no claim anywhere on the path), and a sent card can be corrected (operator, 2026-11-08).
# The pane side is the REAL mods/live/decideundo.ts / model.ts / tabs.ts, loaded by node's type stripping plus a loader that resolves extensionless imports to .ts; the clock is a fake
# the test moves by hand (nothing waits 10 s). Both surfaces that draw note fields (terminal, desktop) are rendered through decidebatch.inputsFor.
# The receiving side is the REAL hooks/advisory-relay.js with a seeded decision store.
# Negative controls (each shown red, then green): (a) an option press that also marks the card sent, (b) an undo that leaves the card in its window, (c) a window of 0 ms and a tick that
# leaves the card in `hold`, (d) a correction head that scripts/lib/decide-line.js cannot read, and a correction recorder that also closes the card, (f) a send that waits for the prompt (a prompt
# that never settles must still leave the card sent and the tick finished).
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_FLEET_BIN="$TEST_TMP/no-such-fleet"   # no courier on this host: nothing real is reached
prefer_ts_node   # real mods/live/*.ts need type stripping; a non-TS node first on PATH reds the driver

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

# The driver prints one line per FAILED expectation; no line = every expectation holds. $1 = the root whose mods/live it loads, $2 = the decide-line.js to parse corrections with.
DRV="$TEST_TMP/driver.mjs"
cat > "$DRV" <<'E2'
const [, , root, lineLib] = process.argv
const bad = []
const exp = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)) }
const M = await import(root + '/mods/live/model.ts')
const U = await import(root + '/mods/live/decideundo.ts')
const B = await import(root + '/mods/live/decidebatch.ts')
const T = await import(root + '/mods/live/tabs.ts')
const { makeT } = await import(root + '/mods/live/i18n.ts')
const { parseCorrectionLine } = (await import('node:module')).createRequire(import.meta.url)(lineLib)
const zh = makeT('zh-TW')
const card = (id, q, options) => ({ id, question: q, background: null, options, recommendation: null, why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 1, orphaned: false, origin: null })
const OPT = l => ({ label: l, description: '' })
const CARDS = [card('d-aaaaaaa1', '要不要改？', [OPT('甲'), OPT('乙')]), card('d-bbbbbbb2', '叫什麼名字？', [])]
const snapOf = pending => ({ state: 'ok', text: '', header: 'h', metrics: { ctx: '1%' }, band: { kind: 'decide', key: 'warning', why: 'r', verdictReason: null, mark: '▲', verdict: 'v', head: '', progress: '—', progressDim: false, reason: null, project: 'repo', elapsed: '1m', phase: '—', slots: [] }, pending, project_key: null, root_run_id: null, link: null, rows: [], gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: 1, counts: { confirmed_live: 0, exited: 0, unknown: 0 } }, activity: [], recent: [] })
const world = () => {
  const w = { t: 0, st: { ...M.NO_DECIDE }, posts: [] }
  w.deps = {
    now: async () => w.t, read: async () => w.st, update: async fn => { w.st = fn(w.st) }, pool: st => B.actionable(CARDS, w.batch ?? B.NO_BATCH, st),
    post: async text => { w.posts.push(text) },
  }
  return w
}
const lines = (w, surface) => T.decideTabLines(snapOf(CARDS), { t: zh, cols: 76, expanded: new Set(), folded: new Set(), decide: { ...w.st, inputs: B.inputsFor(surface), now: w.t } })
const presses = ls => ls.flatMap(l => (l.segs ?? []).flatMap(s => (s.press === undefined ? [] : [s.press])))

for (const surface of ['terminal', 'desktop']) {
  // (a) an option press only selects
  let w = world()
  w.st = U.applyPick(w.st, 'd-aaaaaaa1', 1)
  exp(surface + ' (a) the pick is stored', w.st.picks, { 'd-aaaaaaa1': 1 })
  exp(surface + ' (a) the card is not marked sent', w.st.sent, {})
  exp(surface + ' (a) nothing was sent', w.posts.length, 0)
  let ls = lines(w, surface)
  exp(surface + ' (a) the picked option shows selected', ls.some(l => l.text.includes('[x] 乙')), true)
  exp(surface + ' (a) the other option is still pressable (the pick can change)', presses(ls).includes('pick:d-aaaaaaa1:0'), true)
  exp(surface + ' (a) the card is not greyed or reduced to an answer line', ls.some(l => l.text.startsWith('  已答')), false)
  exp(surface + ' (a) the note field is still there', ls.some(l => l.field !== undefined && l.field.key === 'note:d-aaaaaaa1'), true)
  exp(surface + ' (a) send is pressable once something is chosen', presses(ls).includes('submit'), true)
  exp(surface + ' (a) the pick can be changed to the other option', U.applyPick(w.st, 'd-aaaaaaa1', 0).picks, { 'd-aaaaaaa1': 0 })
  exp(surface + ' (a) pressing the selected option again unselects it', U.applyPick(w.st, 'd-aaaaaaa1', 1).picks, {})
  w = world()
  exp(surface + ' (a) nothing chosen: send is not pressable', presses(lines(w, surface)).includes('submit'), false)
  w.st = { ...w.st, notes: { 'd-bbbbbbb2': '叫 main' } }
  exp(surface + ' (a) a free-text card with a non-empty note makes send pressable', presses(lines(w, surface)).includes('submit'), true)

  // (b) undo inside the window: no send, pick and note kept
  w = world()
  w.st = { ...U.applyPick(w.st, 'd-aaaaaaa1', 1), notes: { 'd-aaaaaaa1': '補一句' } }
  exp(surface + ' (b) send enters the window', await U.holdSend(w.deps), ['d-aaaaaaa1'])
  exp(surface + ' (b) the window ends at DECIDE_UNDO_MS', w.st.hold, { 'd-aaaaaaa1': M.DECIDE_UNDO_MS })
  w.t = 4000
  ls = lines(w, surface)
  exp(surface + ' (b) the card shows the undo button with the seconds left', ls.some(l => l.text.includes('撤回（剩 6 秒）')), true)
  exp(surface + ' (b) the card takes no option press while it waits', presses(ls).filter(p => p.startsWith('pick:d-aaaaaaa1')), [])
  exp(surface + ' (b) a pick landing in the window is refused', U.applyPick(w.st, 'd-aaaaaaa1', 0), w.st)
  await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (b) before the window ends nothing is sent', w.posts.length, 0)
  await U.undoHold(w.deps, 'd-aaaaaaa1')
  w.t = M.DECIDE_UNDO_MS + 5000
  await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (b) after undo, even past the old deadline, no send', w.posts.length, 0)
  exp(surface + ' (b) the pick is kept', w.st.picks, { 'd-aaaaaaa1': 1 })
  exp(surface + ' (b) the note is kept', w.st.notes, { 'd-aaaaaaa1': '補一句' })
  exp(surface + ' (b) the card is editable again and was never marked sent', [w.st.hold, w.st.sent], [{}, {}])
  exp(surface + ' (b) the card is open again: its option is pressable', presses(lines(w, surface)).includes('pick:d-aaaaaaa1:0'), true)

  // (c) the window ends: exactly one send
  w = world()
  w.st = U.applyPick(w.st, 'd-aaaaaaa1', 0)
  await U.holdSend(w.deps)
  w.t = M.DECIDE_UNDO_MS - 1
  let r = await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (c) one ms before the end: nothing sent', [w.posts.length, r.idle], [0, false])
  w.t = M.DECIDE_UNDO_MS
  r = await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (c) at the end: one send, the [待決回覆] line', w.posts.length === 1 && w.posts[0].startsWith('[待決回覆]\nd-aaaaaaa1｜要不要改？ → 甲'), true)
  exp(surface + ' (c) the window is closed and the timer may stop', [w.st.hold, r.idle], [{}, true])
  exp(surface + ' (c) the card is marked sent', typeof w.st.sent['d-aaaaaaa1'], 'number')
  w.t = M.DECIDE_UNDO_MS + 3000
  await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (c) later ticks send nothing more', w.posts.length, 1)

  // (e) 改答案: a sent card is editable again, its next send is ONE correction line, and goes through the same window
  await U.reopen(w.deps, 'd-aaaaaaa1')
  w.st = U.applyPick(w.st, 'd-aaaaaaa1', 1)
  exp(surface + ' (e) the reopened card takes a new pick', w.st.picks, { 'd-aaaaaaa1': 1 })
  exp(surface + ' (e) reopened: the 改答案 card is open again', presses(lines(w, surface)).includes('pick:d-aaaaaaa1:0'), true)
  await U.holdSend(w.deps)
  w.t += 5000
  await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (e) the correction waits out the window too', w.posts.length, 1)
  w.t += M.DECIDE_UNDO_MS
  await U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids))
  exp(surface + ' (e) the correction goes out once, as its own line', w.posts.slice(1), ['[待決回覆·更正] d-aaaaaaa1 → 乙'])
  exp(surface + ' (e) the card is no longer being corrected', w.st.fixing, {})

  // (f) the send never waits on the prompt: a post that never settles must not hold the tick, and the card is marked sent
  w = world()
  w.deps.post = () => new Promise(() => {})
  w.st = U.applyPick(w.st, 'd-aaaaaaa1', 0)
  await U.holdSend(w.deps)
  w.t = M.DECIDE_UNDO_MS
  const fin = await Promise.race([U.tickHold(w.deps, ids => U.sendNow({ ...w.deps }, ids)).then(() => 'finished'), new Promise(res => setTimeout(() => res('blocked'), 300))])
  exp(surface + ' (f) a prompt that never settles does not hold the tick', fin, 'finished')
  exp(surface + ' (f) the card is sent and out of the window', [typeof w.st.sent['d-aaaaaaa1'], w.st.hold], ['number', {}])
}

// (d) the correction line: producer and parser agree, and the parser is strict
const w2 = world()
w2.st = { ...U.applyPick(w2.st, 'd-aaaaaaa1', 1), notes: { 'd-aaaaaaa1': '補一句｜含分隔' } }
const line = M.decideCorrectionLine(CARDS[0], w2.st)
exp('(d) the line format', line, '[待決回覆·更正] d-aaaaaaa1 → 乙｜補充：補一句|含分隔')
exp('(d) the parser reads it back', parseCorrectionLine(line), { id: 'd-aaaaaaa1', answer: '乙', note: '補一句|含分隔' })
exp('(d) the head is the exported constant', line.startsWith(M.DECIDE_FIX_HEAD + ' '), true)
exp('(d) a free-text card: the typed text is the answer', parseCorrectionLine(M.decideCorrectionLine(CARDS[1], { ...M.NO_DECIDE, notes: { 'd-bbbbbbb2': '叫 main' } })), { id: 'd-bbbbbbb2', answer: '叫 main', note: null })
exp('(d) an unanswered card has no correction line', M.decideCorrectionLine(CARDS[0], M.NO_DECIDE), null)
for (const [name, text] of [['two lines', line + '\n另一行'], ['no id', '[待決回覆·更正] 乙'], ['bad id', '[待決回覆·更正] x-1 → 乙'], ['plain head', '[待決回覆] d-aaaaaaa1 → 乙'], ['extra field', line + '｜x'], ['empty answer', '[待決回覆·更正] d-aaaaaaa1 → ']]) exp('(d) parser refuses: ' + name, parseCorrectionLine(text), null)
console.log(bad.join('\n'))
E2

driver() { node --import "$LDR" "$DRV" "$1" "$2" 2>&1; }
bad_count() { local o; o="$(driver "$1" "$2")"; if [ -z "$o" ]; then echo 0; else [ -z "${DBG:-}" ] || echo "$o" >&2; printf '%s\n' "$o" | grep -c .; fi; }

LINELIB="$REPO_ROOT/scripts/lib/decide-line.js"
assert_eq "$(bad_count "$REPO_ROOT" "$LINELIB")" 0 "(a)(b)(c)(d)(e) the real pane code, both surfaces: every expectation holds"

# --- mutants of the pane side: copy mods/live once per mutant (the loader resolves './x' inside the copy), apply ONE sed command, expect the driver to go red
mutant_root() { # <name>: a fresh copy of mods/live under $TEST_TMP/mut-<name>
  local d="$TEST_TMP/mut-$1"; mkdir -p "$d/mods"; cp -r "$REPO_ROOT/mods/live" "$d/mods/live"; printf '%s' "$d"
}
red() { # <label> <file under mods/live> <sed command>
  local d f="$2" c; d="$(mutant_root "$1")"
  sed_mutant "$REPO_ROOT/mods/live/$f" "$d/mods/live/$f" "$3" || { fail "mutant $1 did not apply"; return; }
  c="$(bad_count "$d" "$LINELIB")"
  echo "  mutant $1: $c expectations red" >&2
  [ "$c" -gt 0 ]; assert_eq "$?" 0 "control $1: caught ($c expectations red)"
}
red a-press-marks-sent decideundo.ts 's/  return { ...s, picks }/  return { ...s, picks, sent: { ...s.sent, [id]: 1 } }/'
red b-undo-keeps-window decideundo.ts 's/{ ...s, hold: dropIds(s.hold, \[id\]) }/s/'
red c-window-zero decideundo.ts 's/const until = (await d.now()) + DECIDE_UNDO_MS/const until = (await d.now()) + 0/'
red c-hold-not-dropped decideundo.ts 's/await d.update(s => ({ ...s, hold: dropIds(s.hold, due) }))/await d.update(s => s)/'
red f-send-awaits-prompt decideundo.ts 's/      void d.post(reply.text).catch(async () => {/      await d.post(reply.text).catch(async () => {/'
red d-head-changed model.ts 's/\[待決回覆\\u00b7更正\]/[待決回覆-更正]/'
red d-pick-not-needed-for-send tabs.ts "s/const answered = open.filter(d => !decideHeld(d, dv) \&\& decideLine(d, dv) !== null).length/const answered = 1/"

# --- (d) the receiving hook: the REAL advisory-relay.js on a seeded decision store
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
open_card() { node "$OD" open --executor ns/cc/exec--claude --cwd "$R" --root-run-id root-t --question "要不要改？" --option "甲::a" --option "乙::b" --not-authorized irreversible 2>/dev/null | head -1; }
card_json() { node "$OD" show --cwd "$R" --id "$1" --json 2>/dev/null; }
hook_with() { # <hook dir> <prompt>: sets HOUT
  HOUT="$(node -e 'process.stdout.write(JSON.stringify({session_id:"fx",cwd:process.argv[1],prompt:process.argv[2]}))' "$R" "$2" | node "$1/advisory-relay.js" 2>"$TEST_TMP/herr")"
}
field() { node -e 'const j=JSON.parse(process.argv[1]);const e=j.decisions[0];const v=e&&e[process.argv[2]];console.log(v===undefined?"undefined":JSON.stringify(v))' "$1" "$2"; }

check_hook() { # <repo root of the hook + scripts> -> number of failed expectations
  local H="$1" bad=0 C J OUT
  exp() { [ "$2" = "$3" ] || { bad=$((bad+1)); [ -z "${DBG:-}" ] || echo "hook exp fail: [$2] != [$3]" >&2; }; }
  C="$(open_card)"
  hook_with "$H/hooks" "$(printf '[待決回覆]\n%s｜要不要改？ → 甲\n' "$C")"      # first answer: no courier on this host => no id => the card parks in pending_dispatch
  node "$OD" close --cwd "$R" --id "$C" --dispatched t-1 >/dev/null 2>&1          # the session records the dispatched task, which closes the pending_dispatch card (normal flow after a verified first answer)
  J="$(node "$OD" show --cwd "$R" --id "$C" --json 2>/dev/null)"; exp x "$(field "$J" status)" '"closed"'
  hook_with "$H/hooks" "$(printf '[待決回覆·更正] %s → 乙｜補充：改成乙' "$C")"
  exp x "$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.systemMessage)' "$HOUT" 2>/dev/null)" "更正：$C 新答案 乙（補充：改成乙）；已在執行的 lane 需停下或改做。未經 courier 核實。"
  J="$(node "$OD" show --cwd "$R" --id "$C" --json 2>/dev/null)"
  exp x "$(field "$J" status)" '"closed"'                                           # the correction neither reopens nor re-closes
  exp x "$(node -e 'const e0=JSON.parse(process.argv[1]).decisions[0];const a=e0.answer_corrections||[];console.log(a.length+"|"+(a[0]||{}).answer+"|"+(a[0]||{}).note+"|"+(a[0]||{}).verified)' "$J")" "1|乙|改成乙|false"
  # a second correction appends, the first one stays
  hook_with "$H/hooks" "$(printf '[待決回覆·更正] %s → 甲' "$C")"
  J="$(node "$OD" show --cwd "$R" --id "$C" --json 2>/dev/null)"
  exp x "$(node -e 'const e0=JSON.parse(process.argv[1]).decisions[0];console.log((e0.answer_corrections||[]).map(x=>x.answer).join(","))' "$J")" "乙,甲"
  # an OPEN card stays open: a correction line can never close it
  C="$(open_card)"
  hook_with "$H/hooks" "$(printf '[待決回覆·更正] %s → 乙' "$C")"
  J="$(node "$OD" show --cwd "$R" --id "$C" --json 2>/dev/null)"; exp x "$(field "$J" status)" '"open"'
  # an unknown card: said, not recorded
  hook_with "$H/hooks" '[待決回覆·更正] d-00000000 → 乙'
  case "$HOUT" in *"找不到這張卡"*) ;; *) bad=$((bad+1)) ;; esac
  # not a correction: a multi-line prompt records nothing and says nothing
  hook_with "$H/hooks" "$(printf '[待決回覆·更正] %s → 乙\n再來一行' "$C")"; exp x "$HOUT" ""
  echo "$bad"
}
assert_eq "$(check_hook "$REPO_ROOT")" 0 "(d) the real hook records the correction on the card, keeps its status, says it is unverified"

# mutant of the receiving side: a recorder that also closes the card. The hook and the scripts it loads are copied (node resolves ../scripts from the copy).
MR="$TEST_TMP/mut-hook"; mkdir -p "$MR/hooks"
cp "$REPO_ROOT"/hooks/*.js "$MR/hooks/"; [ ! -d "$REPO_ROOT/hooks/lib" ] || cp -r "$REPO_ROOT/hooks/lib" "$MR/hooks/lib"
cp -r "$REPO_ROOT/scripts" "$MR/scripts"; cp -r "$REPO_ROOT/src" "$MR/src"
[ ! -d "$REPO_ROOT/references" ] || cp -r "$REPO_ROOT/references" "$MR/references"
cp "$REPO_ROOT/package.json" "$MR/package.json" 2>/dev/null || true
sed_mutant "$REPO_ROOT/scripts/open-decision.js" "$MR/scripts/open-decision.js" "s/({ answer_corrections: \[/({ status: 'closed', closed_at: 'x', answer_corrections: [/" || fail "hook mutant did not apply"
HM="$(check_hook "$MR" 2>/dev/null)"; echo "  mutant hook-closes-card: $HM expectations red" >&2; [ "$HM" -gt 0 ]; assert_eq "$?" 0 "control: a recorder that also closes the card is caught ($HM expectations red)"
finalize_test
