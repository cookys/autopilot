#!/usr/bin/env node
// run-stage-graph-campaign.js — one command for the stage-graph guidance eval (plan
// docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P5 item 7; frozen rule prereg/stage-graph.{md,json}).
//
//   run-stage-graph-campaign.js --results <file.jsonl> [--dry-run] [--model sonnet] [--reps 3]
//       [--arms change,red] [--with-base] [--skip-generic] [--runner cc|stub] [--arms-dir <dir>] [--prereg <json>]
//
// Cells (all through run-skill-onoff-matrix.sh, so the campaign is resumable by cell: re-run the same command
// after any interruption; a `failure_class` row re-runs, max 3 recorded attempts per cell):
//   * stage-graph tasks (the prereg's 12) x --arms (default change,red; --with-base adds base, reported not gated)
//     x reps; each arm is a multi-pack arm manifest <arms-dir>/<arm>.json (freeze-guidance-arm.js; the red arm
//     is the rotated planted-red). Prompt prefix `Use dev-flow:` (ONOFF_PROMPT_PREFIX, amend-1-invocation; task.md bytes stay frozen).
//   * the generic-marker regression the prereg requires: the 7 prereg `generic.tasks` x {base,change} x reps,
//     each task group under the exact conditions of the row that registered it (fixture-scripts pack of that row,
//     ONOFF_PROMPT_PREFIX of amendments 2/3, marker lib of amendment 2/4) with the sg fixture scripts overlaid
//     (the arm's own manifest pack, later = wins), so the only variable is base vs change guidance.
// After the matrix: score-stage-graph.js score (change >= 10/12, red <= 4/12, generic non-regression — the
// generic check lives inside that scorer, counts.generic) and its verdict JSON is printed; exit code = scorer's
// (0 SHIP · 3 NOT-SHIP · 4 STOP · 5 INSTRUMENT-INVALID).
// --dry-run: prints the cell list (done/todo per cell) and an estimated cost; spends nothing, needs no packs.
// Model must equal the prereg's model (sonnet) unless --runner stub (tests).
// Cost basis: results/batch-log.txt holds the measured per-cell cost of the 74 sonnet cells of the earlier
// skill-onoff rows (mean ~ $0.135, max ~ $0.52). The stage-graph cells walk several stages with a 16-skill catalog,
// so their TYPICAL cost is assumed 2x the measured mean (an assumption, not a measurement); low/high bracket
// it with the measured mean and the measured max. Generic cells use the measured mean (same shape as the rows measured).
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m) => { console.error(`run-stage-graph-campaign: ${m}`); process.exit(2); };
const resultsPath = val('--results');
if (!resultsPath) die('usage: run-stage-graph-campaign.js --results <file.jsonl> [--dry-run] [--model sonnet] [--reps 3] [--arms change,red] [--with-base] [--skip-generic] [--runner cc|stub]');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'stage-graph.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'stage-graph')));
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const runner = val('--runner', 'cc');
const model = val('--model', P.model);
const reps = Number(val('--reps', String(P.reps)));
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
if (runner !== 'stub' && model !== P.model) die(`model must be ${P.model} (the prereg's registered model), got ${model}`);
if (!Number.isInteger(reps) || reps < 1) die('--reps must be a positive integer');
if (runner !== 'stub' && reps !== P.reps) die(`reps must be ${P.reps} (prereg) for a live run, got ${reps}`);
let sgArms = val('--arms', 'change,red').split(',').filter(Boolean);
if (flag('--with-base') && !sgArms.includes('base')) sgArms = ['base', ...sgArms];
for (const a of sgArms) if (!Object.values(P.arms).includes(a)) die(`unknown arm: ${a}`);

// Generic groups: the conditions of the rows that registered each task (amendments 2/3/4).
const GENERIC = [
  { row: 'w2a-g', tasks: ['a1-doa-boundary', 'a1b-doa-boundary-reset', 'a2-within-doa'], fixture: 'fixture-scripts-w2a', prefix: 'Invoke the ceo-agent skill:', lib: 'lib-r2' },
  { row: 'w2b-g', tasks: ['d2-l-multimodule', 'd8-l-two-phase'], fixture: 'fixture-scripts-w2b', prefix: 'Use dev-flow, this is L-size:', lib: 'lib-r4' },
  { row: 'w1b-t2', tasks: ['f1-ready-to-merge', 'f1b-ready-to-merge-docs'], fixture: 'fixture-scripts-w1b', prefix: '', lib: '' },
];
const genericIds = GENERIC.flatMap((g) => g.tasks);
if (!flag('--skip-generic') && JSON.stringify([...genericIds].sort()) !== JSON.stringify([...P.generic.tasks].sort())) die('internal: GENERIC groups do not cover the prereg generic tasks');

// Invocation preface (prereg/stage-graph.amend-1-invocation.json): without it a headless -p sonnet cell never loads the
// skill (live 2026-10-06: 6-8 s, skill_invoked false, no session-mode/stage-advance call) — the same failure P1W amendment 2
// fixed for w2a-g/w2b-g. Names ONLY the skill: no size / bug / urgent / stage vocabulary (those are what the markers measure).
const SG_PROMPT_PREFIX = 'Use dev-flow:';
const groups = [{ kind: 'stage-graph', tasks: P.tasks, arms: sgArms, env: { ONOFF_PROMPT_PREFIX: SG_PROMPT_PREFIX }, extra: ['--arm-manifests', armsDir] }];
if (!flag('--skip-generic')) {
  for (const g of GENERIC) {
    groups.push({
      kind: `generic:${g.row}`, tasks: g.tasks, arms: ['base', 'change'],
      env: { ...(g.prefix ? { ONOFF_PROMPT_PREFIX: g.prefix } : {}), ...(g.lib ? { ONOFF_LIB_OVERRIDE: path.join(HERE, g.lib) } : {}) },
      extra: ['--arm-manifests', armsDir, '--fixture-scripts', g.fixture],
    });
  }
}

// resume state, same rule as the matrix: done = a row with no failure_class; exhausted = 3 failed attempts
function state() {
  const done = new Set();
  const fails = new Map();
  let text = '';
  try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const k = `${j.task_id}|${j.arm}|${j.rep}`;
    if (j.failure_class === null || j.failure_class === undefined) done.add(k); else fails.set(k, (fails.get(k) || 0) + 1);
  }
  return { done, fails };
}

function costBasis() {
  let costs = [];
  try { costs = fs.readFileSync(path.join(HERE, 'results', 'batch-log.txt'), 'utf8').split('\n').map((l) => Number((l.match(/cost=([0-9.]+)/) || [])[1])).filter((x) => x > 0); } catch { /* fall back */ }
  if (!costs.length) return { n: 0, mean: 0.135, max: 0.52, source: 'fallback constants (results/batch-log.txt unreadable)' };
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  return { n: costs.length, mean, max: Math.max(...costs), source: 'results/batch-log.txt (measured sonnet cells of the earlier skill-onoff rows)' };
}

if (flag('--dry-run')) {
  const { done, fails } = state();
  const basis = costBasis();
  const rows = [];
  for (const g of groups) {
    for (const t of g.tasks) for (let rep = 1; rep <= reps; rep++) for (const arm of g.arms) {
      const k = `${t}|${arm}|${rep}`;
      rows.push({ group: g.kind, key: k, status: done.has(k) ? 'done' : (fails.get(k) || 0) >= 3 ? 'exhausted' : 'todo' });
    }
  }
  for (const r of rows) console.log(`${r.status.padEnd(9)} ${r.group.padEnd(16)} ${r.key}`);
  const todo = rows.filter((r) => r.status === 'todo');
  const sgTodo = todo.filter((r) => r.group === 'stage-graph').length;
  const genTodo = todo.length - sgTodo;
  const est = (perSg, perGen) => sgTodo * perSg + genTodo * perGen;
  const warn = [...new Set(groups.flatMap((g) => g.arms))].filter((x) => !fs.existsSync(path.join(armsDir, `${x}.json`)));
  const summary = {
    dry_run: true, model, reps, results: resultsPath,
    cells_total: rows.length, cells_todo: todo.length, cells_done: rows.filter((r) => r.status === 'done').length, cells_exhausted: rows.filter((r) => r.status === 'exhausted').length,
    stage_graph_cells_todo: sgTodo, generic_cells_todo: genTodo,
    estimated_cost_usd: { low: +est(basis.mean, basis.mean).toFixed(2), typical: +est(basis.mean * 2, basis.mean).toFixed(2), high: +est(basis.max, basis.max).toFixed(2) },
    cost_basis: { measured_cells: basis.n, measured_mean_usd: +basis.mean.toFixed(3), measured_max_usd: +basis.max.toFixed(3), source: basis.source, typical_assumption: 'stage-graph cells assumed 2x the measured mean (multi-stage walk, 16-skill catalog); generic cells = measured mean; low = all at measured mean, high = all at measured max' },
    arm_manifests_missing: warn.length ? warn.map((a) => `${a}.json (run freeze-guidance-arm.js ${a === 'red' ? 'red' : 'change'})`) : [],
  };
  console.log(JSON.stringify(summary));
  process.exit(0);
}

// live (or stub) run: fail fast on a missing manifest, then matrix per group, then score
for (const a of new Set(groups.flatMap((g) => g.arms))) if (!fs.existsSync(path.join(armsDir, `${a}.json`))) die(`arm manifest missing: ${path.join(armsDir, `${a}.json`)} (run freeze-guidance-arm.js change / red first)`);
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
for (const g of groups) {
  console.log(`== group ${g.kind}: ${g.tasks.length} tasks x [${g.arms.join(',')}] x ${reps} reps`);
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix.sh'), '--model', model, '--reps', String(reps), '--results', path.resolve(resultsPath),
    '--tasks', g.tasks.join(','), '--arms', g.arms.join(','), '--runner', runner, ...g.extra], { stdio: 'inherit', env: { ...process.env, ...g.env } });
  if (r.status !== 0) die(`matrix failed for group ${g.kind} (exit ${r.status})`);
}
const s = cp.spawnSync('node', [path.join(HERE, 'score-stage-graph.js'), 'score', '--results', path.resolve(resultsPath), '--prereg', preregPath], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
