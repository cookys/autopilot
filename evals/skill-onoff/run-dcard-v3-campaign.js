#!/usr/bin/env node
// run-dcard-v3-campaign.js — dcard-v3 owner-decision campaign (prereg/dcard-v3.json).
// Same cell runner as run-dcard-campaign.js, including the nohook group.
// Change packs are the dcard-v2 change3 overlay. Markers come from lib-dcard-v3.
//
//   run-dcard-v3-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet]
//       [--runner cc|stub] [--arms-dir <dir>] [--prereg <json>]
//
// Cells, serial, resumable per cell via run-skill-onoff-matrix.sh:
//   dcard-owner-decision × {base,change} × 10
//   a2-within-doa        × {base,change} × 5
//   dcard-owner-decision × {nohook}      × 5
// Every cell: --check-skill ceo-agent, ONOFF_PROMPT_PREFIX = prereg.invocation_prefix,
// ONOFF_LIB_OVERRIDE = lib-dcard-v3 (a2's lib-r2 markers and dcard-markers.sh), timeout 10m.
// The matrix writes <results>.runner-pin. After the matrix, score-dcard.js with this prereg;
// exit code is the scorer's.
// --dry-run lists cells and spends nothing (it never spawns the runner). It prints
// max_usd (ONOFF_MAX_USD, default 7.00) and spent_usd. --check-arms:
// base and change differ exactly in allowed_arm_difference.files; nohook differs from
// base only by the hook pack. Neither flag spawns the runner.
// Before each live group, spend so far (every attempt row in the results file for this
// campaign, failures included, actual cost_usd / usage.cost when present, otherwise
// COST_PER_CELL_USD) plus that group's cell count times COST_PER_CELL_USD must stay
// within the cap. Over the cap, the group is not dispatched.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-dcard-v3-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'dcard-v3.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'dcard-v3')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die('usage: run-dcard-v3-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--runner cc|stub] [--arms-dir <dir>]');
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const runner = val('--runner', 'cc');
const model = val('--model', P.model || 'sonnet');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PREFIX = P.invocation_prefix;
if (typeof PREFIX !== 'string' || !PREFIX.trim()) die('prereg.invocation_prefix is missing');
const LIB = path.join(HERE, 'lib-dcard-v3');
const TIMEOUT = '10m';
// Per-cell USD upper bound. The dcard-v2 campaign cost about 5.75 USD for 30 cells plus a
// pilot (5.75/30 = 0.1917). The dcard row cost about 6.3 USD for 55 rows including retries
// (6.3/55 = 0.1145). This uses the higher rate, rounded up to 0.20 USD/cell.
// 35 cells * 0.20 = 7.00 USD.
const COST_PER_CELL_USD = 0.2;
const COST_BASIS = 'max(5.75 USD / 30 dcard-v2 cells, 6.3 USD / 55 dcard rows) rounded up to 0.20 USD/cell';

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

const GROUPS = [
  { task: 'dcard-owner-decision', arms: [P.arms.off, P.arms.on], reps: P.reps },
  { task: 'a2-within-doa', arms: [P.arms.off, P.arms.on], reps: (P.control && P.control.reps) || 5 },
  { task: 'dcard-owner-decision', arms: [P.negative_control.arm], reps: P.negative_control.reps },
];

function packFiles(id, manifest) {
  const files = (manifest.packs || {})[id];
  if (!files) throw new Error(`pack not in manifest.json: ${id}`);
  const out = {};
  for (const [rel, digest] of Object.entries(files)) out[rel.slice(id.length + 1)] = digest;
  return out;
}
function asList(v) { return [].concat(v || []); }
function readArm(name) { return JSON.parse(fs.readFileSync(path.join(armsDir, `${name}.json`), 'utf8')); }

function merged(arm, manifest) {
  const out = {};
  for (const [skill, id] of Object.entries(arm.skills || {})) {
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = dig;
  }
  for (const id of asList(arm.files)) {
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) {
      if (Object.hasOwn(out, rel) && out[rel] !== dig) throw new Error(`path ${rel} conflicts inside arm ${arm.arm}`);
      out[rel] = dig;
    }
  }
  for (const id of asList(arm.fixture_scripts)) packFiles(id, manifest);
  return out;
}

function checkArms() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8'));
  const base = readArm(P.arms.off);
  const change = readArm(P.arms.on);
  const problems = [];
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const mb = merged(base, manifest);
  const mc = merged(change, manifest);
  const differing = [];
  for (const f of new Set([...Object.keys(mb), ...Object.keys(mc)])) if (mb[f] !== mc[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  if (JSON.stringify(base.fixture_scripts) !== JSON.stringify(change.fixture_scripts)) problems.push('fixture_scripts differ between base and change');
  if (JSON.stringify(base.skills) === JSON.stringify(change.skills) && JSON.stringify(base.files) === JSON.stringify(change.files)) problems.push('base and change manifests are identical');
  const nohook = readArm(P.negative_control.arm);
  const skillsSame = JSON.stringify(base.skills) === JSON.stringify(nohook.skills);
  const fxSame = JSON.stringify(base.fixture_scripts) === JSON.stringify(nohook.fixture_scripts);
  if (!skillsSame) problems.push('nohook skills differ from base');
  if (!fxSame) problems.push('nohook fixture_scripts differ from base');
  const bFiles = new Set(asList(base.files));
  const nFiles = new Set(asList(nohook.files));
  const onlyB = [...bFiles].filter((x) => !nFiles.has(x));
  const onlyN = [...nFiles].filter((x) => !bFiles.has(x));
  if (onlyB.length !== 1 || onlyN.length !== 1) problems.push(`nohook must differ from base in exactly one hook pack (only base: ${onlyB.join(',') || 'none'}; only nohook: ${onlyN.join(',') || 'none'})`);
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, differing: [], problems: [e.message] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

const CAP = flag('--check-arms') ? null : maxUsd();

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

if (runner === 'cc') {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message] }; }
  if (!r.ok) die(`--check-arms failed: ${r.problems.join('; ')}`);
}
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const keep = path.join(path.dirname(path.resolve(resultsPath)), 'dcard-v3-cells');
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
const s = cp.spawnSync('node', [path.join(HERE, 'score-dcard.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
