#!/usr/bin/env bash
# hooks/tests/skill-onoff-d0gate-cc.test.sh - d0gate row, unit U2: the real cell runner (--runner cc) driven end to end by a FAKE `claude`.
# ZERO SPEND. Files exercised (named so the affected-suites selector reaches them): evals/skill-onoff/d0gate/cc.js, cc-tasks.js,
# run-d0gate-campaign.js, score-d0gate.js, prereg/d0gate.json, scripts/dispatch-hetero.sh (the REAL rail, G4 cells), scripts/per-turn-gate-arm.js.
#
# The fake `claude` is the only runner binary that answers; behind it on PATH sit sentinels (claude included) that log and exit 97,
# and the test fails if any of them was called. HOME / CLAUDE_CONFIG_DIR are scratch, the "real" credentials are a stub file.
# Negative controls (RED before GREEN, evidence-discipline section 58), each a copy of the runner with ONE line broken:
#   (a) an unfinished cell that drops one boolean  -> the shape check / the scorer's INVALID catches it
#   (b) the per-cell budget guard removed          -> more cells are dispatched than the cap allows
#   (c) the cell CLAUDE_CONFIG_DIR points at the real dir -> the isolation check goes red
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.claude"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
echo '{"claudeAiOauth":{"accessToken":"stub"}}' >"$CLAUDE_CONFIG_DIR/.credentials.json"
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID ONOFF_MAX_USD D0GATE_ALLOW_STUB_ROWS ONOFF_PACKS_DIR AUTOPILOT_CONFIG_FILE ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EV="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

# the owner's one-time claude-native confirmation lives in the (scratch) HOME config, written the way the owner would
node "$REPO_ROOT/scripts/run-approval.js" confirm-claude-native >/dev/null 2>&1 || fail "could not record the scratch confirmation"
HOME_CFG_SHA="$(sha256sum "$HOME/.autopilot/config.json" | cut -d' ' -f1)"
CB="$(mktemp -d /dev/shm/d0gate-cc-test-XXXXXX 2>/dev/null)" || fail "/dev/shm is not writable"
__old_trap="$(trap -p EXIT | sed "s/^trap -- '//; s/' EXIT$//")"
trap 'rm -rf "$CB"; eval "$__old_trap"' EXIT
export D0GATE_CELL_BASE="$CB"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"; mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

# ---------------------------------------------------------------- the fake claude and the sentinels
FB="$TEST_TMP/fakebin"; SB="$TEST_TMP/sentbin"; mkdir -p "$FB" "$SB"
FLOG="$TEST_TMP/fake.log"; FCFG="$TEST_TMP/fake.cfg.json"; : >"$FLOG"
SLOG="$TEST_TMP/sentinel.log"; : >"$SLOG"
for n in claude codex agy opencode kimi grok cursor-agent gemini; do printf '#!/bin/sh\necho "%s $*" >>"%s"\nexit 97\n' "$n" "$SLOG" >"$SB/$n"; chmod +x "$SB/$n"; done
cat >"$FB/claude" <<EOF
#!/usr/bin/env node
'use strict';
const fs = require('fs'); const cp = require('child_process'); const path = require('path');
const CFG = JSON.parse(fs.readFileSync('$FCFG', 'utf8'));
const WORKERS = '$EV/d0gate/stubs/scripts/d0gate-workers';
const RULES = '$EV/d0gate/fixtures/rules';
const argv = process.argv.slice(2);
const log = (o) => fs.appendFileSync('$FLOG', JSON.stringify(o) + '\n');
const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
if (argv[0] === '--version') { log({ version: true }); console.log('9.9.9 (Claude Code fake)'); process.exit(0); }
const stdin = fs.readFileSync(0, 'utf8');
const fmt = get('--output-format');
const cfgDir = process.env.CLAUDE_CONFIG_DIR;
let settingsText = null; try { if (get('--settings')) settingsText = fs.readFileSync(get('--settings'), 'utf8'); } catch (e) { /* none */ }
log({ fmt, argv, cwd: process.cwd(), HOME: process.env.HOME, CLAUDE_CONFIG_DIR: cfgDir, AUTOPILOT_LIVE_DIR: process.env.AUTOPILOT_LIVE_DIR,
  ENGINE_CAPABILITY_DIR: process.env.ENGINE_CAPABILITY_DIR, STRIKE: process.env.AUTOPILOT_STRIKE_WRITER, TMPDIR: process.env.TMPDIR,
  cfgFiles: (() => { try { return fs.readdirSync(cfgDir).sort(); } catch (e) { return null; } })(), budget: get('--max-budget-usd'), resume: get('--resume') || null,
  settings: settingsText, prompt: stdin.slice(0, 100) });
if (cfgDir && CFG.leak_marker) { try { fs.writeFileSync(path.join(cfgDir, 'leak-marker'), 'x'); } catch (e) { /* ignore */ } }
const copy = (mode, dir) => { const src = path.join(WORKERS, mode, 'files'); if (fs.existsSync(src)) fs.cpSync(src, dir, { recursive: true }); };
if (fmt === 'stream-json') {
  const plugin = get('--plugin-dir');
  let skill = ''; try { skill = fs.readFileSync(path.join(plugin, 'skills', 'ceo-agent', 'SKILL.md'), 'utf8'); } catch (e) { /* none */ }
  const armed = skill.includes('--gate-rules'); // the change arm's paragraph names the flag
  const sid = get('--resume') || ('fake-sess-' + process.pid);
  const emit = (o) => console.log(JSON.stringify(o));
  emit({ type: 'system', subtype: 'init', session_id: sid, model: 'fake-' + get('--model') });
  emit({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'autopilot:ceo-agent' } }] } });
  if (CFG.hang_g2_base && stdin.includes('capitalize') && !armed) setInterval(() => {}, 1000), setTimeout(() => {}, 600000);
  else {
    if (!get('--resume')) {
      let rules = null; let task = null;
      if (stdin.includes('capitalize')) task = 'g2'; else if (stdin.includes('gate/rules.json')) { task = 'g3'; rules = 'gate/rules.json'; } else { task = 'g1'; if (armed) rules = path.join(RULES, 'g1-good.json'); }
      fs.writeFileSync('p.txt', 'do the work\n');
      const args = ['scripts/dispatch-hetero.sh', '--runner', 'claude-native', '--model', 'haiku', '--prompt-file', 'p.txt'].concat(rules ? ['--gate-rules', rules] : []);
      const r = cp.spawnSync('bash', args, { encoding: 'utf8', env: process.env });
      emit({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', content: String(r.stdout).slice(0, 200) }] } });
    }
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sid, total_cost_usd: CFG.cost_per_turn * (get('--resume') ? 2 : 1) });
    process.exit(0);
  }
} else if (fmt === 'json') {
  const sid = get('--session-id') || 'fake-hand';
  if (settingsText) {
    copy('g4-console', process.cwd());
    const cmd = JSON.parse(settingsText).hooks.Stop[0].hooks[0].command;
    const payload = (a) => JSON.stringify({ session_id: sid, cwd: process.cwd(), stop_hook_active: a, prompt_id: 'p' });
    const hook = (a) => cp.spawnSync('sh', ['-c', cmd], { input: payload(a), encoding: 'utf8', env: process.env });
    hook(false);
    if (CFG.hang_hand_on) setInterval(() => {}, 1000); // blocked once, then never finishes: the rail times it out
    else { copy('clean-g1', process.cwd()); hook(true); hook(true); }
  } else if (CFG.hang_hand_off) { setInterval(() => {}, 1000); } else copy(CFG.hand_off_violate ? 'g4-console' : 'clean-g1', process.cwd());
  if (!(settingsText ? CFG.hang_hand_on : CFG.hang_hand_off))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, total_cost_usd: CFG.hand_cost }));
}
EOF
chmod +x "$FB/claude"
setcfg() { node -e 'const fs=require("fs"); const c={cost_per_turn:0.15,hand_cost:0.012,hang_g2_base:false,hand_off_violate:true,leak_marker:false}; Object.assign(c, JSON.parse(process.argv[2]||"{}")); fs.writeFileSync(process.argv[1], JSON.stringify(c));' "$FCFG" "${1:-}"; }
setcfg
export PATH="$FB:$SB:$PATH"
nfake() { grep -c "\"fmt\":\"$1\"" "$FLOG" || true; }

# a prereg copy with a short per-turn timeout (the scorer-side checks use the real prereg)
PRE="$TEST_TMP/prereg-test.json"
node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); p.cc.timeout_s=4; p.cc.hand_timeout="3s"; fs.writeFileSync(process.argv[2], JSON.stringify(p));' "$EV/prereg/d0gate.json" "$PRE"
REAL_PRE_SHA="$(sha256sum "$EV/prereg/d0gate.json" | cut -d' ' -f1)"
cc() { ONOFF_MAX_USD="${CAP:-2.2}" node "${RUNNER_JS:-$EV/run-d0gate-campaign.js}" --prereg "$PRE" --runner cc --pilot "$@"; }

# row/isolation checks (shared by the green runs and the negative controls)
cat >"$TEST_TMP/check.js" <<'EOF'
const fs = require('fs'); const path = require('path');
const [mode, a, b, c] = process.argv.slice(2);
const rows = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const calls = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.fmt);
if (mode === 'shape') { // every row carries every field the scorer judges on, finished or not
  const cc = require(path.join(a, 'd0gate', 'cc.js'));
  const bad = [];
  for (const r of rows(b)) { const p = cc.shapeProblems(r); if (p.length) bad.push(`${r.task_id}|${r.arm}|${r.rep}: ${p.join(',')}`); }
  if (bad.length) { console.log('INCOMPLETE ROWS: ' + bad.join(' ; ')); process.exit(1); }
  console.log('all ' + rows(b).length + ' rows are complete in shape');
} else if (mode === 'isolation') { // a=fake log, b=cell base, c=real config dir
  const bad = [];
  for (const j of calls(a)) {
    for (const k of ['HOME', 'CLAUDE_CONFIG_DIR', 'AUTOPILOT_LIVE_DIR', 'ENGINE_CAPABILITY_DIR']) if (!String(j[k] || '').startsWith(b + '/')) bad.push(`${k}=${j[k]} is not under the cell base`);
    if (j.CLAUDE_CONFIG_DIR === c) bad.push('CLAUDE_CONFIG_DIR is the real config dir');
    if (j.STRIKE !== 'off') bad.push('AUTOPILOT_STRIKE_WRITER is not off');
    if (JSON.stringify(j.cfgFiles) !== '[".credentials.json"]') bad.push('config dir holds ' + JSON.stringify(j.cfgFiles));
  }
  if (bad.length) { console.log('ISOLATION BROKEN: ' + [...new Set(bad)].slice(0, 4).join(' ; ')); process.exit(1); }
  console.log('isolation ok over ' + calls(a).length + ' claude calls');
}
EOF

echo "=== 1. --print-runner-pin prints a value and changes nothing ==="
node "$EV/run-d0gate-campaign.js" --print-runner-pin >"$TEST_TMP/pin.out" || fail "--print-runner-pin rc=$?"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!/^9\.9\.9 \(Claude Code fake\); depth0 sonnet; hand haiku; rail sha256:[0-9a-f]{64}$/.test(j.runner_pin_value)||Object.keys(j.rail_files).length!==5) throw new Error(JSON.stringify(j)); console.log(j.runner_pin_value)' "$TEST_TMP/pin.out" || fail "pin value shape"
[ "$(sha256sum "$EV/prereg/d0gate.json" | cut -d' ' -f1)" = "$REAL_PRE_SHA" ] || fail "the prereg changed"
case "$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(p.status.split(" ")[0], p.runner_pin.value)' "$EV/prereg/d0gate.json")" in "draft null") ;; *) fail "prereg status or pin was touched";; esac
ok "runner pin"

echo "=== 2. pilot, 9 cells through the fake claude (G2 base hangs on purpose: the timeout cell) ==="
setcfg '{"hang_g2_base":true,"cost_per_turn":0.05}'; : >"$FLOG"
R1="$TEST_TMP/r1.jsonl"; CAP=2.2 cc --results "$R1" >"$TEST_TMP/r1.out" 2>"$TEST_TMP/r1.err"; rc=$?
cat "$TEST_TMP/r1.out"; [ "$rc" = 0 ] || { cat "$TEST_TMP/r1.err"; fail "pilot rc=$rc"; }
[ "$(wc -l <"$R1")" = 9 ] || fail "expected 9 rows, got $(wc -l <"$R1")"
node "$TEST_TMP/check.js" shape "$EV" "$R1" || fail "row shape (green)"
node -e '
const rows = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
const by = (t, a, r) => rows.find((x) => x.task_id === t && x.arm === a && x.rep === r);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const eq = (got, want, what) => { if (canon(got) !== canon(want)) throw new Error(what + ": got " + canon(got) + " want " + canon(want)); };
eq(by("g1-constrained","base",1).markers, { m_armed: false }, "g1 base");
eq(by("g1-constrained","change",1).markers, { m_armed: true }, "g1 change");
eq(by("g1-constrained","change",1).skill_invoked, true, "g1 change skill_invoked");
const hung = by("g2-unconstrained","base",1);
eq([hung.failure_class, hung.failure_cause, hung.markers, hung.skill_invoked, hung.runner], ["infra_fail","runner_timeout",{ m_not_armed: false }, true, "cc"], "g2 base (timed out)");
eq(by("g2-unconstrained","change",1).markers, { m_not_armed: true }, "g2 change");
eq(by("g3-wrong-list","base",1).markers, { m_not_wedged: true }, "g3 base");
eq(by("g3-wrong-list","change",1).markers, { m_not_wedged: true }, "g3 change");
for (const r of [1, 2]) eq(by("g4-hand-effect","gate-off",r).g4, { completed: true, violating: true, hand_clean: false, gate_exercised: true }, "g4 off " + r);
eq(by("g4-hand-effect","gate-on",1).g4, { completed: true, violating: false, hand_clean: true, gate_exercised: true }, "g4 on");
for (const r of rows) { if (typeof r.cost_usd !== "number") throw new Error("cost"); if (r.runner !== "cc" || r.pilot !== true) throw new Error("runner/pilot"); }
eq(hung.cost_usd, 0.45, "the timed out cell is charged its whole ceiling");
console.log("rows as the fake world predicts: 8 scored + 1 timed-out cell with all fields present");' "$R1" || fail "row values"
ok "9 cells, rows complete and as predicted"

echo "=== 3. the scorer takes the cc rows (incl. the unfinished cell) without a field complaint ==="
node -e '
const fs = require("fs"); const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
const out = rows.map((r) => ({ ...r, pilot: false, model: r.task_id === "g4-hand-effect" ? "haiku" : "sonnet" }));
fs.writeFileSync(process.argv[2], out.map((r) => JSON.stringify(r)).join("\n") + "\n");
// the unfinished cell, pretended to be scorable: its shape must be complete enough that the scorer finds nothing missing
const i = out.findIndex((r) => r.failure_class); const o2 = out.map((r, k) => (k === i ? { ...r, failure_class: null } : r));
fs.writeFileSync(process.argv[3], o2.map((r) => JSON.stringify(r)).join("\n") + "\n");' "$R1" "$TEST_TMP/sc1.jsonl" "$TEST_TMP/sc2.jsonl"
node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/sc1.jsonl" >"$TEST_TMP/sc1.out" 2>&1; rc=$?
tail -1 "$TEST_TMP/sc1.out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); if (j.cells!==8||j.infra_cells!==1) throw new Error("counted "+j.cells+" cells, infra "+j.infra_cells); if (j.reasons.some((r)=>/missing\/mistyped/.test(r))) throw new Error(j.reasons.join(";")); console.log("scorer: 9 rows read (8 scorable + 1 infra cell), no field complaint; verdict "+j.d0gate_verdict+" (a pilot grid is never a verdict)");' || fail "scorer on cc rows (rc=$rc)"
node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/sc2.jsonl" >"$TEST_TMP/sc2.out" 2>&1
tail -1 "$TEST_TMP/sc2.out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); if (j.reasons.some((r)=>/missing\/mistyped/.test(r))) throw new Error("the unfinished cell lacks a field: "+j.reasons.join(";")); console.log("the unfinished cell treated as scorable: no missing/mistyped field");' || fail "unfinished cell shape"
ok "scorer vs cc rows"

echo "=== 4. what the fake claude saw: isolation, flags, budgets, ON/OFF ==="
node "$TEST_TMP/check.js" isolation "$FLOG" "$CB" "$CLAUDE_CONFIG_DIR" || fail "isolation (green)"
[ "$(nfake stream-json)" = 10 ] || fail "depth-0 turns: expected 2+2+1(timed out)+1+2+2 = 10 stream-json calls, got $(nfake stream-json)"
[ "$(nfake json)" = 3 ] || fail "hand calls: expected 3, got $(nfake json)"
node -e '
const calls = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((j) => j.fmt);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const eq = (got, want, what) => { if (canon(got) !== canon(want)) throw new Error(what + ": got " + canon(got) + " want " + canon(want)); };
const d0 = calls.filter((j) => j.fmt === "stream-json"); const hands = calls.filter((j) => j.fmt === "json");
// ceiling = 3 x the pilot unit estimate 0.15; turn 2 gets what turn 1 left (turn cost 0.05 in the fake)
eq([d0[0].budget, d0[0].resume], ["0.45", null], "first cell turn 1"); eq(d0[1].budget, "0.4", "first cell turn 2 = 0.45 - 0.05"); eq(typeof d0[1].resume, "string", "turn 2 resumes");
for (const j of d0) { for (const f of ["--strict-mcp-config", "--dangerously-skip-permissions", "--verbose"]) if (!j.argv.includes(f)) throw new Error("missing " + f); eq(j.argv[j.argv.indexOf("--disallowedTools") + 1], "ScheduleWakeup", "disallowedTools"); eq(j.argv[j.argv.indexOf("--setting-sources") + 1], "project", "setting-sources"); if (!j.argv.includes("--plugin-dir")) throw new Error("no plugin dir"); eq(j.argv[j.argv.indexOf("--model") + 1], "haiku", "pilot model"); }
// G4: ON carries the per-run --settings (the rail added it for --gate-rules), OFF does not; same budget cap through the wrapper
eq(hands.map((j) => !!j.settings), [false, false, true], "hands with --settings (off, off, on)");
eq(hands.map((j) => j.budget), ["0.45", "0.45", "0.54"], "hand budgets (3 x 0.15, 3 x 0.15, 3 x 0.18)");
const on = hands[2]; if (!/per-turn-gate\.js/.test(on.settings)) throw new Error("the ON settings do not run hooks/per-turn-gate.js");
for (const h of hands) { eq(h.argv.includes("--settings"), !!h.settings, "settings flag"); eq(h.argv[h.argv.indexOf("--model") + 1], "haiku", "hand model"); }
console.log("budgets 0.45 / 0.4 (turn 2); hands 0.45 0.45 0.54; ON hand has the gate settings, OFF hands do not");' "$FLOG" || fail "argv and budgets"
# the kept evidence of the ON cell shows the flagged dispatch and hook records; the OFF cell shows neither
KEEP="$R1.cells/g4-hand-effect"
grep -q '"gate_rules_flag":true' "$KEEP/gate-on/1/ledger.jsonl" && ls "$KEEP/gate-on/1/per-turn-gate"/*.jsonl >/dev/null 2>&1 || fail "ON cell evidence"
grep -q '"gate_rules_flag":false' "$KEEP/gate-off/1/ledger.jsonl" && [ ! -e "$KEEP/gate-off/1/per-turn-gate" ] || fail "OFF cell evidence"
# nothing leaked into the real stores
[ "$(ls -A "$CLAUDE_CONFIG_DIR" | tr '\n' ' ')" = ".credentials.json " ] || fail "the real config dir changed: $(ls -A "$CLAUDE_CONFIG_DIR")"
[ "$(sha256sum "$HOME/.autopilot/config.json" | cut -d' ' -f1)" = "$HOME_CFG_SHA" ] || fail "the real ~/.autopilot/config.json changed"
[ -z "$(find "$XDG_RUNTIME_DIR" -name 'd0g-*' 2>/dev/null)" ] && [ -z "$(find "$XDG_RUNTIME_DIR" -name '*.gate.json' 2>/dev/null)" ] || fail "gate state landed in the (scratch) real live store"
REAL_XDG="$(getent passwd "$(id -un)" | cut -d: -f6)/.autopilot"
[ -d "$REAL_XDG" ] && find "$REAL_XDG" -newer "$FCFG" -name 'd0g-*' 2>/dev/null | grep -q . && fail "d0g-* files under the operator ~/.autopilot"
ok "isolation, flags, budgets, ON/OFF"

echo "=== 5. budget guard: a cell whose ceiling does not fit is not dispatched; resume-by-cell fills only the gaps ==="
setcfg '{}'; : >"$FLOG"
R2="$TEST_TMP/r2.jsonl"; CAP=1.5 cc --results "$R2" >"$TEST_TMP/r2.out" 2>"$TEST_TMP/r2.err"; rc=$?
[ "$rc" = 1 ] && grep -q 'below the 0.45 USD cell ceiling of g3-wrong-list|change|1' "$TEST_TMP/r2.err" || { cat "$TEST_TMP/r2.err"; fail "cap 1.5 must stop before g3 change (rc=$rc)"; }
echo "GREEN (guard): $(tail -1 "$TEST_TMP/r2.err")"
[ "$(wc -l <"$R2")" = 5 ] && [ "$(nfake stream-json)" = 8 ] && [ "$(nfake json)" = 0 ] || fail "guard run: expected 5 rows and 8 depth-0 calls, got $(wc -l <"$R2") rows / $(nfake stream-json) calls"
: >"$FLOG"
CAP=2.2 cc --results "$R2" >"$TEST_TMP/r3.out" 2>"$TEST_TMP/r3.err"; rc=$?
[ "$rc" = 0 ] || { cat "$TEST_TMP/r3.err"; fail "resume rc=$rc"; }
[ "$(wc -l <"$R2")" = 9 ] || fail "after resume expected 9 rows, got $(wc -l <"$R2")"
[ "$(nfake stream-json)" = 2 ] && [ "$(nfake json)" = 3 ] || fail "resume must run only the 4 missing cells (2 depth-0 turns + 3 hands), got $(nfake stream-json) / $(nfake json)"
node -e 'const rows=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse); const k=new Set(rows.map((r)=>r.task_id+"|"+r.arm+"|"+r.rep)); if(k.size!==9||rows.some((r)=>r.failure_class!==null)) throw new Error("rows are not 9 distinct scored cells"); console.log("resume: 5 cells kept, 4 added, 9 distinct scored cells")' "$R2" || fail "resume rows"
node "$TEST_TMP/check.js" shape "$EV" "$R2" || fail "shape after resume"
# the formal launch guard of U1 is untouched
node "$EV/run-d0gate-campaign.js" --prereg "$PRE" --results "$TEST_TMP/formal.jsonl" --runner cc >/dev/null 2>"$TEST_TMP/e1"; rc=$?
[ "$rc" = 2 ] && grep -q 'not stamped' "$TEST_TMP/e1" || fail "formal cc on a draft must still be refused (rc=$rc: $(cat "$TEST_TMP/e1"))"
echo "GREEN (formal guard): $(cat "$TEST_TMP/e1")"
ok "budget guard, resume-by-cell, formal guard"

echo "=== 5b. G4 rail timeouts: ON arm blocked then hung is SCORED (completed=false); OFF arm hung is infra ==="
setcfg '{"hang_hand_on":true,"hang_hand_off":true}'; : >"$FLOG"
R4="$TEST_TMP/r4.jsonl"; node -e 'const fs=require("fs"); const r=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).slice(0,6).map((l)=>JSON.stringify({ ...JSON.parse(l), cost_usd: 0.05 })); fs.writeFileSync(process.argv[2], r.join("\n")+"\n");' "$R2" "$R4"  # the 6 depth-0 rows, cheap, so only the 3 G4 cells are todo and the cap is not the subject here
CAP=2.2 cc --results "$R4" >"$TEST_TMP/r4.out" 2>"$TEST_TMP/r4.err"; rc=$?
cat "$TEST_TMP/r4.out"; [ "$rc" = 0 ] || { cat "$TEST_TMP/r4.err"; fail "g4 timeout run rc=$rc"; }
cat >"$TEST_TMP/tmo.js" <<'JS'
const fs = require('fs');
const rows = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.task_id === 'g4-hand-effect');
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const on = rows.filter((r) => r.arm === 'gate-on'); const off = rows.filter((r) => r.arm === 'gate-off');
const bad = [];
if (on.length !== 1 || on[0].failure_class !== null || on[0].failure_cause !== 'timed_out_after_gate_block' || on[0].g4.completed !== false || on[0].g4.hand_clean !== false || on[0].g4.gate_exercised !== true) bad.push('ON row: ' + canon(on[0]));
if (off.length !== 2 || off.some((r) => r.failure_class !== 'infra_fail' || r.failure_cause !== 'runner_timeout')) bad.push('OFF rows: ' + canon(off.map((r) => [r.failure_class, r.failure_cause])));
if (bad.length) { console.log('TIMEOUT RULE WRONG: ' + bad.join(' ; ')); process.exit(1); }
console.log('ON blocked-then-hung: scored, completed=false, cause timed_out_after_gate_block; OFF hung x2: infra_fail/runner_timeout');
JS
node "$TEST_TMP/tmo.js" x "$R4" || fail "g4 timeout rule (green)"
node -e '
const fs=require("fs"); const rows=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map((l)=>JSON.parse(l));
fs.writeFileSync(process.argv[2], rows.map((r)=>JSON.stringify({ ...r, pilot:false, model:r.task_id==="g4-hand-effect"?"haiku":"sonnet" })).join("\n")+"\n");' "$R4" "$TEST_TMP/r4-sc.jsonl"
node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/r4-sc.jsonl" >"$TEST_TMP/r4-sc.out" 2>&1
grep -q 'missing/mistyped' "$TEST_TMP/r4-sc.out" && fail "the timeout rows draw a missing/mistyped complaint: $(tail -1 "$TEST_TMP/r4-sc.out")"
echo "scorer: no missing/mistyped on the timeout rows"
node "$TEST_TMP/check.js" shape "$EV" "$R4" || fail "shape of timeout rows"
ok "G4 timeout rule"

echo "=== 6. negative controls: three runner copies each with ONE line broken, RED before the real runner is GREEN ==="
FARM="$TEST_TMP/farm"; rm -rf "$FARM"; mkdir -p "$FARM/evals"; cp -R "$EV" "$FARM/evals/skill-onoff"
for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do b="$(basename "$e")"; case "$b" in evals|.git) ;; *) [ -e "$e" ] && ln -s "$e" "$FARM/$b";; esac; done  # the rail finds ../src from its own dir
FEV="$FARM/evals/skill-onoff"
brk() { local f="$1" before; before="$(sha256sum "$f" | cut -d' ' -f1)"; node -e 'const fs=require("fs"); const [f,from,to]=process.argv.slice(1); const t=fs.readFileSync(f,"utf8"); if(!t.includes(from)){console.error("pattern not found: "+from); process.exit(1);} fs.writeFileSync(f, t.split(from).join(to));' "$@" || fail "negative control: could not plant the break"; [ "$before" != "$(sha256sum "$f" | cut -d' ' -f1)" ] || fail "negative control: nothing changed ($2)"; }
# (a) an unfinished cell that drops its marker boolean (and the runner's own shape guard switched off)
brk "$FEV/d0gate/cc.js" "{ markers: { [D0_MARKER[c.task]]: false }, skill_invoked: false }" "{ markers: {}, skill_invoked: false }"
brk "$FEV/d0gate/cc.js" "if (probs.length) throw" "if (false) throw"
setcfg '{"hang_g2_base":true}'; : >"$FLOG"
RA="$TEST_TMP/ra.jsonl"; CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$RA" --limit 3 >/dev/null 2>&1
[ "$(wc -l <"$RA")" = 3 ] || fail "control (a) setup: expected 3 rows"
if node "$TEST_TMP/check.js" shape "$FEV" "$RA" >"$TEST_TMP/ra.out" 2>&1; then fail "RED control (a) was NOT caught: $(cat "$TEST_TMP/ra.out")"; fi
echo "RED (expected) (a) unfinished cell without its marker boolean: $(cat "$TEST_TMP/ra.out")"
node -e '
const fs=require("fs"); const rows=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse);
const out=rows.map((r)=>({ ...r, pilot:false, model:r.task_id==="g4-hand-effect"?"haiku":"sonnet", ...(r.failure_class?{failure_class:null}:{}) }));
fs.writeFileSync(process.argv[2], out.map((r)=>JSON.stringify(r)).join("\n")+"\n");' "$RA" "$TEST_TMP/ra-sc.jsonl"
node "$EV/score-d0gate.js" --prereg "$EV/prereg/d0gate.json" --results "$TEST_TMP/ra-sc.jsonl" >"$TEST_TMP/ra-sc.out" 2>&1
grep -q 'missing/mistyped' "$TEST_TMP/ra-sc.out" || fail "RED control (a): the scorer did not call the incomplete row INVALID for a missing field"
echo "RED (expected) (a) scorer: INVALID, missing/mistyped field(s)"
# (b) the budget guard removed: the cap no longer stops the run
brk "$FEV/run-d0gate-campaign.js" "if (remaining + 1e-9 < ceiling) die(" "if (false) die("
setcfg '{}'; : >"$FLOG"
RB="$TEST_TMP/rb.jsonl"; CAP=1.5 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$RB" >/dev/null 2>&1
if [ "$(wc -l <"$RB")" = 5 ] && [ "$(nfake stream-json)" = 8 ]; then fail "RED control (b) was NOT caught: the guard-less runner also stopped at 5 cells"; fi
echo "RED (expected) (b) guard removed: $(wc -l <"$RB") rows / $(nfake stream-json) depth-0 calls instead of 5 / 8 (the 1.5 USD cap is passed)"
# (c) the cell CLAUDE_CONFIG_DIR is the real dir
brk "$FEV/d0gate/cc.js" "...e, SHELL: '/bin/bash'," "...e, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, SHELL: '/bin/bash',"
setcfg '{}'; : >"$FLOG"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rc.jsonl" --limit 1 >/dev/null 2>&1
if node "$TEST_TMP/check.js" isolation "$FLOG" "$CB" "$CLAUDE_CONFIG_DIR" >"$TEST_TMP/rc.out" 2>&1; then fail "RED control (c) was NOT caught: $(cat "$TEST_TMP/rc.out")"; fi
echo "RED (expected) (c) real config dir: $(cat "$TEST_TMP/rc.out")"
# (d) the timeout rule put back to 'always infra'
brk "$FEV/d0gate/cc.js" "const blocked = on && " "const blocked = false && "
setcfg '{"hang_hand_on":true,"hang_hand_off":true}'; : >"$FLOG"
RD="$TEST_TMP/rd.jsonl"; cp "$R4.seed" "$RD" 2>/dev/null || node -e 'const fs=require("fs"); const r=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).slice(0,6).map((l)=>JSON.stringify({ ...JSON.parse(l), cost_usd: 0.05 })); fs.writeFileSync(process.argv[2], r.join("\n")+"\n");' "$R2" "$RD"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$RD" >/dev/null 2>&1
if node "$TEST_TMP/tmo.js" x "$RD" >"$TEST_TMP/rd.out" 2>&1; then fail "RED control (d) was NOT caught: $(cat "$TEST_TMP/rd.out")"; fi
grep -q '"failure_cause":"runner_timeout"' "$RD" || fail "RED control (d) went red for the wrong reason (no runner_timeout row): $(cat "$TEST_TMP/rd.out")"
echo "RED (expected) (d) timeout always infra: $(cat "$TEST_TMP/rd.out")"
ok "negative controls red, real runner green (sections 2 to 5)"

echo "=== 7. no real runner binary was started ==="
[ ! -s "$SLOG" ] || { cat "$SLOG"; fail "a sentinel runner binary was called (a real claude or another runner)"; }
node -e '
const calls = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
const odd = calls.filter((j) => !j.version && !["stream-json", "json"].includes(j.fmt));
if (odd.length) throw new Error("unexpected fake-claude call shape: " + JSON.stringify(odd[0]));
console.log("every logged call is an expected fake-claude shape");' "$FLOG" || fail "fake log shapes"
echo "sentinel log is empty: only the fake claude answered"
ok "zero spend"
echo "PASS: skill-onoff-d0gate-cc"
