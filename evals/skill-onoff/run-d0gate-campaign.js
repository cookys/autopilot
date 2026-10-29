#!/usr/bin/env node
// run-d0gate-campaign.js - d0gate row (BL-0306 P3): the ON/OFF evaluation of the depth-0 per-turn-gate arming paragraph
// (candidates/depth0-gate-arming.md) against prereg/d0gate.json. U1 = INSTRUMENT ONLY: nothing here can spend money.
//
//   run-d0gate-campaign.js --results <file.jsonl> [--dry-run] [--pilot] [--runner stub|cc] [--model sonnet]
//       [--pilot-results <file.jsonl>] [--scenario good|dead-gate|no-effect|costly-on] [--reps N] [--prereg <json>]
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
// --runner cc is NOT wired in U1: every guard below is checked first (arms, stamp, pilot rows, cap), then it stops. U2 wires it.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-d0gate-campaign: ${m}`); process.exit(code); };
const USAGE = 'usage: run-d0gate-campaign.js --results <file.jsonl> [--dry-run] [--pilot] [--runner stub|cc] [--model sonnet] [--pilot-results <jsonl>] [--scenario good|dead-gate|no-effect|costly-on] [--reps N]  |  --check-arms [--prereg <json>] [--arms-dir <dir>]';
const resultsPath = val('--results');
const preregPath = path.resolve(val('--prereg', path.join(HERE, 'prereg', 'd0gate.json')));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'd0gate')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die(USAGE);
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
  die('--runner cc is not wired in U1 (instrument only, no spend); U2 wires the cell runner. All guards above passed.');
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
