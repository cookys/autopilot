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
// the session transcript claude leaves behind (ASSUMED layout, as in the runner: <config>/projects/<project>/<session>.jsonl)
const writeSession = (sid, cost) => { try { const d = path.join(cfgDir, 'projects', '-cell'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, sid + '.jsonl'), JSON.stringify(cost === null ? { type: 'user' } : { type: 'result', total_cost_usd: cost }) + '\n'); } catch (e) { /* ignore */ } };
if (fmt === 'stream-json' && !get('--plugin-dir')) { // a claude the depth-0 agent started itself, behind the PATH wrapper (absolute path)
  const sneak = 'sneak-' + process.pid; writeSession(sneak, CFG.sneak_unreadable ? null : CFG.sneak_cost);
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'sneak', session_id: sneak, total_cost_usd: CFG.sneak_cost }));
  process.exit(0);
}
if (cfgDir && CFG.leak_marker) { try { fs.writeFileSync(path.join(cfgDir, 'leak-marker'), 'x'); } catch (e) { /* ignore */ } }
const copy = (mode, dir) => { const src = path.join(WORKERS, mode, 'files'); if (fs.existsSync(src)) fs.cpSync(src, dir, { recursive: true }); };
if (fmt === 'stream-json') {
  const plugin = get('--plugin-dir');
  let skill = ''; try { skill = fs.readFileSync(path.join(plugin, 'skills', 'ceo-agent', 'SKILL.md'), 'utf8'); } catch (e) { /* none */ }
  const armed = skill.includes('--gate-rules'); // the change arm's paragraph names the flag
  const sid = get('--resume') || ('fake-sess-' + process.pid);
  const emit = (o) => console.log(JSON.stringify(o));
  writeSession(sid, CFG.cost_per_turn * (get('--resume') ? 2 : 1));
  emit({ type: 'system', subtype: 'init', session_id: sid, model: 'fake-' + get('--model') });
  emit({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'autopilot:ceo-agent' } }] } });
  const doSneak = () => { if (CFG.sneak && (!CFG.sneak_g2_only || stdin.includes('capitalize'))) cp.spawnSync(process.argv[1], ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose'], { input: 'hi', env: process.env, encoding: 'utf8' }); }; // absolute path: the PATH wrapper is bypassed
  if (CFG.hang_g2_base && stdin.includes('capitalize') && !armed) {
    if (!get('--resume')) doSneak();
    if (CFG.hang_report) emit({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: sid, total_cost_usd: 0.01 }); // spends, reports, then hangs
    setInterval(() => {}, 1000);
  }
  else {
    if (!get('--resume')) {
      doSneak();
      if (CFG.nested) for (let k = 0; k < 2; k++) cp.spawnSync('claude', ['-p', '--model', 'haiku', '--output-format', 'stream-json', '--verbose'], { input: 'hi', env: process.env, encoding: 'utf8' }); // the agent tries to start its own claude
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
  writeSession(sid, CFG.hand_cost); // the hand's own session file under <config>/projects (the runner keeps its file list and copies)
  if (settingsText) {
    copy('g4-console', process.cwd());
    const cmd = JSON.parse(settingsText).hooks.Stop[0].hooks[0].command;
    const payload = (a) => JSON.stringify({ session_id: sid, cwd: process.cwd(), stop_hook_active: a, prompt_id: 'p' });
    const hook = (a) => cp.spawnSync('sh', ['-c', cmd], { input: payload(a), encoding: 'utf8', env: process.env });
    hook(false);
    if (CFG.hang_hand_on) setInterval(() => {}, 1000); // blocked once, then never finishes: the rail times it out
    else { copy('clean-g1', process.cwd()); hook(true); hook(true); }
  } else if (CFG.hang_hand_off) { setInterval(() => {}, 1000); } else copy(CFG.hand_off_violate ? 'g4-console' : 'clean-g1', process.cwd());
  const hanging = settingsText ? CFG.hang_hand_on : CFG.hang_hand_off;
  if (hanging && CFG.hand_auth_error) console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'authentication invalid api key', session_id: sid, total_cost_usd: 0 }));
  else if (hanging && CFG.hand_report_first) console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, total_cost_usd: CFG.hand_cost }));
  if (!hanging && !CFG.hand_silent)
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, total_cost_usd: CFG.hand_cost }));
  if (!hanging && CFG.hand_quota) console.error('usage limit reached');
  if (!hanging && (CFG.hand_fail || CFG.hand_quota)) process.exit(1);
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
cc() { ONOFF_MAX_USD="${CAP:-2.2}" node "${RUNNER_JS:-$EV/run-d0gate-campaign.js}" --prereg "${PREG:-$PRE}" --runner cc --pilot "$@"; }

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
    if (!Array.isArray(j.cfgFiles) || !j.cfgFiles.includes('.credentials.json') || j.cfgFiles.some((f) => !['.credentials.json', 'projects'].includes(f))) bad.push('config dir holds ' + JSON.stringify(j.cfgFiles));
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
const GATE_ON_BLOCKS = 1; const eq = (got, want, what) => { if (canon(got) !== canon(want)) throw new Error(what + ": got " + canon(got) + " want " + canon(want)); };
eq(by("g1-constrained","base",1).markers, { m_armed: false }, "g1 base");
eq(by("g1-constrained","change",1).markers, { m_armed: true }, "g1 change");
eq(by("g1-constrained","change",1).skill_invoked, true, "g1 change skill_invoked");
const hung = by("g2-unconstrained","base",1);
eq([hung.failure_class, hung.failure_cause, hung.markers, hung.skill_invoked, hung.skill_invoked_observed, hung.runner], ["infra_fail","runner_timeout",{ m_not_armed: false }, false, true, "cc"], "g2 base (timed out): skill_invoked false, observed true");
eq(by("g1-constrained","change",1).skill_invoked_observed, true, "g1 change observed");
eq(by("g2-unconstrained","change",1).markers, { m_not_armed: true }, "g2 change");
eq(by("g3-wrong-list","base",1).markers, { m_not_wedged: true }, "g3 base");
eq(by("g3-wrong-list","change",1).markers, { m_not_wedged: true }, "g3 change");
for (const r of [1, 2]) eq(by("g4-hand-effect","gate-off",r).g4, { completed: true, violating: true, hand_clean: false, gate_exercised: true, gate_blocks: 0 }, "g4 off " + r);
eq(by("g4-hand-effect","gate-on",1).g4, { completed: true, violating: false, hand_clean: true, gate_exercised: true, gate_blocks: GATE_ON_BLOCKS }, "g4 on");
for (const r of rows) { if (typeof r.cost_usd !== "number") throw new Error("cost"); if (r.runner !== "cc" || r.pilot !== true) throw new Error("runner/pilot"); }
eq(hung.cost_usd, 0.24, "the timed out cell is charged its whole ceiling (3 x 0.08)");
console.log("rows as the fake world predicts: 8 scored + 1 timed-out cell with all fields present");' "$R1" || fail "row values"
# the kept evidence of a G4 cell: the hand prompt in full, the hand output, and the file list (path, size) of the cell config projects/ plus the copies
node -e '
const fs = require("fs"); const path = require("path");
const dir = process.argv[1] + ".cells/g4-hand-effect/gate-on/1";
const T = require(process.argv[2] + "/d0gate/cc-tasks.js");
const need = ["hand-prompt.txt", "hand-out.json", "projects-files.json", "ledger.jsonl"];
for (const f of need) if (!fs.existsSync(path.join(dir, f))) throw new Error("kept evidence lacks " + f);
if (fs.readFileSync(path.join(dir, "hand-prompt.txt"), "utf8") !== T.handPrompt()) throw new Error("kept hand prompt differs from the brief the hand got");
const list = JSON.parse(fs.readFileSync(path.join(dir, "projects-files.json"), "utf8"));
if (!Array.isArray(list) || list.length < 1 || list.some((x) => typeof x.path !== "string" || !Number.isInteger(x.size))) throw new Error("projects-files.json shape: " + JSON.stringify(list));
if (!list.some((x) => x.path.startsWith("hand-sessions/"))) throw new Error("no hand session file kept: " + JSON.stringify(list));
for (const x of list) if (!fs.existsSync(path.join(dir, x.path))) throw new Error("kept copy lacks " + x.path);
console.log("kept for a G4 cell: " + need.join(", ") + "; projects/ lists " + list.length + " file(s): " + list.map((x) => x.path + " (" + x.size + " B)").join(", "));' "$R1" "$EV" || fail "kept G4 evidence"
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
// ceiling = 3 x the pilot unit estimate 0.115 (G1); turn 2 gets what turn 1 left (turn cost 0.05 in the fake)
eq([d0[0].budget, d0[0].resume], ["0.35", null], "first cell turn 1"); eq(d0[1].budget, "0.3", "first cell turn 2 = 0.35 - 0.05"); eq(typeof d0[1].resume, "string", "turn 2 resumes");
for (const j of d0) { for (const f of ["--strict-mcp-config", "--dangerously-skip-permissions", "--verbose"]) if (!j.argv.includes(f)) throw new Error("missing " + f); eq(j.argv[j.argv.indexOf("--disallowedTools") + 1], "ScheduleWakeup", "disallowedTools"); eq(j.argv[j.argv.indexOf("--setting-sources") + 1], "project", "setting-sources"); if (!j.argv.includes("--plugin-dir")) throw new Error("no plugin dir"); eq(j.argv[j.argv.indexOf("--model") + 1], "haiku", "pilot model"); }
// G4: ON carries the per-run --settings (the rail added it for --gate-rules), OFF does not; same budget cap through the wrapper
eq(hands.map((j) => !!j.settings), [false, false, true], "hands with --settings (off, off, on)");
eq(hands.map((j) => j.budget), ["0.03", "0.03", "0.03"], "hand budgets (3 x 0.01 each)");
const on = hands[2]; if (!/per-turn-gate\.js/.test(on.settings)) throw new Error("the ON settings do not run hooks/per-turn-gate.js");
for (const h of hands) { eq(h.argv.includes("--settings"), !!h.settings, "settings flag"); eq(h.argv[h.argv.indexOf("--model") + 1], "haiku", "hand model"); }
console.log("budgets 0.35 / 0.3 (turn 2); hands 0.03 0.03 0.03; ON hand has the gate settings, OFF hands do not");' "$FLOG" || fail "argv and budgets"
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
setcfg '{"cost_per_turn":0.1}'; : >"$FLOG"
R2="$TEST_TMP/r2.jsonl"; CAP=1.0 cc --results "$R2" >"$TEST_TMP/r2.out" 2>"$TEST_TMP/r2.err"; rc=$?
[ "$rc" = 1 ] && grep -q 'below the 0.35 USD cell ceiling of g3-wrong-list|change|1' "$TEST_TMP/r2.err" || { cat "$TEST_TMP/r2.err"; fail "cap 1.0 must stop before g3 change (rc=$rc)"; }
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

echo "=== 5c. pilot cap is locked in the program: ONOFF_MAX_USD=5 with --pilot never spends past 2.2 ==="
setcfg '{"cost_per_turn":0.22}'; : >"$FLOG"
R6="$TEST_TMP/r6.jsonl"; CAP=5 cc --results "$R6" >"$TEST_TMP/r6.out" 2>"$TEST_TMP/r6.err"; rc=$?
cat >"$TEST_TMP/lock.js" <<'JS'
const fs = require('fs');
const rows = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const spent = rows.reduce((a, r) => a + r.cost_usd, 0);
if (spent > 2.2 + 1e-9) { console.log('PILOT CAP BROKEN: spent ' + spent.toFixed(3) + ' USD over ' + rows.length + ' cells (ONOFF_MAX_USD=5, pilot ceiling 2.2)'); process.exit(1); }
console.log('spent ' + spent.toFixed(3) + ' USD over ' + rows.length + ' cells, within the 2.2 pilot ceiling');
JS
[ "$rc" = 1 ] && grep -q 'locked to 2.2 USD' "$TEST_TMP/r6.out" || { cat "$TEST_TMP/r6.out" "$TEST_TMP/r6.err"; fail "pilot lock: expected the notice and exit 1 at the cap (rc=$rc)"; }
node "$TEST_TMP/lock.js" x "$R6" || fail "pilot lock (green)"
grep -q 'below the 0.03 USD cell ceiling' "$TEST_TMP/r6.err" || fail "the remaining-budget guard did not use the locked cap"
echo "GREEN (lock): $(grep 'locked to' "$TEST_TMP/r6.out")"
ok "pilot cap locked"

echo "=== 5d. a claude the depth-0 agent tries to start is refused and counted; the real (fake) claude is not called ==="
setcfg '{"cost_per_turn":0.05,"nested":true}'; : >"$FLOG"
R7="$TEST_TMP/r7.jsonl"; CAP=2.2 cc --results "$R7" --limit 1 >/dev/null 2>&1 || fail "nested run rc=$?"
cat >"$TEST_TMP/acct.js" <<'JS'
const fs = require('fs');
const [mode, log, rowsf, want] = process.argv.slice(2);
const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.fmt === 'stream-json');
const row = fs.readFileSync(rowsf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))[0];
const bad = [];
const near = (a, b) => Math.abs(a - b) < 1e-6;
if (mode === 'nested') {
  const reached = calls.filter((j) => !j.argv.includes('--plugin-dir')); const main = calls.filter((j) => j.argv.includes('--plugin-dir'));
  if (reached.length) bad.push(reached.length + ' nested claude call(s) reached the real claude (want 0)');
  if (row.nested_claude_attempts !== 2) bad.push('nested_claude_attempts ' + row.nested_claude_attempts + ' (want 2)');
  for (const m of main) if (m.argv.filter((a) => a === '--max-budget-usd').length !== 1) bad.push('a main turn carries ' + m.argv.filter((a) => a === '--max-budget-usd').length + ' budget flags');
  if (!near(row.cost_usd, 0.1)) bad.push('cost_usd ' + row.cost_usd + ' (want 0.1: the last packet of the resumed session, nothing nested)');
} else if (mode === 'cost') {
  if (!near(row.cost_usd, Number(want)) || JSON.stringify(row.cost_turns) !== '[0.05,0.1]') bad.push('cost_usd ' + row.cost_usd + ' cost_turns ' + JSON.stringify(row.cost_turns) + ' (want ' + want + ' / [0.05,0.1])');
}
if (bad.length) { console.log('ACCOUNTING WRONG: ' + bad.join(' ; ')); process.exit(1); }
console.log(mode + ' ok: cost_usd ' + row.cost_usd + ', cost_turns ' + JSON.stringify(row.cost_turns) + (mode === 'nested' ? ', nested_claude_attempts ' + row.nested_claude_attempts + ', no call reached the real claude' : ''));
JS
node "$TEST_TMP/acct.js" nested "$FLOG" "$R7" || fail "nested refusal (green)"
node "$TEST_TMP/check.js" shape "$EV" "$R7" || fail "shape with nested_claude_attempts"
ok "nested claude refused and counted"

echo "=== 5d2. G4 hand wrapper: every hand launch of one cell gets only what is left of the cell budget ==="
cat >"$TEST_TMP/real-claude.sh" <<EOF
#!/bin/bash
echo "\$*" >>"$TEST_TMP/wrap-calls.log"
printf '{"type":"result","session_id":"s%s","total_cost_usd":0.4}\n' "\$\$"
EOF
chmod +x "$TEST_TMP/real-claude.sh"
cat >"$TEST_TMP/wtest.js" <<'JS'
const fs = require('fs'); const cp = require('child_process'); const path = require('path');
const [evdir, tmp] = process.argv.slice(2);
const cc = require(path.join(evdir, 'd0gate', 'cc.js'));
const cell = { root: fs.mkdtempSync(path.join(tmp, 'wcell-')) };
const bin = cc.handWrapper(cell, path.join(tmp, 'real-claude.sh'));
const out = path.join(cell.root, 'hand-out.json'); fs.writeFileSync(out, '');
const log = path.join(tmp, 'wrap-calls.log'); fs.writeFileSync(log, '');
const run = () => cp.spawnSync(path.join(bin, 'claude'), ['-p', '--output-format', 'json'], { env: { ...process.env, D0GATE_HAND_OUT: out, D0GATE_HAND_BUDGET: '0.5' }, encoding: 'utf8' });
const rcs = [run().status, run().status, run().status];
const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
const budgets = calls.map((l) => l.split(' ').pop());
const bad = [];
if (JSON.stringify(budgets) !== '["0.5","0.1"]') bad.push('budgets given to the launches ' + JSON.stringify(budgets) + ' (want ["0.5","0.1"]: the 2nd gets 0.5 - 0.4)');
if (JSON.stringify(rcs) !== '[0,0,97]') bad.push('exit codes ' + JSON.stringify(rcs) + ' (want [0,0,97]: the 3rd launch is refused, 0.8 already spent of 0.5)');
if (bad.length) { console.log('HAND WRAPPER WRONG: ' + bad.join(' ; ')); process.exit(1); }
console.log('hand wrapper: launch 1 gets 0.5, launch 2 gets 0.1, launch 3 refused (exit 97), the real claude ran twice');
JS
node "$TEST_TMP/wtest.js" "$EV" "$TEST_TMP" || fail "hand wrapper cumulative budget (green)"
ok "hand wrapper cumulative budget"

echo "=== 5e. cost_turns, last-packet cost_usd (the prereg says resume totals are cumulative), and the summed variant when the prereg says otherwise ==="
setcfg '{"cost_per_turn":0.05}'; : >"$FLOG"
R8="$TEST_TMP/r8.jsonl"; CAP=2.2 cc --results "$R8" --limit 1 >/dev/null 2>&1 || fail "cost run rc=$?"
node "$TEST_TMP/acct.js" cost "$FLOG" "$R8" 0.1 || fail "cumulative cost (green)"
[ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cc.resume_cost_cumulative)' "$EV/prereg/d0gate.json")" = true ] || fail "the prereg does not say resume totals are cumulative"
PREG="$TEST_TMP/prereg-sum.json"; node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); p.cc.resume_cost_cumulative=false; fs.writeFileSync(process.argv[2], JSON.stringify(p));' "$PRE" "$PREG"
R9="$TEST_TMP/r9.jsonl"; : >"$FLOG"; CAP=2.2 cc --results "$R9" --limit 1 >/dev/null 2>&1 || fail "summed run rc=$?"
node "$TEST_TMP/acct.js" cost "$FLOG" "$R9" 0.15 || fail "summed cost (green)"
unset PREG
ok "cost accounting"

echo "=== 5f. timeout regressions: a hand/turn that reported a small spend and then hung is charged the whole ceiling; an auth failure is infra even with a gate block ==="
cat >"$TEST_TMP/tmo2.js" <<'JS'
const fs = require('fs');
const [mode, rowsf] = process.argv.slice(2);
const rows = fs.readFileSync(rowsf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bad = [];
if (mode === 'g4cost') { // ON, one real block, hand reports 0.01, then hangs: scored, charged the 0.03 ceiling
  const on = rows.find((r) => r.task_id === 'g4-hand-effect' && r.arm === 'gate-on');
  if (!on || on.cost_usd !== 0.03 || on.cost_unknown !== true) bad.push('G4 ON timed-out cell cost ' + (on && on.cost_usd) + ' unknown=' + (on && on.cost_unknown) + ' (want 0.03, unknown)');
} else if (mode === 'd0cost') { // depth-0 turn reports 0.01 and hangs
  const g2 = rows.find((r) => r.task_id === 'g2-unconstrained' && r.arm === 'base');
  if (!g2 || g2.failure_class !== 'infra_fail' || g2.cost_usd !== 0.24) bad.push('depth-0 timed-out cell: ' + (g2 && [g2.failure_class, g2.cost_usd]) + ' (want infra_fail, 0.24)');
  if (g2 && (g2.skill_invoked !== false || g2.skill_invoked_observed !== true)) bad.push('unfinished row: skill_invoked ' + g2.skill_invoked + ', observed ' + g2.skill_invoked_observed + ' (want false / true)');
} else if (mode === 'g4failure' || mode === 'g4empty') { // rail failure status with a clean envelope / a hand that printed nothing: both infra, with their own cause
  const on = rows.find((r) => r.task_id === 'g4-hand-effect' && r.arm === 'gate-on');
  const want = mode === 'g4failure' ? 'runner_error' : 'empty_output';
  if (!on || on.failure_class !== 'infra_fail' || on.failure_cause !== want) bad.push(mode + ': ' + (on && [on.failure_class, on.failure_cause, on.rail_status]) + ' (want infra_fail/' + want + ')');
} else if (mode === 'g4quota') {
  const on = rows.find((r) => r.task_id === 'g4-hand-effect' && r.arm === 'gate-on');
  if (!on || on.failure_class !== 'infra_fail' || on.failure_cause !== 'quota') bad.push('g4quota: ' + (on && [on.failure_class, on.failure_cause, on.rail_status]) + ' (want infra_fail/quota)');
} else if (mode === 'auth') { // ON, real block, auth error envelope, then timeout: infra authentication
  const on = rows.find((r) => r.task_id === 'g4-hand-effect' && r.arm === 'gate-on');
  if (!on || on.failure_class !== 'infra_fail' || on.failure_cause !== 'authentication') bad.push('G4 ON auth+block+timeout: ' + (on && [on.failure_class, on.failure_cause]) + ' (want infra_fail/authentication)');
}
if (bad.length) { console.log('TIMEOUT REGRESSION: ' + bad.join(' ; ')); process.exit(1); }
console.log(mode + ' ok');
JS
seed_on() { node -e 'const fs=require("fs"); const r=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(JSON.parse).filter((x)=>!(x.task_id==="g4-hand-effect"&&x.arm==="gate-on")).map((x)=>JSON.stringify({ ...x, cost_usd: 0.05 })); fs.writeFileSync(process.argv[2], r.join("\n")+"\n");' "$R2" "$1"; }
setcfg '{"hang_hand_on":true,"hand_report_first":true,"hand_cost":0.01}'; R10="$TEST_TMP/r10.jsonl"; seed_on "$R10"
CAP=2.2 cc --results "$R10" >/dev/null 2>&1 || fail "g4 cost regression run rc=$?"
node "$TEST_TMP/tmo2.js" g4cost "$R10" || fail "G4 timeout cost (green)"
setcfg '{"hang_g2_base":true,"hang_report":true}'; R11="$TEST_TMP/r11.jsonl"; : >"$R11"
CAP=2.2 cc --results "$R11" --limit 3 >/dev/null 2>&1
node "$TEST_TMP/tmo2.js" d0cost "$R11" || fail "depth-0 timeout cost (green)"
setcfg '{"hang_hand_on":true,"hand_auth_error":true}'; R12="$TEST_TMP/r12.jsonl"; seed_on "$R12"
CAP=2.2 cc --results "$R12" >/dev/null 2>&1; [ -s "$R12" ] || fail "auth regression run wrote nothing"  # exit 2 is expected: an auth failure stops the campaign
node "$TEST_TMP/tmo2.js" auth "$R12" || fail "auth+block+timeout (green)"
ok "timeout cost ceiling and auth-before-exception"

echo "=== 5g. a claude the depth-0 agent starts by absolute path leaves a session file: detected, charged, infra, and the campaign stops ==="
cat >"$TEST_TMP/unac.js" <<'JS'
const fs = require('fs');
const [mode, rowsf] = process.argv.slice(2);
const rows = fs.readFileSync(rowsf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r = mode.startsWith('timeout') ? rows[2] : rows[0]; const bad = [];
// readable: the last packet 0.10 (own turns, cumulative) + the stray's 0.07; unreadable: own 0.10 + one whole G1 ceiling 0.35; timeout: G2 ceiling 0.24 + 0.07;
// timeout-unreadable: ceiling 0.24 (timed-out cell) + one whole ceiling 0.24 for the unreadable stray = 2 x ceiling
const want = { readable: 0.17, unreadable: 0.45, timeout: 0.31, 'timeout-unreadable': 0.48 }[mode]; // 0.05 + 0.10 of its own turns + the stray's 0.07; unreadable: the whole ceiling
if (rows.length !== (mode.startsWith('timeout') ? 3 : 1)) bad.push(rows.length + ' rows (the campaign must stop right after the cell with the stray session)');
if (!r || r.failure_class !== 'infra_fail' || r.failure_cause !== 'unaccounted_claude_session' || r.unaccounted_sessions !== 1) bad.push('row ' + (r && [r.failure_class, r.failure_cause, r.unaccounted_sessions]));
if (r && Math.abs(r.cost_usd - want) > 1e-6) bad.push('cost_usd ' + (r && r.cost_usd) + ' (want ' + want + ')');
if (bad.length) { console.log('UNACCOUNTED SESSION MISSED: ' + bad.join(' ; ')); process.exit(1); }
console.log(mode + ' ok: infra/unaccounted_claude_session, unaccounted_sessions 1, cost_usd ' + r.cost_usd + ', campaign stopped after ' + rows.length + ' row');
JS
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_cost":0.07}'; R13="$TEST_TMP/r13.jsonl"
CAP=2.2 cc --results "$R13" >"$TEST_TMP/r13.out" 2>"$TEST_TMP/r13.err"; rc=$?
[ "$rc" = 2 ] && grep -q 'stopping the campaign' "$TEST_TMP/r13.err" || { cat "$TEST_TMP/r13.err"; fail "unaccounted session must stop the campaign with exit 2 (rc=$rc)"; }
node "$TEST_TMP/unac.js" readable "$R13" || fail "unaccounted (readable, green)"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_cost":0.07,"sneak_unreadable":true}'; R14="$TEST_TMP/r14.jsonl"
CAP=2.2 cc --results "$R14" >/dev/null 2>&1
node "$TEST_TMP/unac.js" unreadable "$R14" || fail "unaccounted (unreadable, green)"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_g2_only":true,"sneak_cost":0.07,"hang_g2_base":true,"hang_report":true}'; R17="$TEST_TMP/r17.jsonl"
CAP=2.2 cc --results "$R17" >/dev/null 2>&1
node "$TEST_TMP/unac.js" timeout "$R17" || fail "unaccounted on a timed-out cell (green)"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_g2_only":true,"sneak_cost":0.07,"sneak_unreadable":true,"hang_g2_base":true,"hang_report":true}'; R19="$TEST_TMP/r19.jsonl"
CAP=2.2 cc --results "$R19" >/dev/null 2>&1
node "$TEST_TMP/unac.js" timeout-unreadable "$R19" || fail "unaccounted unreadable on a timed-out cell (green)"
ok "unaccounted sessions detected and the campaign stopped"

echo "=== 5h. hand wrapper: simultaneous launches share one budget under a lock; BUDGET without OUT is refused ==="
cat >"$TEST_TMP/real-slow.sh" <<EOF
#!/bin/bash
echo "\$*" >>"$TEST_TMP/slow-calls.log"
sleep 1
printf '{"type":"result","session_id":"s%s","total_cost_usd":0.1}\n' "\$\$"
EOF
chmod +x "$TEST_TMP/real-slow.sh"
cat >"$TEST_TMP/ctest.js" <<'JS'
const fs = require('fs'); const cp = require('child_process'); const path = require('path');
const [evdir, tmp] = process.argv.slice(2);
const cc = require(path.join(evdir, 'd0gate', 'cc.js'));
const cell = { root: fs.mkdtempSync(path.join(tmp, 'ccell-')) };
const bin = cc.handWrapper(cell, path.join(tmp, 'real-slow.sh'));
const out = path.join(cell.root, 'hand-out.json'); fs.writeFileSync(out, '');
const log = path.join(tmp, 'slow-calls.log'); fs.writeFileSync(log, '');
const env = { ...process.env, D0GATE_HAND_OUT: out, D0GATE_HAND_BUDGET: '0.5', D0GATE_WRAPPER_TEST_DELAY: '1' };
const launch = () => new Promise((res) => { const c = cp.spawn(path.join(bin, 'claude'), ['-p'], { env }); c.on('close', (code) => res(code)); });
Promise.all([launch(), launch()]).then((codes) => {
  const budgets = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => Number(l.split(' ').pop()));
  const total = budgets.reduce((a, b) => a + b, 0);
  if (total > 0.5 + 1e-9) { console.log('LOCK MISSING: two simultaneous launches were authorised ' + JSON.stringify(budgets) + ' = ' + total.toFixed(2) + ' USD of a 0.5 USD cell budget'); process.exit(1); }
  console.log('simultaneous launches authorised ' + JSON.stringify(budgets) + ' = ' + total.toFixed(2) + ' USD <= 0.5; exit codes ' + JSON.stringify(codes));
});
JS
cat >"$TEST_TMP/otest.js" <<'JS'
const fs = require('fs'); const cp = require('child_process'); const path = require('path');
const [evdir, tmp] = process.argv.slice(2);
const cc = require(path.join(evdir, 'd0gate', 'cc.js'));
const cell = { root: fs.mkdtempSync(path.join(tmp, 'ocell-')) };
const bin = cc.handWrapper(cell, path.join(tmp, 'real-claude.sh'));
fs.writeFileSync(path.join(tmp, 'wrap-calls.log'), '');
const env = { ...process.env, D0GATE_HAND_BUDGET: '0.5' }; delete env.D0GATE_HAND_OUT;
const r = cp.spawnSync(path.join(bin, 'claude'), ['-p'], { env, cwd: cell.root, encoding: 'utf8' });
const called = fs.readFileSync(path.join(tmp, 'wrap-calls.log'), 'utf8').trim();
if (r.status !== 97 || !/D0GATE_HAND_OUT is not set/.test(r.stderr) || called) { console.log('BUDGET WITHOUT OUT NOT REFUSED CLEARLY: rc=' + r.status + ' stderr=' + JSON.stringify(r.stderr.trim()) + ' real claude called=' + JSON.stringify(called)); process.exit(1); }
console.log('budget without out: refused, exit 97, "' + r.stderr.trim() + '", the real claude was not called');
JS
cat >"$TEST_TMP/real-asst.sh" <<'EOF'
#!/bin/bash
echo '{"type":"assistant","message":"the words total_cost_usd appear here but this line reports no spend"}'
EOF
chmod +x "$TEST_TMP/real-asst.sh"
cat >"$TEST_TMP/stest.js" <<'JS'
const fs = require('fs'); const cp = require('child_process'); const path = require('path');
const [evdir, tmp] = process.argv.slice(2);
const cc = require(path.join(evdir, 'd0gate', 'cc.js'));
const cell = { root: fs.mkdtempSync(path.join(tmp, 'scell-')) };
const bin = cc.handWrapper(cell, path.join(tmp, 'real-asst.sh'));
const out = path.join(cell.root, 'hand-out.json'); fs.writeFileSync(out, '');
const r = cp.spawnSync(path.join(bin, 'claude'), ['-p'], { env: { ...process.env, D0GATE_HAND_OUT: out, D0GATE_HAND_BUDGET: '0.5' }, encoding: 'utf8' });
let resv = ''; try { resv = fs.readFileSync(out + '.resv', 'utf8').trim(); } catch (e) { /* none */ }
if (!/^\d+ 0\.5$/.test(resv)) { console.log('RESERVATION DROPPED WITHOUT A REPORTED SPEND: rc=' + r.status + ' reservation file=' + JSON.stringify(resv) + ' (want "<id> 0.5" kept: only an assistant line mentions total_cost_usd)'); process.exit(1); }
console.log('reservation kept (' + resv + '): a line that only mentions total_cost_usd is not a reported spend');
JS
node "$TEST_TMP/stest.js" "$EV" "$TEST_TMP" || fail "settlement criterion (green)"
node "$TEST_TMP/ctest.js" "$EV" "$TEST_TMP" || fail "wrapper lock (green)"
node "$TEST_TMP/otest.js" "$EV" "$TEST_TMP" || fail "wrapper budget without out (green)"
ok "hand wrapper lock and missing OUT"

echo "=== 5i. rail failure status is infra even when classify finds nothing; the label is classify's cause ==="
setcfg '{"hand_fail":true}'; R15="$TEST_TMP/r15.jsonl"; seed_on "$R15"
CAP=2.2 cc --results "$R15" >/dev/null 2>&1; [ -s "$R15" ] || fail "failure run wrote nothing"
node "$TEST_TMP/tmo2.js" g4failure "$R15" || fail "failure status (green)"
setcfg '{"hand_silent":true}'; R16="$TEST_TMP/r16.jsonl"; seed_on "$R16"
CAP=2.2 cc --results "$R16" >/dev/null 2>&1; [ -s "$R16" ] || fail "silent run wrote nothing"
node "$TEST_TMP/tmo2.js" g4empty "$R16" || fail "empty output label (green)"
setcfg '{"hand_quota":true}'; R18="$TEST_TMP/r18.jsonl"; seed_on "$R18"
CAP=2.2 cc --results "$R18" >"$TEST_TMP/r18.out" 2>"$TEST_TMP/r18.err"; rc=$?
[ "$rc" = 2 ] && grep -q 'stopping the campaign: quota' "$TEST_TMP/r18.err" || { cat "$TEST_TMP/r18.err"; K="$R18.cells/g4-hand-effect/gate-on/1"; cat "$K/rail-stdout.json" "$K/rail-stderr.log" "$K/hand-out.json" 2>&1 | head -c 1500; tail -1 "$R18" | head -c 600; fail "a non-timeout quota failure must stop the campaign (rc=$rc)"; }
node "$TEST_TMP/tmo2.js" g4quota "$R18" || fail "quota failure row (green)"
cat >"$TEST_TMP/btest.js" <<'JS'
const path = require('path');
const cc = require(path.join(process.argv[2], 'd0gate', 'cc.js'));
const cases = [ // [rail status, ON arm, a block record exists, expected]
  ['failure', true, true, true], ['committed', true, true, true], ['no_op', true, true, true], ['dirty', true, true, true],
  ['engine_unavailable', true, true, false], ['something_new', true, true, false],
  ['failure', false, true, false], ['failure', true, false, false],
];
const bad = cases.filter(([st, on, blk, want]) => cc.blockedTimeoutApplies(st, on, blk) !== want).map((c) => c.slice(0, 3).join('/') + ' want ' + c[3]);
if (bad.length) { console.log('BLOCKED-TIMEOUT EXCEPTION WRONG: ' + bad.join(' ; ')); process.exit(1); }
console.log('blocked-timeout exception: applies only to ON + a block + (a scorable state or failure); engine_unavailable and unknown states stay infra (' + cases.length + ' cases)');
JS
node "$TEST_TMP/btest.js" "$EV" || fail "blocked-timeout whitelist (green)"
ok "failure status and cause labels"

echo "=== 6. negative controls: three runner copies each with ONE line broken, RED before the real runner is GREEN ==="
FARM="$TEST_TMP/farm"; rm -rf "$FARM"; mkdir -p "$FARM/evals"; cp -R "$EV" "$FARM/evals/skill-onoff"
for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do b="$(basename "$e")"; case "$b" in evals|.git) ;; *) [ -e "$e" ] && ln -s "$e" "$FARM/$b";; esac; done  # the rail finds ../src from its own dir
FEV="$FARM/evals/skill-onoff"
brk() { local f="$1" before; before="$(sha256sum "$f" | cut -d' ' -f1)"; node -e 'const fs=require("fs"); const [f,from,to]=process.argv.slice(1); const t=fs.readFileSync(f,"utf8"); if(!t.includes(from)){console.error("pattern not found: "+from); process.exit(1);} fs.writeFileSync(f, t.split(from).join(to));' "$@" || fail "negative control: could not plant the break"; [ "$before" != "$(sha256sum "$f" | cut -d' ' -f1)" ] || fail "negative control: nothing changed ($2)"; }
# (a) an unfinished cell that drops its marker boolean (and the runner's own shape guard switched off)
brk "$FEV/d0gate/cc.js" "{ markers: { [D0_MARKER[c.task]]: false }," "{ markers: {},"
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
setcfg '{"cost_per_turn":0.1}'; : >"$FLOG"
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
brk "$FEV/d0gate/cc.js" "const blocked = blockedTimeoutApplies(" "const blocked = false && blockedTimeoutApplies("
setcfg '{"hang_hand_on":true,"hang_hand_off":true}'; : >"$FLOG"
RD="$TEST_TMP/rd.jsonl"; cp "$R4.seed" "$RD" 2>/dev/null || node -e 'const fs=require("fs"); const r=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).slice(0,6).map((l)=>JSON.stringify({ ...JSON.parse(l), cost_usd: 0.05 })); fs.writeFileSync(process.argv[2], r.join("\n")+"\n");' "$R2" "$RD"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$RD" >/dev/null 2>&1
if node "$TEST_TMP/tmo.js" x "$RD" >"$TEST_TMP/rd.out" 2>&1; then fail "RED control (d) was NOT caught: $(cat "$TEST_TMP/rd.out")"; fi
grep -q '"failure_cause":"runner_timeout"' "$RD" || fail "RED control (d) went red for the wrong reason (no runner_timeout row): $(cat "$TEST_TMP/rd.out")"
echo "RED (expected) (d) timeout always infra: $(cat "$TEST_TMP/rd.out")"
# (e) the pilot lock removed
brk "$FEV/run-d0gate-campaign.js" "return ceiling; } // pilot lock" "return Number(text); } // pilot lock"
setcfg '{"cost_per_turn":0.22}'; : >"$FLOG"
CAP=5 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/re.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/lock.js" x "$TEST_TMP/re.jsonl" >"$TEST_TMP/re.out" 2>&1; then fail "RED control (e) was NOT caught: $(cat "$TEST_TMP/re.out")"; fi
echo "RED (expected) (e) pilot lock removed: $(cat "$TEST_TMP/re.out")"
# (f) the depth-0 wrapper lets the claude through instead of refusing
brk "$FEV/d0gate/cc.js" "'exit 97'," "'PATH=\"\${PATH#*:}\" exec claude \"\$@\"',"
setcfg '{"cost_per_turn":0.05,"nested":true}'; : >"$FLOG"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rf.jsonl" --limit 1 >/dev/null 2>&1
if node "$TEST_TMP/acct.js" nested "$FLOG" "$TEST_TMP/rf.jsonl" >"$TEST_TMP/rf.out" 2>&1; then fail "RED control (f) was NOT caught: $(cat "$TEST_TMP/rf.out")"; fi
echo "RED (expected) (f) wrapper lets nested claude through: $(cat "$TEST_TMP/rf.out")"
# (g) the attempts are no longer recorded
brk "$FEV/d0gate/cc.js" "'echo \"attempt: \$*\" >>\"\$D0GATE_NESTED_LOG\"'," "':',"
setcfg '{"cost_per_turn":0.05,"nested":true}'; : >"$FLOG"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rg.jsonl" --limit 1 >/dev/null 2>&1
if node "$TEST_TMP/acct.js" nested "$FLOG" "$TEST_TMP/rg.jsonl" >"$TEST_TMP/rg.out" 2>&1; then fail "RED control (g) was NOT caught: $(cat "$TEST_TMP/rg.out")"; fi
echo "RED (expected) (g) attempts not recorded: $(cat "$TEST_TMP/rg.out")"
# (l) the G4 hand wrapper hands every launch the full cell budget
brk "$FEV/d0gate/cc.js" 'args+=(--max-budget-usd "$rem")' 'args+=(--max-budget-usd "$D0GATE_HAND_BUDGET")'
if node "$TEST_TMP/wtest.js" "$FEV" "$TEST_TMP" >"$TEST_TMP/rl.out" 2>&1; then fail "RED control (l) was NOT caught: $(cat "$TEST_TMP/rl.out")"; fi
echo "RED (expected) (l) hand wrapper without cumulative budget: $(cat "$TEST_TMP/rl.out")"
# (h) the resume-cumulative switch forced off (cost = sum of the calls)
brk "$FEV/d0gate/cc.js" "ctx.P.cc.resume_cost_cumulative === true" "false"
setcfg '{"cost_per_turn":0.05}'; : >"$FLOG"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rh.jsonl" --limit 1 >/dev/null 2>&1
if node "$TEST_TMP/acct.js" cost "$FLOG" "$TEST_TMP/rh.jsonl" 0.1 >"$TEST_TMP/rh.out" 2>&1; then fail "RED control (h) was NOT caught: $(cat "$TEST_TMP/rh.out")"; fi
echo "RED (expected) (h) last-packet cost replaced by the sum of the calls: $(cat "$TEST_TMP/rh.out")"
# (i) timed_out no longer forces the whole ceiling (G4)
brk "$FEV/d0gate/cc.js" "exit !== 137 && !timedOut;" "exit !== 137;"
setcfg '{"hang_hand_on":true,"hand_report_first":true,"hand_cost":0.01}'; seed_on "$TEST_TMP/ri.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/ri.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" g4cost "$TEST_TMP/ri.jsonl" >"$TEST_TMP/ri.out" 2>&1; then fail "RED control (i) was NOT caught: $(cat "$TEST_TMP/ri.out")"; fi
echo "RED (expected) (i) timed-out hand charged only what it reported: $(cat "$TEST_TMP/ri.out")"
# (j) the blocked-timeout exception goes back in front of classify
brk "$FEV/d0gate/cc.js" "if (hard) return fail(hard.cls, hard.cause, env0.error);" "if (hard && !(timedOut && on && Object.values(facts0.hook).some((recs) => recs.some((r) => r.decision === 'block')))) return fail(hard.cls, hard.cause, env0.error);"
setcfg '{"hang_hand_on":true,"hand_auth_error":true}'; seed_on "$TEST_TMP/rj.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rj.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" auth "$TEST_TMP/rj.jsonl" >"$TEST_TMP/rj.out" 2>&1; then fail "RED control (j) was NOT caught: $(cat "$TEST_TMP/rj.out")"; fi
echo "RED (expected) (j) exception before classify: $(cat "$TEST_TMP/rj.out")"
# (k) depth-0: a timed-out turn is charged only what it reported
brk "$FEV/d0gate/cc.js" "costTurnsKnown && !timedOut;" "costTurnsKnown;"
setcfg '{"hang_g2_base":true,"hang_report":true}'; : >"$TEST_TMP/rk.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rk.jsonl" --limit 3 >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" d0cost "$TEST_TMP/rk.jsonl" >"$TEST_TMP/rk.out" 2>&1; then fail "RED control (k) was NOT caught: $(cat "$TEST_TMP/rk.out")"; fi
echo "RED (expected) (k) depth-0 timeout charged only what it reported: $(cat "$TEST_TMP/rk.out")"
# new mutants start from a clean copy of the two runner files
restore() { cp "$EV/d0gate/cc.js" "$FEV/d0gate/cc.js"; cp "$EV/run-d0gate-campaign.js" "$FEV/run-d0gate-campaign.js"; }
# (m) after-the-fact detection of unaccounted sessions switched off
restore; brk "$FEV/d0gate/cc.js" "if (strays.length > 0) {" "if (false) {"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_cost":0.07}'
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rm.jsonl" --limit 1 >/dev/null 2>&1
if node "$TEST_TMP/unac.js" readable "$TEST_TMP/rm.jsonl" >"$TEST_TMP/rm.out" 2>&1; then fail "RED control (m) was NOT caught: $(cat "$TEST_TMP/rm.out")"; fi
echo "RED (expected) (m) detection off: $(cat "$TEST_TMP/rm.out")"
# (n) the lock around read-reserve removed
restore; brk "$FEV/d0gate/cc.js" "( flock 9; node -e" "( node -e"
if node "$TEST_TMP/ctest.js" "$FEV" "$TEST_TMP" >"$TEST_TMP/rn.out" 2>&1; then fail "RED control (n) was NOT caught: $(cat "$TEST_TMP/rn.out")"; fi
echo "RED (expected) (n) no lock: $(cat "$TEST_TMP/rn.out")"
# (o) BUDGET without OUT is no longer refused up front
restore; brk "$FEV/d0gate/cc.js" 'if [ -z "${D0GATE_HAND_OUT:-}" ]; then' 'if false; then'
if node "$TEST_TMP/otest.js" "$FEV" "$TEST_TMP" >"$TEST_TMP/ro.out" 2>&1; then fail "RED control (o) was NOT caught: $(cat "$TEST_TMP/ro.out")"; fi
echo "RED (expected) (o) missing OUT not refused: $(cat "$TEST_TMP/ro.out")"
# (p) failure status no longer forced to infra
restore; brk "$FEV/d0gate/cc.js" "if (!SCORABLE_RAIL.has(env0.status) && !timedOutAfterBlock) return fail('infra_fail', cg ? cg.cause : 'runner_error', env0.error);" ""
setcfg '{"hand_fail":true}'; seed_on "$TEST_TMP/rp.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rp.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" g4failure "$TEST_TMP/rp.jsonl" >"$TEST_TMP/rp.out" 2>&1; then fail "RED control (p) was NOT caught: $(cat "$TEST_TMP/rp.out")"; fi
echo "RED (expected) (p) failure status scored: $(cat "$TEST_TMP/rp.out")"
# (q) the unknown-cost label is always cost_unknown
restore; brk "$FEV/d0gate/cc.js" "return fail('infra_fail', cg.cause);" "return fail('infra_fail', 'cost_unknown');"
setcfg '{"hand_silent":true}'; seed_on "$TEST_TMP/rq.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rq.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" g4empty "$TEST_TMP/rq.jsonl" >"$TEST_TMP/rq.out" 2>&1; then fail "RED control (q) was NOT caught: $(cat "$TEST_TMP/rq.out")"; fi
echo "RED (expected) (q) label always cost_unknown: $(cat "$TEST_TMP/rq.out")"
# (r) an unfinished row keeps skill_invoked=true again (and the runner's own shape guard is off)
restore; brk "$FEV/d0gate/cc.js" "{ skill_invoked_observed: !!o.skillObserved } : {}" "{ skill_invoked_observed: !!o.skillObserved, skill_invoked: !!o.skillObserved } : {}"
brk "$FEV/d0gate/cc.js" "if (probs.length) throw" "if (false) throw"
setcfg '{"hang_g2_base":true,"hang_report":true}'; : >"$TEST_TMP/rr.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rr.jsonl" --limit 3 >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" d0cost "$TEST_TMP/rr.jsonl" >"$TEST_TMP/rr.out" 2>&1; then fail "RED control (r) was NOT caught: $(cat "$TEST_TMP/rr.out")"; fi
echo "RED (expected) (r) unfinished row keeps skill_invoked=true: $(cat "$TEST_TMP/rr.out")"
# (s) a stray session on a timed-out cell is added to the reported sum instead of to the cell's charge
restore; brk "$FEV/d0gate/cc.js" "o.cost + readable + ceiling * unreadableN" "mainCost + readable + ceiling * unreadableN"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_g2_only":true,"sneak_cost":0.07,"hang_g2_base":true,"hang_report":true}'
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rs.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/unac.js" timeout "$TEST_TMP/rs.jsonl" >"$TEST_TMP/rs.out" 2>&1; then fail "RED control (s) was NOT caught: $(cat "$TEST_TMP/rs.out")"; fi
echo "RED (expected) (s) stray on a timed-out cell undercharged: $(cat "$TEST_TMP/rs.out")"
# (t) quota/auth wording in a non-timeout failure is no longer looked at
restore; brk "$FEV/d0gate/cc.js" "(timedOut || !SCORABLE_RAIL.has(env0.status))" "timedOut"
setcfg '{"hand_quota":true}'; seed_on "$TEST_TMP/rt.jsonl"
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rt.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/tmo2.js" g4quota "$TEST_TMP/rt.jsonl" >"$TEST_TMP/rt.out" 2>&1; then fail "RED control (t) was NOT caught: $(cat "$TEST_TMP/rt.out")"; fi
echo "RED (expected) (t) quota text of a failure ignored: $(cat "$TEST_TMP/rt.out")"
# (u) settlement goes back to 'the word appears anywhere'
restore; brk "$FEV/d0gate/cc.js" "if node -e '\${settled}' \"\$PRIV\"; then" "if grep -q total_cost_usd \"\$PRIV\"; then"
if node "$TEST_TMP/stest.js" "$FEV" "$TEST_TMP" >"$TEST_TMP/ru.out" 2>&1; then fail "RED control (u) was NOT caught: $(cat "$TEST_TMP/ru.out")"; fi
echo "RED (expected) (u) settlement by the bare word: $(cat "$TEST_TMP/ru.out")"
# (s2) a timed-out cell with an unreadable stray: back to Math.max (the stray adds nothing)
restore; brk "$FEV/d0gate/cc.js" "cost: Number((o.cost + readable + ceiling * unreadableN).toFixed(6))" "cost: Number((unreadableN > 0 ? Math.max(ceiling, o.cost + readable) : o.cost + readable).toFixed(6))"
setcfg '{"cost_per_turn":0.05,"sneak":true,"sneak_g2_only":true,"sneak_cost":0.07,"sneak_unreadable":true,"hang_g2_base":true,"hang_report":true}'
CAP=2.2 RUNNER_JS="$FEV/run-d0gate-campaign.js" cc --results "$TEST_TMP/rs2.jsonl" >/dev/null 2>&1
if node "$TEST_TMP/unac.js" timeout-unreadable "$TEST_TMP/rs2.jsonl" >"$TEST_TMP/rs2.out" 2>&1; then fail "RED control (s2) was NOT caught: $(cat "$TEST_TMP/rs2.out")"; fi
echo "RED (expected) (s2) unreadable stray on a timed-out cell adds nothing: $(cat "$TEST_TMP/rs2.out")"
# (v) the blocked-timeout exception bypasses the rail-state whitelist
restore; brk "$FEV/d0gate/cc.js" "return eligible && on === true && hasBlock === true;" "return on === true && hasBlock === true;"
if node "$TEST_TMP/btest.js" "$FEV" >"$TEST_TMP/rv.out" 2>&1; then fail "RED control (v) was NOT caught: $(cat "$TEST_TMP/rv.out")"; fi
echo "RED (expected) (v) exception bypasses the whitelist: $(cat "$TEST_TMP/rv.out")"
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
