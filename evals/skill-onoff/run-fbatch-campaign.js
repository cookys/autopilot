#!/usr/bin/env node
// run-fbatch-campaign.js — findings-batch ON/OFF row (plan §4): fb-mid-batch (T1),
// fb-pool (T2), fb-critical-guard (T3, regression), fb-deadman (T4a invalid draft + T4b valid
// completion, one cell, two markers) x {base,change} x 5 (plan v3 §3-4).
//
//   run-fbatch-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--pilot]
//       [--runner stub|cc] [--model haiku|sonnet] [--arms base,change] [--reps N] [--prereg <json>]
//       [--arms-dir <dir>]
//
// --model: cell model. Default = prereg model (sonnet); --pilot defaults to prereg pilot_model
// (haiku, v3 option (b): pilot rates check wiring only and are never reused for V2/V3).
//
// Same flag contract as run-bpack-campaign.js. --dry-run ALSO needs --results (usage error
// otherwise, although it never spawns anything). --dry-run and --check-arms never spend.
// --runner stub scores deterministic stub cells (no model). --runner cc is NOT wired in this
// P0 tooling unit: it refuses (exit 2); the paid run is P1 and needs the owner's cap approval.
// --pilot = T1, T2, T4 one rep on both arms (6 cells), not scored.
// ONOFF_MAX_USD default 20; --dry-run exits 1 when the estimate exceeds it.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./fbatch/lib');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-fbatch-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const USAGE = 'usage: run-fbatch-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--pilot] [--runner stub|cc] [--model haiku|sonnet] [--arms base,change] [--reps N]';
if (!resultsPath && !flag('--check-arms')) die(USAGE);
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'findings-batch.json'));
let P;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`cannot read prereg ${preregPath}: ${e.message}`); }
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'fbatch', 'arms')));
const runner = val('--runner', 'stub');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PILOT = flag('--pilot');
const MODEL = val('--model', PILOT ? (P.pilot_model || P.model) : P.model);
if (!['haiku', 'sonnet'].includes(MODEL)) die('--model must be haiku|sonnet');
if (PILOT && (val('--reps') !== undefined || val('--arms') !== undefined)) die('--pilot fixes its own reps and arms; do not pass --reps/--arms');

function parseReps() {
  const raw = val('--reps');
  if (raw === undefined) return P.reps || 5;
  if (!/^[0-9]+$/.test(String(raw)) || Number(raw) < 1) die('--reps must be a positive integer');
  return Number(raw);
}
function parseArms() {
  const arms = String(val('--arms', 'base,change')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!arms.length) die('--arms must name at least one arm');
  for (const a of arms) if (!['base', 'change'].includes(a)) die(`unknown arm: ${a}`);
  return arms;
}
const cellCost = (task) => (P.cost_per_cell_usd || {})[task] ?? 0.19;
function maxUsd() {
  const raw = process.env.ONOFF_MAX_USD;
  if (raw === undefined || String(raw).trim() === '') return P.max_usd_default || 20;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(String(raw).trim()) || Number(raw) <= 0) die('usage: ONOFF_MAX_USD must be a positive number');
  return Number(raw);
}

// Whitelist design: any FINDINGS-file token in an arm is a problem unless its whole clause is an approved sentence.
const FINDINGS_FILE_TOKEN = /findings\.[a-z0-9]+\b|findings\s+(report\s+)?(file|doc|document)s?\b|findings\s+report\b/i;
const norm = (t) => t.replace(/\s+/g, ' ').trim();
const clauseKey = (c) => norm(c).toLowerCase().replace(/^([-*]|\d+[.)])?\s*/, '').replace(/[.\s]+$/, '');
// Split on lines BEFORE whitespace normalisation: a bullet line starts a new clause; a plain line continues the
// previous one (so a sentence wrapped across lines stays whole); a blank line ends it.
function lineClauses(txt) {
  const out = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) { cur = null; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line) || cur === null) { cur = [line]; out.push(cur); } else cur.push(line);
  }
  return out.map((c) => c.join(' '));
}
const APPROVED_CLAUSES = new Set([
  'Never write a FINDINGS file',
  'Do not create a FINDINGS file',
  'Never ask a Claude subagent to write a FINDINGS file',
  'Depth 0 writes them to the registry (a name that is not a report-shaped FINDINGS file)',
].map(clauseKey));

function checkArms() {
  const problems = [];
  const a = L.loadArms(armsDir);
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const names = new Set([...Object.keys(a.base), ...Object.keys(a.change)]);
  const differing = [];
  for (const f of names) if (a.base[f] !== a.change[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  // The late-input rule: no arm may ask a Claude subagent to Write a FINDINGS file.
  for (const arm of ['base', 'change']) {
    for (const [f, txt] of Object.entries(a[arm])) {
      // Collapse newlines/runs of spaces first, so a token or sentence split across lines cannot hide.
      for (const clause of lineClauses(txt).flatMap((c) => norm(c).split(/;|\.(?=\s|$)/))) {
        if (!(FINDINGS_FILE_TOKEN.test(clause) || /\bFINDINGS\b/.test(clause))) continue;
        if (APPROVED_CLAUSES.has(clauseKey(clause))) continue;
        problems.push(`${arm}/${f}: mentions a FINDINGS file outside the approved sentences: ${clause.trim()}`);
      }
    }
  }
  if (!/text/.test(a.change['code-review.md'] || '')) problems.push('change arm must say lanes return findings as text');
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message], differing: [] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

const REPS = parseReps();
const ARMS = parseArms();
const GROUPS = PILOT
  ? P.pilot_tasks.map((task) => ({ task, arms: ['base', 'change'], reps: 1 }))
  : P.tasks.map((task) => ({ task, arms: ARMS, reps: REPS }));
const CAP = maxUsd();
// A pilot run reads pilot rows of its own model; the formal run reads only non-pilot rows of the formal model.


function readRows() {
  let text = '';
  try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
  const rows = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* skip */ } }
  return rows;
}

// Formal-run view: pilot rows and rows from another model are never counted (pilot rates are never reused for V2/V3).
const scoredRows = () => readRows().filter((j) => (PILOT ? j.pilot === true : j.pilot !== true) && j.model === MODEL);

if (flag('--dry-run')) {
  const done = new Set(scoredRows().filter((j) => !j.failure_class).map((j) => `${j.task_id}|${j.arm}|${j.rep}`));
  const keys = [];
  for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
    const key = `${g.task}|${arm}|${rep}`;
    keys.push(key);
    console.log(`${done.has(key) ? 'done' : 'todo'}`.padEnd(9) + ` ${key}`);
  }
  const cost = Number(keys.reduce((s, k) => s + cellCost(k.split('|')[0]), 0).toFixed(2));
  console.log(JSON.stringify({
    dry_run: true, pilot: PILOT, row: P.row, model: MODEL, runner, cells_total: keys.length,
    cells_todo: keys.filter((k) => !done.has(k)).length, cost_estimate_usd: cost,
    cost_basis: 'two-turn T1/T2 cells 0.30, single-turn T3/T4 cells 0.19 (plan §4); the pilot average replaces this',
    max_usd: CAP,
  }));
  if (cost > CAP + 1e-9) die(`spend cap: estimate ${cost.toFixed(2)} USD exceeds ONOFF_MAX_USD ${CAP.toFixed(2)} USD`, 1);
  process.exit(0);
}

if (runner === 'cc') die('--runner cc is not wired in this P0 tooling unit; the paid run (P1) needs the owner to approve the cap');
const chk = checkArms();
if (!chk.ok) die(`--check-arms failed: ${chk.problems.join('; ')}`);
const arms = L.loadArms(armsDir);
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const have = new Set(scoredRows().filter((j) => !j.failure_class).map((j) => `${j.task_id}|${j.arm}|${j.rep}`));
for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
  if (have.has(`${g.task}|${arm}|${rep}`)) continue;
  const { markers } = L.stubCell(g.task, arm, L.armText(arms[arm]));
  fs.appendFileSync(resultsPath, `${JSON.stringify({ row: P.row, pilot: PILOT, model: MODEL, task_id: g.task, arm, rep, runner: 'stub', failure_class: null, skill_invoked: true, cost_usd: 0, markers })}\n`);
}
if (PILOT) { console.log('pilot done: stub cells, not scored (a partial grid cannot PASS).'); process.exit(0); }
const controls = L.negativeControls(arms);
const v = L.verdict(scoredRows(), controls, REPS, P.row);
console.log(JSON.stringify({ controls, ...v }));
process.exit(v.verdict === 'PASS' ? 0 : 1);
