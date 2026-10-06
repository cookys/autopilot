#!/usr/bin/env node
// score-stage-graph.js — mechanical scorer for the pre-registered stage-graph eval row (plan
// docs/plans/2026-10-06-dev-flow-stage-graph.md §4 P0; frozen rule: prereg/stage-graph.md + .json).
// The thresholds live in the prereg JSON — this script only applies them; it never relaxes one.
//
// Per-cell extraction happens at marker time (lib/stage-graph-cell.js, from the transcript; the
// markers.sh of each tasks/stage-graph-* brief emits marker_sg_*). This scorer aggregates the recorded
// rows only, so check-guidance-eval.js can re-run it on a committed results file without transcripts.
//
// Usage:
//   score-stage-graph.js score --results <file.jsonl> [--prereg <json>]     (default subcommand)
//   score-stage-graph.js validate-keys [--prereg <json>] [--tasks-dir <d>] [--expected <expected.json>]
// Rep passes iff ALL of sg_size sg_bug sg_urgent sg_walk sg_rung sg_work are true (sg_pass is never
// trusted; it is re-derived from its components). A task passes on >= rep_pass_min of `reps` reps.
// Arms: change must pass >= change_min_tasks, the planted-red arm <= red_max_tasks, and no generic marker
// that base passes in >= 2/3 of reps may fall below 2/3 in change. The base arm is reported, not gated.
// Completeness: a missing or infra_fail (task, rep) cell in the change or red arm, or in a generic
// task, is STOP (no verdict) — a missing red cell would otherwise help the arm ship.
// stdout: ONE JSON object {row, verdict, reasons[], counts{...}}; diagnostics on stderr.
// Exit: 0 SHIP · 3 NOT-SHIP · 4 STOP (incomplete) · 5 INSTRUMENT-INVALID (mixed model / runner drift) · 2 usage.
'use strict';
const fs = require('fs');
const path = require('path');
const cell = require('./lib/stage-graph-cell');

const argv = process.argv.slice(2);
const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'score';
const rest = sub === argv[0] ? argv.slice(1) : argv;
const val = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const HERE = __dirname;
const preregPath = val('--prereg') || path.join(HERE, 'prereg', 'stage-graph.json');
const die = (m, code = 2) => { console.error(`score-stage-graph: ${m}`); process.exit(code); };
let P;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`unreadable prereg: ${e.message}`); }
const REP_MARKERS = ['sg_size', 'sg_bug', 'sg_urgent', 'sg_walk', 'sg_rung', 'sg_work'];

const emit = (code, verdict, reasons, counts) => {
  process.stdout.write(`${JSON.stringify({ row: P.row, verdict, reasons, counts })}\n`);
  process.exit(code);
};

if (sub === 'validate-keys') {
  const tasksDir = val('--tasks-dir') || path.join(HERE, 'tasks');
  const expectedFile = val('--expected') || path.join(HERE, '..', '..', 'hooks', 'tests', 'fixtures', 'stage-graph', 'expected.json');
  const bad = [];
  for (const t of P.tasks) {
    try {
      const { answer, cell: c } = cell.loadKey(t, tasksDir, expectedFile);
      for (const e of cell.validateKey(answer, c)) bad.push(`${t}: ${e}`);
      if (answer.task_id !== t) bad.push(`${t}: answer.task_id mismatch`);
    } catch (e) { bad.push(`${t}: ${e.message}`); }
  }
  emit(bad.length ? 3 : 0, bad.length ? 'KEYS-INVALID' : 'KEYS-OK', bad, { tasks: P.tasks.length });
}
if (sub !== 'score') die(`unknown subcommand: ${sub}`);

const resultsPath = val('--results');
if (!resultsPath) die('usage: score-stage-graph.js score --results <file.jsonl> [--prereg <json>]');
let rows;
try { rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { die(`unreadable results: ${e.message}`); }

const ARMS = P.arms;
const reps = P.reps;
const T = P.thresholds;
const armNames = Object.values(ARMS);
const mine = rows.filter((r) => armNames.includes(r.arm) && (P.tasks.includes(r.task_id) || P.generic.tasks.includes(r.task_id)));
const models = [...new Set(mine.map((r) => r.model))];
const versions = [...new Set(mine.filter((r) => r.runner === 'cc').map((r) => r.runner_version))];
if (models.length > 1) emit(5, 'INSTRUMENT-INVALID', [`mixed models: ${models.join(', ')}`], {});
if (versions.length > 1) emit(5, 'INSTRUMENT-INVALID', [`runner_version drift: ${versions.join(' | ')}`], {});
if (models.length === 1 && models[0] !== P.model) emit(5, 'INSTRUMENT-INVALID', [`model ${models[0]} != registered ${P.model}`], {});

const ok = new Map(); // task|arm|rep -> row (usable only)
for (const r of mine) if (r.failure_class === null || r.failure_class === undefined) ok.set(`${r.task_id}|${r.arm}|${r.rep}`, r);

const repPass = (r) => !!r && !!r.markers && REP_MARKERS.every((m) => r.markers[m] === true);
const armReport = (arm) => {
  const per = {};
  let passed = 0;
  const missing = [];
  for (const t of P.tasks) {
    let n = 0;
    for (let rep = 1; rep <= reps; rep++) {
      const r = ok.get(`${t}|${arm}|${rep}`);
      if (!r) { missing.push(`${t}#${rep}`); continue; }
      if (repPass(r)) n++;
    }
    per[t] = n;
    if (n >= T.rep_pass_min) passed++;
  }
  return { passed, per_task: per, missing };
};
const base = armReport(ARMS.base);
const change = armReport(ARMS.change);
const red = armReport(ARMS.red);
const counts = { base: { passed: base.passed, per_task: base.per_task, missing: base.missing.length }, change: { passed: change.passed, per_task: change.per_task }, red: { passed: red.passed, per_task: red.per_task } };

// generic non-regression: markers base passes in >= 2/3 of its reps must stay >= 2/3 in change
const gen = { checked: 0, regressed: [], missing: [] };
for (const t of P.generic.tasks) {
  const rb = [...ok.values()].filter((r) => r.task_id === t && r.arm === ARMS.base);
  const rc = [...ok.values()].filter((r) => r.task_id === t && r.arm === ARMS.change);
  if (rb.length < reps || rc.length < reps) { gen.missing.push(t); continue; }
  const markerNames = new Set(rb.flatMap((r) => Object.keys(r.markers || {})));
  for (const m of markerNames) {
    const b = rb.filter((r) => r.markers[m] === true).length;
    if (b * 3 < 2 * rb.length) continue;
    gen.checked++;
    const c = rc.filter((r) => r.markers && r.markers[m] === true).length;
    if (c * 3 < 2 * rc.length) gen.regressed.push(`${t}:${m} base ${b}/${rb.length} change ${c}/${rc.length}`);
  }
}
counts.generic = gen;

const incomplete = [];
if (change.missing.length) incomplete.push(`change arm missing cells: ${change.missing.join(',')}`);
if (red.missing.length) incomplete.push(`red arm missing cells: ${red.missing.join(',')}`);
if (gen.missing.length) incomplete.push(`generic tasks without ${reps}+ usable base and change rows: ${gen.missing.join(',')}`);
if (incomplete.length) emit(4, 'STOP', incomplete, counts);

const reasons = [];
if (change.passed < T.change_min_tasks) reasons.push(`change passed ${change.passed}/${P.tasks.length} < ${T.change_min_tasks}`);
if (red.passed > T.red_max_tasks) reasons.push(`planted-red arm passed ${red.passed}/${P.tasks.length} > ${T.red_max_tasks} (the instrument cannot tell a wrong graph from a right one)`);
if (gen.regressed.length) reasons.push(`generic marker regression: ${gen.regressed.join('; ')}`);
emit(reasons.length ? 3 : 0, reasons.length ? 'NOT-SHIP' : 'SHIP', reasons, counts);
