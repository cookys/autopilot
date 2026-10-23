#!/usr/bin/env node
// run-gdorm-campaign.js — gdorm task-tree / qc-panel / ledger-archive campaign
// (prereg/gdorm.json). Cells are serial and resumable via run-skill-onoff-matrix-gdorm.sh.
//
//   run-gdorm-campaign.js --results <file.jsonl> [--dry-run] [--check-arms]
//       [--model sonnet] [--runner cc|stub] [--arms base,change] [--reps N]
//       [--arms-dir <dir>] [--prereg <json>]
//
// Formal default: gdorm-tree, gdorm-qcpanel, gdorm-archive × {base,change} × 5.
// Pilot: --reps 1 --arms base.
// Every cell: --check-skill ceo-agent, ONOFF_PROMPT_PREFIX from the prereg,
// ONOFF_LIB_OVERRIDE = lib-gdorm, timeout 10m, scratch HOME (the eval runner).
// --dry-run prints the cell list and a cost estimate and never spawns the runner.
// It exits non-zero when the estimated total exceeds ONOFF_MAX_USD.
// --check-arms checks that base and change differ exactly in
// allowed_arm_difference.files (disk bytes, not only the manifest). A mutated
// pack copy fails the check. Neither flag spawns the runner.
// ONOFF_MAX_USD cap default 7. Before each live group, spent plus the group's
// estimate must stay inside the cap. After the matrix, score-gdorm.js runs.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-gdorm-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'gdorm.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'gdorm')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die('usage: run-gdorm-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--runner cc|stub] [--arms base,change] [--reps N]');
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const runner = val('--runner', 'cc');
const model = val('--model', P.model || 'sonnet');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PREFIX = P.invocation_prefix;
if (typeof PREFIX !== 'string' || !PREFIX.trim()) die('prereg.invocation_prefix is missing');
const LIB = path.join(HERE, 'lib-gdorm');
const TIMEOUT = '10m';
const TASKS = Array.isArray(P.tasks) && P.tasks.length ? P.tasks : ['gdorm-tree', 'gdorm-qcpanel', 'gdorm-archive'];
// Per-cell USD estimate for the formal campaign (3 tasks × 2 arms × 5 reps
// = 30 cells). A pilot of 6 real base cells averaged 0.183 USD, so the guard
// uses 0.19. 30 × 0.19 = 5.70 USD, which stays at or under the 7 USD cap.
const COST_PER_CELL_USD = 0.19;
const COST_BASIS = 'pilot of 6 real base cells averaged 0.183 USD, held at 0.19; 30 formal cells * 0.19 = 5.70 USD, cap 7';

function maxUsd() {
  const raw = process.env.ONOFF_MAX_USD;
  if (raw === undefined || String(raw).trim() === '') return 7;
  const text = String(raw).trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) die('usage: ONOFF_MAX_USD must be a positive number');
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) die('usage: ONOFF_MAX_USD must be a positive number');
  return n;
}
function finiteNum(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function priceRow(j) {
  let v = finiteNum(j.cost_usd);
  if (v === null && j.usage && typeof j.usage === 'object') {
    v = finiteNum(j.usage.cost_usd);
    if (v === null) v = finiteNum(j.usage.cost);
  }
  if (v === null) v = finiteNum(j.cost);
  return v === null ? COST_PER_CELL_USD : v;
}
function spentUsd(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let sum = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j !== 'object' || typeof j.task_id !== 'string') continue;
    if (typeof j.row === 'string' && j.row !== P.row) continue;
    sum += priceRow(j);
  }
  return sum;
}
function money(n) { return Number(n.toFixed(2)); }

function parseReps() {
  const raw = val('--reps');
  if (raw === undefined) return P.reps || 5;
  if (!/^[0-9]+$/.test(String(raw)) || Number(raw) < 1) die('--reps must be a positive integer');
  return Number(raw);
}
function parseArms() {
  const raw = val('--arms', 'base,change');
  const arms = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (!arms.length) die('--arms must name at least one arm');
  for (const a of arms) if (!['base', 'change'].includes(a)) die(`unknown arm: ${a}`);
  return arms;
}

const REPS = flag('--check-arms') && !resultsPath ? (P.reps || 5) : parseReps();
const ARMS = flag('--check-arms') && !resultsPath ? ['base', 'change'] : parseArms();
const GROUPS = TASKS.map((task) => ({ task, arms: ARMS, reps: REPS }));

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function asList(v) { return [].concat(v || []); }
function packFiles(id, manifest) {
  const files = (manifest.packs || {})[id];
  if (!files) throw new Error(`pack not in manifest.json: ${id}`);
  const out = {};
  for (const [rel, digest] of Object.entries(files)) {
    const disk = fs.readFileSync(path.join(packsDir, rel));
    const got = sha256(disk);
    if (got !== digest) throw new Error(`digest mismatch ${rel}`);
    out[rel.slice(id.length + 1)] = got;
  }
  return out;
}
function merged(arm, manifest) {
  const out = {};
  for (const [skill, id] of Object.entries(arm.skills || {})) {
    if (!String(id).includes('gdorm')) throw new Error(`pack id lacks gdorm prefix: ${id}`);
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = dig;
  }
  for (const id of asList(arm.files)) {
    if (!String(id).includes('gdorm')) throw new Error(`pack id lacks gdorm prefix: ${id}`);
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) {
      if (Object.hasOwn(out, rel) && out[rel] !== dig) throw new Error(`path ${rel} conflicts inside arm ${arm.arm}`);
      out[rel] = dig;
    }
  }
  for (const id of asList(arm.fixture_scripts)) {
    if (!String(id).includes('gdorm')) throw new Error(`pack id lacks gdorm prefix: ${id}`);
    packFiles(id, manifest);
  }
  return out;
}
function checkArms() {
  const problems = [];
  const manifest = readJson(path.join(packsDir, 'manifest.json'));
  const base = readJson(path.join(armsDir, 'base.json'));
  const change = readJson(path.join(armsDir, 'change.json'));
  for (const skill of ['ceo-agent', 'quality-pipeline', 'hetero-review', 'distill', 'retro']) {
    if (!(base.skills || {})[skill]) problems.push(`base missing skill ${skill}`);
    if (!(change.skills || {})[skill]) problems.push(`change missing skill ${skill}`);
  }
  if (JSON.stringify(base.fixture_scripts) !== JSON.stringify(change.fixture_scripts)) problems.push('fixture_scripts differ between base and change');
  if (!asList(base.fixture_scripts).includes('fixture-scripts-gdorm')) problems.push('base fixture_scripts must include fixture-scripts-gdorm');
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const mb = merged(base, manifest);
  const mc = merged(change, manifest);
  const differing = [];
  for (const f of new Set([...Object.keys(mb), ...Object.keys(mc)])) if (mb[f] !== mc[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message], differing: [] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

const CAP = maxUsd();

if (flag('--dry-run')) {
  const { done, fails } = (() => {
    const doneSet = new Set();
    const failsMap = new Map();
    let text = '';
    try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const k = `${j.task_id}|${j.arm}|${j.rep}`;
      if (j.failure_class === null || j.failure_class === undefined) doneSet.add(k); else failsMap.set(k, (failsMap.get(k) || 0) + 1);
    }
    return { done: doneSet, fails: failsMap };
  })();
  const rows = [];
  for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
    const key = `${g.task}|${arm}|${rep}`;
    const status = done.has(key) ? 'done' : (fails.get(key) || 0) >= 3 ? 'exhausted' : 'todo';
    rows.push({ status, key });
    console.log(`${status.padEnd(9)} ${key}`);
  }
  const cost = Number((rows.length * COST_PER_CELL_USD).toFixed(2));
  console.log(JSON.stringify({
    dry_run: true, row: P.row, model, runner, cells_total: rows.length,
    cells_todo: rows.filter((r) => r.status === 'todo').length,
    cost_estimate_usd: cost, cost_basis: COST_BASIS,
    max_usd: CAP, spent_usd: money(spentUsd(resultsPath)),
    invocation_prefix: PREFIX, lib: LIB, timeout: TIMEOUT, check_skill: 'ceo-agent',
  }));
  if (cost > CAP + 1e-9) {
    die(`spend cap: estimate ${cost.toFixed(2)} USD for ${rows.length} cells exceeds ONOFF_MAX_USD ${money(CAP).toFixed(2)} USD`, 1);
  }
  process.exit(0);
}

if (runner === 'cc') {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message] }; }
  if (!r.ok) die(`--check-arms failed: ${r.problems.join('; ')}`);
}
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const keep = path.join(path.dirname(path.resolve(resultsPath)), 'gdorm-cells');
for (const g of GROUPS) {
  const spent = spentUsd(resultsPath);
  const groupCost = g.arms.length * g.reps * COST_PER_CELL_USD;
  if (spent + groupCost > CAP + 1e-9) {
    die(`spend cap: spent ${money(spent).toFixed(2)} USD so far; next group ${g.task} [${g.arms.join(',')}] x ${g.reps} costs ${money(groupCost).toFixed(2)} USD; cap ${money(CAP).toFixed(2)} USD; refusing to dispatch`, 1);
  }
  console.log(`== task ${g.task}: [${g.arms.join(',')}] x ${g.reps}`);
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix-gdorm.sh'),
    '--model', model, '--reps', String(g.reps), '--results', path.resolve(resultsPath),
    '--tasks', g.task, '--arms', g.arms.join(','), '--runner', runner, '--arm-manifests', armsDir, '--check-skill', 'ceo-agent'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ONOFF_PROMPT_PREFIX: PREFIX,
      ONOFF_TIMEOUT: process.env.ONOFF_TIMEOUT_OVERRIDE || TIMEOUT,
      ONOFF_LIB_OVERRIDE: LIB,
      ONOFF_KEEP_CELLS_DIR: keep,
    },
  });
  if (r.status !== 0) die(`matrix failed for ${g.task} [${g.arms.join(',')}] (exit ${r.status})`);
}
const s = cp.spawnSync('node', [path.join(HERE, 'score-gdorm.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
