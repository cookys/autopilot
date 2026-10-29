#!/usr/bin/env node
// run-d0gate-campaign.js - d0gate row (BL-0306 P3): the ON/OFF evaluation of the depth-0 per-turn-gate arming paragraph
// (candidates/depth0-gate-arming.md) against prereg/d0gate.json. U1 = INSTRUMENT ONLY: nothing here can spend money.
//
//   run-d0gate-campaign.js --results <file.jsonl> [--dry-run] [--pilot] [--runner stub|cc] [--model sonnet]
//       [--pilot-results <file.jsonl>] [--scenario good|dead-gate|no-effect|costly-on] [--reps N] [--prereg <json>] [--limit N]
//   run-d0gate-campaign.js --print-runner-pin [--pilot]
//   run-d0gate-campaign.js --check-arms [--prereg <json>] [--arms-dir <dir>]
//
// Grid (formal, 40 cells): G1 constrained, G2 unconstrained, G3 wrong list = depth-0 Sonnet cells x {base,change} x 5;
// G4 hand effect = claude-native hand cells (Haiku) x {gate-off,gate-on} x 5. Pilot (9 cells, Haiku, not scored): G1-G3 one
// rep on both arms; G4 gate-off 2 reps, gate-on 1 rep.
// --dry-run prints the cell list and the estimate; it exits 1 when estimate x 1.5 exceeds the cap (ONOFF_MAX_USD, default
// and ceiling = prereg max_usd_default = 20; a larger ONOFF_MAX_USD is refused). --check-arms checks that base and change
// differ exactly in allowed_arm_difference.files, and that the one difference is the candidate paragraph inserted verbatim.
// --runner stub runs every cell through the stub dispatch (real arm / gate-verify / hook, deterministic worker, scenario agent)
// with a PATH sentinel in front of every runner binary; it proves the wiring and never a model's behaviour (rows say runner:stub
// and the scorer refuses them unless D0GATE_ALLOW_STUB_ROWS=1).
// --runner cc (U2) runs the real cells (d0gate/cc.js): every guard below is checked first (arms, stamp, pilot rows, runner pin, cap),
// then each todo cell is dispatched under its own budget. --limit N runs at most N cells this invocation (stage a paid run).
//   --print-runner-pin prints the pin value to write into the prereg (claude version, models, rail digest); it changes nothing.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const os = require('os');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-d0gate-campaign: ${m}`); process.exit(code); };
const USAGE = 'usage: run-d0gate-campaign.js --results <file.jsonl> [--dry-run] [--pilot] [--runner stub|cc] [--model sonnet] [--pilot-results <jsonl>] [--scenario good|dead-gate|no-effect|costly-on] [--reps N] [--limit N]  |  --check-arms [--prereg <json>] [--arms-dir <dir>]  |  --print-runner-pin [--pilot]';
const resultsPath = val('--results');
const preregPath = path.resolve(val('--prereg', path.join(HERE, 'prereg', 'd0gate.json')));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'd0gate')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms') && !flag('--print-runner-pin')) die(USAGE);
let P;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`cannot read prereg ${preregPath}: ${e.message}`); }
const runner = val('--runner', 'cc');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PILOT = flag('--pilot');
const SCENARIO = val('--scenario', 'good');
if (!['good', 'dead-gate', 'no-effect', 'costly-on'].includes(SCENARIO)) die('--scenario must be good|dead-gate|no-effect|costly-on');
if (val('--scenario') !== undefined && runner !== 'stub') die('--scenario applies to --runner stub only');
if (val('--reps') !== undefined && (runner !== 'stub' || PILOT)) die('--reps applies to a formal --runner stub run only (the formal grid is fixed by the prereg)');
const REPS = val('--reps') !== undefined ? Number(val('--reps')) : P.reps;
if (!Number.isInteger(REPS) || REPS < 1) die('reps must be a positive integer');
const model = val('--model', PILOT ? P.pilot_model : P.model);
const T = { G1: 'g1-constrained', G2: 'g2-unconstrained', G3: 'g3-wrong-list', G4: 'g4-hand-effect' };

// ---------------------------------------------------------------- cells and cost
function cells() {
  const out = [];
  if (PILOT) {
    for (const t of [T.G1, T.G2, T.G3]) for (const arm of ['base', 'change']) out.push({ task: t, arm, rep: 1 });
    out.push({ task: T.G4, arm: 'gate-off', rep: 1 }, { task: T.G4, arm: 'gate-off', rep: 2 }, { task: T.G4, arm: 'gate-on', rep: 1 });
    return out;
  }
  for (const t of [T.G1, T.G2, T.G3]) for (const arm of ['base', 'change']) for (let rep = 1; rep <= REPS; rep++) out.push({ task: t, arm, rep });
  for (const arm of ['gate-off', 'gate-on']) for (let rep = 1; rep <= REPS; rep++) out.push({ task: T.G4, arm, rep });
  return out;
}
const costTable = () => (PILOT ? P.pilot.cost_per_cell_usd : P.cost_per_cell_usd);
function cellCost(c) {
  const t = costTable();
  const k = c.task === T.G4 ? `${c.task}:${c.arm}` : c.task;
  if (!Object.hasOwn(t, k)) die(`no cost_per_cell_usd for ${k}`);
  return t[k];
}
const money = (n) => Number(n.toFixed(2));
function capUsd() {
  const ceiling = PILOT ? P.pilot.max_usd : P.max_usd_default;
  const raw = process.env.ONOFF_MAX_USD;
  if (raw === undefined || String(raw).trim() === '') return ceiling;
  const text = String(raw).trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text) || Number(text) <= 0) die('usage: ONOFF_MAX_USD must be a positive number');
  // A pilot is locked INSIDE the program to the prereg pilot ceiling (pilot.max_usd): a larger ONOFF_MAX_USD is lowered, not trusted.
  if (PILOT && Number(text) > ceiling + 1e-9) { console.log(`ONOFF_MAX_USD ${text} is above the pilot ceiling; locked to ${ceiling} USD (prereg pilot.max_usd)`); return ceiling; } // pilot lock
  if (Number(text) > ceiling + 1e-9) die(`ONOFF_MAX_USD ${text} exceeds the pre-registered ceiling ${ceiling} USD (${PILOT ? 'pilot.max_usd' : 'max_usd_default'}); the cap is never raised`);
  return Number(text);
}
function spentUsd(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let sum = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j.task_id !== 'string' || (typeof j.row === 'string' && j.row !== P.row)) continue;
    sum += Number.isFinite(j.cost_usd) ? j.cost_usd : cellCost({ task: j.task_id, arm: j.arm });
  }
  return sum;
}

// ---------------------------------------------------------------- arms
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const asList = (v) => [].concat(v || []);
function packFiles(id, manifest) {
  const files = (manifest.packs || {})[id];
  if (!files) throw new Error(`pack not in manifest.json: ${id}`);
  const out = {};
  for (const [rel, digest] of Object.entries(files)) {
    const got = sha256(fs.readFileSync(path.join(packsDir, rel)));
    if (got !== digest) throw new Error(`digest mismatch ${rel}`);
    out[rel.slice(id.length + 1)] = got;
  }
  return out;
}
// armTree(arm): the plugin tree an arm loads, {target path -> absolute source file}, every source digest-checked by packFiles.
function armTree(armName) {
  const manifest = readJson(path.join(packsDir, 'manifest.json'));
  const arm = readJson(path.join(armsDir, `${armName}.json`));
  const out = {};
  for (const [skill, id] of Object.entries(arm.skills || {})) for (const rel of Object.keys(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = path.join(packsDir, id, rel);
  for (const id of asList(arm.files)) for (const rel of Object.keys(packFiles(id, manifest))) out[rel] = path.join(packsDir, id, rel);
  return out;
}
function merged(arm, manifest) {
  const out = {};
  for (const [skill, id] of Object.entries(arm.skills || {})) for (const [rel, d] of Object.entries(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = d;
  for (const id of asList(arm.files)) for (const [rel, d] of Object.entries(packFiles(id, manifest))) out[rel] = d;
  for (const id of asList(arm.fixture_scripts)) packFiles(id, manifest); // verified; identical across arms (checked below)
  return out;
}
function checkArms() {
  const problems = [];
  const manifest = readJson(path.join(packsDir, 'manifest.json'));
  const base = readJson(path.join(armsDir, 'base.json'));
  const change = readJson(path.join(armsDir, 'change.json'));
  if (JSON.stringify(Object.keys(base.skills || {})) !== '["ceo-agent"]' || JSON.stringify(Object.keys(change.skills || {})) !== '["ceo-agent"]') problems.push('each arm must load exactly the ceo-agent skill');
  if (JSON.stringify(asList(base.fixture_scripts)) !== JSON.stringify(asList(change.fixture_scripts))) problems.push('fixture_scripts differ between base and change (they must be byte-identical packs)');
  for (const id of ['fixture-scripts-d0gate', 'fixture-stubs-d0gate']) if (!asList(base.fixture_scripts).includes(id)) problems.push(`fixture_scripts must include ${id}`);
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const mb = merged(base, manifest);
  const mc = merged(change, manifest);
  const differing = [];
  for (const f of new Set([...Object.keys(mb), ...Object.keys(mc)])) if (mb[f] !== mc[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  // the one difference must be the candidate paragraph inserted verbatim before "## Startup" (so P4 can ship it byte for byte)
  try {
    const skill = 'skills/ceo-agent/SKILL.md';
    const bText = fs.readFileSync(path.join(packsDir, base.skills['ceo-agent'], 'SKILL.md'), 'utf8');
    const cText = fs.readFileSync(path.join(packsDir, change.skills['ceo-agent'], 'SKILL.md'), 'utf8');
    const cand = fs.readFileSync(path.join(HERE, 'candidates', 'depth0-gate-arming.md'), 'utf8');
    const marker = '\n## Startup\n';
    if (bText.split(marker).length !== 2) problems.push('base SKILL.md: the insertion marker is not unique');
    else if (bText.replace(marker, `\n${cand}${marker}`) !== cText) problems.push(`${skill}: change is not base plus the candidate paragraph inserted before "## Startup"`);
  } catch (e) { problems.push(`candidate insertion check: ${e.message}`); }
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}
if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message], differing: [] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

// ---------------------------------------------------------------- runner pin
const REPO_ROOT = path.resolve(HERE, '..', '..');
const RAIL_FILES = ['scripts/dispatch-hetero.sh', 'scripts/per-turn-gate-arm.js', 'scripts/gate-verify.js', 'hooks/per-turn-gate.js', 'scripts/lib/seed-claude-config.js'];
function railDigest() {
  const h = crypto.createHash('sha256');
  const files = {};
  for (const f of RAIL_FILES) {
    const b = fs.readFileSync(path.join(REPO_ROOT, f));
    files[f] = sha256(b);
    h.update(`${f}\0`).update(b);
  }
  return { digest: h.digest('hex'), files };
}
function claudeVersion() {
  const r = cp.spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? String(r.stdout || '').split('\n')[0].trim() : '';
}
// The pin value a formal run must match: the CLI version, both model ids and one digest over the real rail files the G4 cells run.
function runnerPinValue(ver) {
  return `${ver}; depth0 ${P.model}; hand ${P.g4_model}; rail sha256:${railDigest().digest}`;
}
if (flag('--print-runner-pin')) {
  const ver = claudeVersion();
  if (!ver) die('claude --version printed nothing (is claude on PATH?); cannot print the runner pin', 3);
  const rd = railDigest();
  console.log(JSON.stringify({ runner_pin_value: runnerPinValue(ver), claude_version: ver, models: { depth0: P.model, hand: P.g4_model, pilot: P.pilot_model }, rail_digest: rd.digest, rail_files: rd.files,
    note: 'write runner_pin_value into prereg runner_pin.value BEFORE stamping; a formal --runner cc run refuses any other value. Nothing was changed by this command.' }));
  process.exit(0);
}

// ---------------------------------------------------------------- dry run
const CAP = capUsd();
const GRID = cells();
const estimate = money(GRID.reduce((a, c) => a + cellCost(c), 0));
const key = (c) => `${c.task}|${c.arm}|${c.rep}`;
function doneKeys(file) {
  const done = new Set();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return done; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.failure_class === null || j.failure_class === undefined) done.add(`${j.task_id}|${j.arm}|${j.rep}`);
  }
  return done;
}
if (flag('--dry-run')) {
  const done = doneKeys(resultsPath);
  for (const c of GRID) console.log(`${(done.has(key(c)) ? 'done' : 'todo').padEnd(9)} ${key(c)}`);
  console.log(JSON.stringify({
    dry_run: true, pilot: PILOT, row: P.row, status: P.status, model, runner, cells_total: GRID.length,
    cells_todo: GRID.filter((c) => !done.has(key(c))).length, cost_estimate_usd: estimate, cost_estimate_x1_5_usd: money(estimate * 1.5),
    max_usd: CAP, spent_usd: money(spentUsd(resultsPath)), cost_basis: P.cost_basis,
  }));
  if (estimate * 1.5 > CAP + 1e-9) die(`spend cap: estimate ${estimate.toFixed(2)} USD x 1.5 = ${(estimate * 1.5).toFixed(2)} USD for ${GRID.length} cells exceeds ONOFF_MAX_USD ${CAP.toFixed(2)} USD`, 1);
  process.exit(0);
}

// ---------------------------------------------------------------- live guards (cc): everything is checked before anything runs
function stamped() {
  const r = cp.spawnSync(process.execPath, [path.join(HERE, 'stamp-prereg.js'), '--row', P.row, '--check'], { encoding: 'utf8' });
  return r.status === 0;
}
function pilotScorable(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let n = 0;
  for (const line of text.split('\n')) { try { const j = JSON.parse(line); if (j && j.pilot === true && (j.failure_class === null || j.failure_class === undefined) && j.row === P.row) n++; } catch { /* skip */ } }
  return n;
}
if (runner === 'cc') {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message] }; }
  if (!r.ok) die(`--check-arms failed: ${r.problems.join('; ')}`);
  if (!PILOT) {
    if (!/^stamped/.test(String(P.status))) die('refusing a formal run: the prereg is not stamped (status is not "stamped ...")');
    if (!stamped()) die('refusing a formal run: stamp-prereg.js --check is not green');
    const pr = val('--pilot-results');
    if (!pr || pilotScorable(pr) < 1) die('refusing a formal run: --pilot-results must hold at least one scorable pilot row of this row');
  }
  runCc();
}
function runCc() {
  const CC = P.cc || {};
  for (const k of ['timeout_s', 'hand_outer_timeout_s']) if (!Number.isInteger(CC[k]) || CC[k] < 1) die(`prereg cc.${k} missing or not a positive integer`);
  if (typeof CC.hand_timeout !== 'string' || !CC.hand_timeout) die('prereg cc.hand_timeout missing');
  if (typeof CC.disallowed_tools !== 'string' || !CC.disallowed_tools.split(/[ ,]+/).includes('ScheduleWakeup')) die('prereg cc.disallowed_tools missing or does not name ScheduleWakeup');
  if (typeof P.invocation_prefix !== 'string' || !P.invocation_prefix.trim()) die('prereg invocation_prefix missing');
  const cc = require('./d0gate/cc');
  const claudeBin = cc.whichClaude('/nonexistent');
  if (!claudeBin) die('claude is not on PATH', 2);
  const ver = claudeVersion();
  if (!ver) die('claude --version printed nothing; cannot pin the runner', 3);
  if (!PILOT) {
    const pin = P.runner_pin && P.runner_pin.value;
    if (typeof pin !== 'string' || !pin) die('refusing a formal run: prereg runner_pin.value is not set (run --print-runner-pin, write the value in, then stamp)', 3);
    if (pin !== runnerPinValue(ver)) die(`refusing a formal run: runner pin differs (prereg: ${pin}; now: ${runnerPinValue(ver)})`, 3);
  }
  // credentials: the operator's, copied per cell; the cell config dir never holds anything else
  const srcConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  if (!fs.existsSync(path.join(srcConfigDir, '.credentials.json'))) die(`no .credentials.json under ${srcConfigDir}; log in first (the cells copy it, they never use the real config dir)`, 3);
  // the claude-native rail needs the owner's one-time confirmation (only the owner records it; this runner never does)
  let confirmedAt = '';
  if (GRID.some((c) => c.task === T.G4)) {
    const st = cp.spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'run-approval.js'), 'claude-native-status'], { encoding: 'utf8' });
    try { confirmedAt = JSON.parse(st.stdout).confirmed_at || ''; } catch { confirmedAt = ''; }
    if (st.status !== 0 || !confirmedAt) die('the claude-native implementer is not confirmed by the owner (node scripts/run-approval.js claude-native-status exits non-zero); ask the owner once, they run confirm-claude-native; this runner never does', 3);
  }
  const abs = path.resolve(resultsPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const rowsOf = () => {
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { return []; }
    return text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  };
  const foreign = rowsOf().filter((j) => (j.pilot === true) !== PILOT || (typeof j.row === 'string' && j.row !== P.row));
  if (foreign.length) die(`results file holds ${foreign.length} row(s) of another scope (pilot flag or row); use one results file per pilot and per formal run`);
  const fails = () => { const m = new Map(); for (const j of rowsOf()) if (j.failure_class !== null && j.failure_class !== undefined) m.set(`${j.task_id}|${j.arm}|${j.rep}`, (m.get(`${j.task_id}|${j.arm}|${j.rep}`) || 0) + 1); return m; };
  const todo = () => { const d = doneKeys(abs); const f = fails(); return GRID.filter((c) => !d.has(key(c)) && (f.get(key(c)) || 0) < 3); };
  const spent0 = spentUsd(abs);
  const startEstimate = todo().reduce((a, c) => a + cellCost(c), 0);
  if (spent0 + startEstimate > CAP + 1e-9) die(`spend cap: spent ${money(spent0)} USD + remaining estimate ${money(startEstimate)} USD exceeds ONOFF_MAX_USD ${money(CAP)} USD`, 1);
  const limit = val('--limit') !== undefined ? Number(val('--limit')) : Infinity;
  if (!(limit >= 1)) die('--limit must be a positive integer');
  const keepRoot = `${abs}.cells`;
  const ctx = {
    P, pilot: PILOT, d0Model: model, g4Model: PILOT ? P.pilot_model : P.g4_model, runnerVersion: ver, srcConfigDir, confirmedAt,
    realClaude: claudeBin, railScript: path.join(REPO_ROOT, 'scripts', 'dispatch-hetero.sh'), armTree,
    changeSha: sha256(fs.readFileSync(path.join(armsDir, 'change.json'))),
  };
  let ran = 0;
  for (const c of todo()) {
    if (ran >= limit) { console.log(`--limit ${limit} reached; ${todo().length} cell(s) still todo`); break; }
    const spent = spentUsd(abs);
    // Hard cap: a cell whose ceiling (3 x its unit estimate) does not fit in what is left is not dispatched; one that fits runs under
    // --max-budget-usd min(remaining, ceiling), so its own spend cannot pass the ceiling.
    const ceiling = money(3 * cellCost(c));
    const remaining = CAP - spent;
    if (remaining + 1e-9 < ceiling) die(`spend cap: ${money(remaining)} USD left of ONOFF_MAX_USD ${money(CAP)} USD is below the ${money(ceiling)} USD cell ceiling of ${key(c)}; refusing to dispatch (spent ${money(spent)} USD)`, 1);
    const budget = Number(Math.min(remaining, ceiling).toFixed(4));
    console.log(`== cell ${key(c)} (budget ${budget} USD)`);
    const row = cc.runCell(ctx, c, ceiling, budget, path.join(keepRoot, c.task, c.arm, String(c.rep)));
    fs.appendFileSync(abs, `${JSON.stringify(row)}\n`);
    ran++;
    console.log(`   -> ${row.failure_class ? `${row.failure_class}/${row.failure_cause}` : 'scored'} cost ${row.cost_usd} USD ${JSON.stringify(row.markers || row.g4)}`);
    if (row.failure_cause === 'unaccounted_claude_session') die(`stopping the campaign: ${key(c)} left ${row.unaccounted_sessions} claude session(s) the cell did not start itself (a depth-0 agent ran its own claude); the row is recorded as infra, cost ${row.cost_usd} USD`, 2);
    if (row.failure_class && ['quota', 'authentication'].includes(row.failure_cause)) die(`stopping the campaign: ${row.failure_cause} failure on ${key(c)}`, 2);
  }
  console.log(JSON.stringify({ runner: 'cc', pilot: PILOT, model, ran, spent_usd: money(spentUsd(abs)), max_usd: CAP, todo: todo().length }));
  if (PILOT) { console.log('pilot done: cc cells, not scored (a partial grid cannot PASS; pilot rates check wiring only).'); process.exit(0); }
  if (todo().length) { console.log(`formal grid incomplete (${todo().length} cell(s) todo); not scoring`); process.exit(0); }
  const sc = cp.spawnSync(process.execPath, [path.join(HERE, 'score-d0gate.js'), '--prereg', preregPath, '--results', abs], { encoding: 'utf8' });
  process.stderr.write(sc.stderr || '');
  process.stdout.write(sc.stdout || '');
  process.exit(sc.status === null ? 2 : sc.status);
}

// ---------------------------------------------------------------- stub run
const { Cell, makeSentinel } = require('./d0gate/cell');
const TR = require('./d0gate/traces');
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const sentinel = makeSentinel(fs.mkdtempSync(path.join(require('os').tmpdir(), 'd0gate-sentinel-')));
const changeSha = sha256(fs.readFileSync(path.join(armsDir, 'change.json')));
const done = doneKeys(resultsPath);
let ran = 0;
for (const c of GRID) {
  if (done.has(key(c))) continue;
  const cell = new Cell({ sentinel }).init();
  try {
    TR.stubAgent(cell, c, SCENARIO);
    const row = TR.scoreCell(cell, c);
    const d0 = c.task !== T.G4;
    const cost = c.task === T.G4 ? (c.arm === 'gate-on' && SCENARIO === 'costly-on' ? 0.24 : 0.15) : 0;
    const out = {
      row: P.row, ...row, model: d0 ? model : P.g4_model, pilot: PILOT, runner: 'stub', failure_class: null,
      ...(d0 ? { skill_invoked: true } : {}), cost_usd: cost, ...(c.arm === 'change' ? { arm_manifest_sha256: changeSha } : {}),
    };
    fs.appendFileSync(resultsPath, `${JSON.stringify(out)}\n`);
    ran++;
    console.log(`cell ${key(c)} ${JSON.stringify(d0 ? out.markers : out.g4)}`);
  } finally { cell.destroy(); }
}
TR.dropCells();
const calls = sentinel.calls();
console.log(`stub run done: ${ran} cell(s); runner sentinel log lines: ${calls.length}`);
if (calls.length) die(`the runner sentinel recorded ${calls.length} call(s): ${calls.join(' ; ')}`, 1);
if (PILOT) { console.log('pilot (stub) done: not scored.'); process.exit(0); }
const s = cp.spawnSync(process.execPath, [path.join(HERE, 'score-d0gate.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8', env: { ...process.env, D0GATE_ALLOW_STUB_ROWS: '1' } });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
