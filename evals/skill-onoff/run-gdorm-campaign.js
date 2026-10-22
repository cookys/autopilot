#!/usr/bin/env node
// run-gdorm-campaign.js — gdorm task-tree / qc-panel / ledger-archive campaign
// (prereg/gdorm.json, status draft). Cells are serial and resumable via
// run-skill-onoff-matrix.sh. The change arm is intentionally empty.
//
//   run-gdorm-campaign.js --results <file.jsonl> [--dry-run] [--check-arms]
//       [--model sonnet] [--runner cc|stub] [--arms base,change] [--reps N]
//       [--arms-dir <dir>] [--prereg <json>]
//
// Formal default: gdorm-tree, gdorm-qcpanel, gdorm-archive × {base,change} × 10.
// Pilot: --reps 1 --arms base.
// Every cell: --check-skill ceo-agent, ONOFF_PROMPT_PREFIX from the prereg,
// ONOFF_LIB_OVERRIDE = lib-gdorm, timeout 10m, scratch HOME (the eval runner).
// --dry-run prints the cell list and a cost estimate and never spawns the runner.
// --check-arms checks the frozen base packs and that the change arm is still
// the empty placeholder. Neither flag spawns the runner.
// ONOFF_MAX_USD cap default 7. Before each live group, spent plus the group's
// estimate must stay inside the cap.
'use strict';
const fs = require('fs');
const path = require('path');
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
// Per-cell USD upper bound for the formal campaign (3 tasks × 2 arms × 10 reps
// = 60 cells). dcard-v3 used 0.20 USD/cell because those cells opened a card and
// took a second turn (35 × 0.20 = 7.00). A gdorm cell is one headless turn that
// plans or runs one script, so this uses a lower bound that still clears the
// observed dcard per-cell floor of about 0.11 USD (6.3 USD / 55 rows = 0.1145,
// rounded down only after cutting the second turn). 60 × 0.11 = 6.60 USD, which
// stays at or under the 7 USD cap. Basis: one-turn sonnet cell, capped from the
// dcard row's 6.3 USD / 55 rows, not from a gdorm receipt (none exists yet).
const COST_PER_CELL_USD = 0.11;
const COST_BASIS = 'one-turn cell, from the dcard row 6.3 USD / 55 rows (0.1145) held at 0.11; 60 formal cells * 0.11 = 6.60 USD, cap 7';

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
  if (raw === undefined) return P.reps || 10;
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

const REPS = flag('--check-arms') && !resultsPath ? (P.reps || 10) : parseReps();
const ARMS = flag('--check-arms') && !resultsPath ? ['base', 'change'] : parseArms();
const GROUPS = TASKS.map((task) => ({ task, arms: ARMS, reps: REPS }));

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function checkArms() {
  const problems = [];
  const basePath = path.join(armsDir, 'base.json');
  if (!fs.existsSync(basePath)) problems.push('base.json missing');
  else {
    const base = readJson(basePath);
    const manifest = readJson(path.join(packsDir, 'manifest.json'));
    const packs = manifest.packs || {};
    for (const skill of ['ceo-agent', 'quality-pipeline', 'hetero-review']) {
      const id = (base.skills || {})[skill];
      if (!id) problems.push(`base missing skill ${skill}`);
      else if (!packs[id]) problems.push(`pack not in manifest: ${id}`);
      else if (!String(id).includes('gdorm')) problems.push(`pack id lacks gdorm prefix: ${id}`);
    }
    const ids = [].concat(base.files || [], base.fixture_scripts || []);
    for (const id of ids) {
      if (!packs[id]) problems.push(`pack not in manifest: ${id}`);
      else if (!String(id).includes('gdorm')) problems.push(`pack id lacks gdorm prefix: ${id}`);
    }
    if (![].concat(base.fixture_scripts || []).includes('fixture-scripts-gdorm')) {
      problems.push('base fixture_scripts must include fixture-scripts-gdorm');
    }
  }
  if (fs.existsSync(path.join(armsDir, 'change.json'))) {
    problems.push('change.json must stay absent until the gtext lane freezes wording');
  }
  const notePath = path.join(armsDir, 'README.md');
  let note = '';
  try { note = fs.readFileSync(notePath, 'utf8'); } catch { note = ''; }
  if (!/intentionally empty/i.test(note) || !/gtext/i.test(note)) {
    problems.push('arms/gdorm/README.md must say the change arm is intentionally empty and waits for the gtext lane');
  }
  return { ok: problems.length === 0, problems, change: 'empty' };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message], change: 'empty' }; }
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
  process.exit(0);
}

if (ARMS.includes('change')) die('change arm is intentionally empty and waits for the gtext lane; refuse to dispatch it');
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
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix.sh'),
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
console.log('gdorm draft has no scorer; thresholds are null until depth-0 sets them after the pilot');
process.exit(0);
