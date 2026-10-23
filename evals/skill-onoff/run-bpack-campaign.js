#!/usr/bin/env node
// run-bpack-campaign.js — bpack campaign: REVOKED: teaching (T1), dispatch-tree
// entry (T2), decision-card regression (T3) (prereg/bpack.json). Cells are serial and resumable via run-skill-onoff-matrix-bpack.sh.
//
//   run-bpack-campaign.js --results <file.jsonl> [--dry-run] [--check-arms]
//       [--model sonnet] [--runner cc|stub] [--arms base,change] [--reps N]
//       [--arms-dir <dir>] [--prereg <json>] [--pilot]
//
// Formal default: bpack-revoked, bpack-tree, dcard-owner-decision × {base,change} × 5
// = 30 cells. --pilot runs 5 cells only: bpack-revoked and bpack-tree 1 rep on both
// arms, plus dcard-owner-decision 1 rep on base. --pilot takes no --reps/--arms and
// does not score (a partial grid cannot PASS).
// Every cell: --check-skill ceo-agent, ONOFF_PROMPT_PREFIX from the prereg,
// ONOFF_LIB_OVERRIDE = lib-bpack (lib-bpack/bpack-markers.sh is built by the content
// hand), timeout 10m, scratch HOME (the eval runner).
// --dry-run prints the cell list and a cost estimate and never spawns the runner.
// It exits non-zero when the estimated total exceeds ONOFF_MAX_USD.
// --check-arms checks that base and change differ exactly in
// allowed_arm_difference.files (disk bytes, not only the manifest). A mutated
// pack copy fails the check. Neither flag spawns the runner.
// ONOFF_MAX_USD cap default 7. Before each live group, spent plus the group's
// estimate must stay inside the cap. After the matrix, score-bpack.js runs.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-bpack-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'bpack.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'bpack')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die('usage: run-bpack-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--runner cc|stub] [--arms base,change] [--reps N] [--pilot]');
let P;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`cannot read prereg ${preregPath}: ${e.message} (prereg/bpack.json is built by the content hand)`); }
const runner = val('--runner', 'cc');
const model = val('--model', P.model || 'sonnet');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PREFIX = P.invocation_prefix;
if (typeof PREFIX !== 'string' || !PREFIX.trim()) die('prereg.invocation_prefix is missing');
const LIB = path.join(HERE, 'lib-bpack');
const TIMEOUT = '10m';
const DEFAULT_TASKS = ['bpack-revoked', 'bpack-tree', 'dcard-owner-decision'];
const TASKS = Array.isArray(P.tasks) && P.tasks.length ? P.tasks : DEFAULT_TASKS;
const PILOT = flag('--pilot');
if (PILOT && (val('--reps') !== undefined || val('--arms') !== undefined)) die('--pilot fixes its own reps and arms; do not pass --reps/--arms');
// Per-cell USD estimate for the formal campaign (3 tasks × 2 arms × 5 reps
// = 30 cells). The gdorm pilot of 6 real base cells averaged 0.183 USD, so the
// guard uses 0.19. 30 × 0.19 = 5.70 USD, which stays at or under the 7 USD cap.
const COST_PER_CELL_USD = 0.19;
// dcard-owner-decision runs a second turn (turn2.sh), so a cell costs more. 0.30 is a
// placeholder until the pilot measures it. 20 cells * 0.19 + 10 cells * 0.30 = 6.80 USD.
const COST_BY_TASK = { 'dcard-owner-decision': 0.30 };
const cellCost = (task) => (Object.hasOwn(COST_BY_TASK, task) ? COST_BY_TASK[task] : COST_PER_CELL_USD);
const COST_BASIS = 'gdorm pilot of 6 real base cells averaged 0.183 USD, held at 0.19; 20 formal cells * 0.19 + 10 dcard-owner-decision cells (two turns) * 0.30 = 6.80 USD, pilot 4 * 0.19 + 0.30 = 1.06 USD, cap 7';

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
  return v === null ? cellCost(j.task_id) : v;
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
// Pilot: T1 and T2 one rep on both arms, T3 (the regression column) base only.
const PILOT_GROUPS = [
  { task: 'bpack-revoked', arms: ['base', 'change'], reps: 1 },
  { task: 'bpack-tree', arms: ['base', 'change'], reps: 1 },
  { task: 'dcard-owner-decision', arms: ['base'], reps: 1 },
];
const GROUPS = PILOT ? PILOT_GROUPS : TASKS.map((task) => ({ task, arms: ARMS, reps: REPS }));

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
    if (!String(id).includes('bpack')) throw new Error(`pack id lacks bpack prefix: ${id}`);
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = dig;
  }
  for (const id of asList(arm.files)) {
    if (!String(id).includes('bpack')) throw new Error(`pack id lacks bpack prefix: ${id}`);
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) {
      if (Object.hasOwn(out, rel) && out[rel] !== dig) throw new Error(`path ${rel} conflicts inside arm ${arm.arm}`);
      out[rel] = dig;
    }
  }
  for (const id of asList(arm.fixture_scripts)) {
    if (!String(id).includes('bpack')) throw new Error(`pack id lacks bpack prefix: ${id}`);
    packFiles(id, manifest);
  }
  return out;
}
function checkArms() {
  const problems = [];
  const manifest = readJson(path.join(packsDir, 'manifest.json'));
  const base = readJson(path.join(armsDir, 'base.json'));
  const change = readJson(path.join(armsDir, 'change.json'));
  for (const skill of ['ceo-agent', 'hetero-review', 'harness-maintenance']) {
    if (!(base.skills || {})[skill]) problems.push(`base missing skill ${skill}`);
    if (!(change.skills || {})[skill]) problems.push(`change missing skill ${skill}`);
  }
  // The REVIEW_PROMPT.md pack is T1's treatment, so it is the one fixture pack allowed to
  // differ: each arm names exactly its own fixture-prompt pack, everything else must be
  // equal, and the two prompt packs may differ by exactly one added REVOKED: line.
  const isPrompt = (id) => /^fixture-prompt-bpack-/.test(id);
  const promptBase = asList(base.fixture_scripts).filter(isPrompt);
  const promptChange = asList(change.fixture_scripts).filter(isPrompt);
  if (promptBase.join() !== 'fixture-prompt-bpack-base') problems.push('base fixture_scripts must name exactly fixture-prompt-bpack-base');
  if (promptChange.join() !== 'fixture-prompt-bpack-change') problems.push('change fixture_scripts must name exactly fixture-prompt-bpack-change');
  if (JSON.stringify(asList(base.fixture_scripts).filter((x) => !isPrompt(x))) !== JSON.stringify(asList(change.fixture_scripts).filter((x) => !isPrompt(x)))) problems.push('fixture_scripts differ between base and change beyond the fixture-prompt packs');
  if (promptBase.length === 1 && promptChange.length === 1) {
    try {
      const fb = packFiles(promptBase[0], manifest);
      const fc = packFiles(promptChange[0], manifest);
      const names = [...new Set([...Object.keys(fb), ...Object.keys(fc)])];
      let added = 0;
      for (const f of names) {
        if (fb[f] === fc[f]) continue;
        if (!fb[f] || !fc[f]) { problems.push(`fixture prompt pack file ${f} exists in only one arm`); continue; }
        const lb = fs.readFileSync(path.join(packsDir, promptBase[0], f), 'utf8').split('\n');
        const lc = fs.readFileSync(path.join(packsDir, promptChange[0], f), 'utf8').split('\n');
        // change must equal base with exactly one extra line inserted, and that line teaches REVOKED:
        let i = 0;
        while (i < lb.length && i < lc.length && lb[i] === lc[i]) i++;
        const extra = lc[i];
        const rest = lc.slice(i + 1).join('\n') === lb.slice(i).join('\n');
        if (lc.length !== lb.length + 1 || !rest || !/REVOKED:/.test(extra || '')) problems.push(`fixture prompt pack file ${f} differs beyond one added REVOKED: line`);
        else added++;
      }
      if (added !== 1) problems.push(`fixture prompt packs must differ by exactly one REVOKED: line (found ${added})`);
    } catch (e) { problems.push(e.message); }
  }
  if (!asList(base.fixture_scripts).includes('fixture-scripts-bpack') || !asList(change.fixture_scripts).includes('fixture-scripts-bpack')) problems.push('base fixture_scripts must include fixture-scripts-bpack');
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
  const cost = Number(rows.reduce((a, r) => a + cellCost(r.key.split('|')[0]), 0).toFixed(2));
  console.log(JSON.stringify({
    dry_run: true, pilot: PILOT, row: P.row, model, runner, cells_total: rows.length,
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
const keep = path.join(path.dirname(path.resolve(resultsPath)), 'bpack-cells');
for (const g of GROUPS) {
  const spent = spentUsd(resultsPath);
  const groupCost = g.arms.length * g.reps * cellCost(g.task);
  if (spent + groupCost > CAP + 1e-9) {
    die(`spend cap: spent ${money(spent).toFixed(2)} USD so far; next group ${g.task} [${g.arms.join(',')}] x ${g.reps} costs ${money(groupCost).toFixed(2)} USD; cap ${money(CAP).toFixed(2)} USD; refusing to dispatch`, 1);
  }
  console.log(`== task ${g.task}: [${g.arms.join(',')}] x ${g.reps}`);
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix-bpack.sh'),
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
if (PILOT) {
  console.log('pilot done: 5 cells, not scored (a partial grid cannot PASS). Read the rows by hand.');
  process.exit(0);
}
const s = cp.spawnSync('node', [path.join(HERE, 'score-bpack.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
