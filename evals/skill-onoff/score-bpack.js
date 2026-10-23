#!/usr/bin/env node
// score-bpack.js — bpack row scorer (prereg/bpack.json).
// Three columns, PASS only when all hold and every formal cell is present with
// failure_class null:
//   T1 bpack-revoked        b_revoked_prefix: base <= 1/5 and change >= 4/5
//   T2 bpack-tree           t_tree_run:       change >= 4/5 and change - base >= 3
//   T3 dcard-owner-decision a_decision_file:  change >= base - 1 (regression)
// V1 (skill_invoked ratio) is copied from gdorm: below 0.9 in either arm is
// INSTRUMENT-INVALID. T3 is a regression column, so it must be measurable: a
// cell with no boolean a_decision_file (marker lib not loaded) or a grid where
// the marker is never true in either arm is a FAIL, never a quiet pass.
// A missing or malformed prereg is a usage error (rc 2), not a verdict.
// Exit: 0 PASS, 3 FAIL, 5 instrument-invalid, 2 usage / unreadable input.
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) {
  console.error('usage: score-bpack.js --prereg <file.json> --results <file.jsonl>');
  process.exit(2);
}
let P;
let rows;
try {
  P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
} catch (e) {
  console.error(`prereg unreadable: ${preregPath}: ${e.message} (prereg/bpack.json is built by the content hand; refusing to score without it)`);
  process.exit(2);
}
try {
  rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
} catch (e) {
  console.error(`results unreadable: ${resultsPath}: ${e.message}`);
  process.exit(2);
}
if (!P || typeof P !== 'object' || !P.arms || typeof P.arms.off !== 'string' || typeof P.arms.on !== 'string') {
  console.error(`prereg ${preregPath} has no arms.off / arms.on`);
  process.exit(2);
}
const T = P.thresholds || {};
const OFF = P.arms.off;
const ON = P.arms.on;
const REPS = T.reps || P.reps || 5;
const COLS = [
  { task: 'bpack-revoked', marker: 'b_revoked_prefix' },
  { task: 'bpack-tree', marker: 't_tree_run' },
  { task: 'dcard-owner-decision', marker: 'a_decision_file' },
];

const done = (code, verdict, counts) => {
  console.log(`${P.row || 'bpack'}: ${verdict}\n${JSON.stringify(counts || {})}`);
  process.exit(code);
};

// Last row per task|arm|rep: the matrix appends a retry instead of replacing the failed row.
const lastRow = new Map();
for (const r of rows) {
  if (!r || r.task_id == null || r.arm == null || r.rep == null) continue;
  lastRow.set(`${r.task_id}|${r.arm}|${r.rep}`, r);
}
const cell = (task, arm, rep) => lastRow.get(`${task}|${arm}|${rep}`);
const infra = [];
for (const col of COLS) for (const arm of [OFF, ON]) for (let rep = 1; rep <= REPS; rep++) {
  const r = cell(col.task, arm, rep);
  if (!r || (r.failure_class !== null && r.failure_class !== undefined)) infra.push(`${col.task}|${arm}|${rep}`);
}
if (infra.length) done(3, `FAIL (infra failure blocks PASS: ${infra.length} cell(s))`, { infra: infra.length });

const hits = (task, marker, arm) => {
  let n = 0;
  for (let rep = 1; rep <= REPS; rep++) {
    const r = cell(task, arm, rep);
    if (r && r.markers && r.markers[marker] === true) n++;
  }
  return n;
};
const unmeasured = (task, marker) => {
  let n = 0;
  for (const arm of [OFF, ON]) for (let rep = 1; rep <= REPS; rep++) {
    const r = cell(task, arm, rep);
    if (!r || !r.markers || typeof r.markers[marker] !== 'boolean') n++;
  }
  return n;
};
const invoked = (arm) => {
  let inv = 0;
  let eff = 0;
  for (const col of COLS) for (let rep = 1; rep <= REPS; rep++) {
    const r = cell(col.task, arm, rep);
    eff++;
    if (r && r.skill_invoked === true) inv++;
  }
  return { inv, eff };
};
const vOff = invoked(OFF);
const vOn = invoked(ON);
const counts = {};
for (const col of COLS) counts[col.marker] = { base: hits(col.task, col.marker, OFF), change: hits(col.task, col.marker, ON) };
counts.v1_off = vOff;
counts.v1_on = vOn;

const needRatio = T.v1_min_invoked_ratio;
if (typeof needRatio === 'number') {
  const need = (v) => v.inv >= Math.ceil(v.eff * needRatio);
  if (!need(vOff) || !need(vOn)) done(5, 'INSTRUMENT-INVALID (V1: target skill not invoked in enough cells — no content judgement)', counts);
}

const r1 = counts.b_revoked_prefix;
const r2 = counts.t_tree_run;
const r3 = counts.a_decision_file;
const t1 = { base_max: 1, change_min: 4, ...(T.b_revoked_prefix || {}) };
const t2 = { change_min: 4, min_diff: 3, ...(T.t_tree_run || {}) };
const t3 = { max_drop: 1, ...(T.a_decision_file || {}) };
const t1Ok = r1.base <= t1.base_max && r1.change >= t1.change_min;
const t2Ok = r2.change >= t2.change_min && (r2.change - r2.base) >= t2.min_diff;
const t3Unmeasured = unmeasured('dcard-owner-decision', 'a_decision_file');
const t3Vacuous = r3.base === 0 && r3.change === 0;
const t3Ok = t3Unmeasured === 0 && !t3Vacuous && r3.change >= r3.base - t3.max_drop;
counts.rules = { b_revoked_prefix: t1Ok, t_tree_run: t2Ok, a_decision_file: t3Ok };
if (t3Unmeasured) counts.t3_unmeasured_cells = t3Unmeasured;
if (t3Vacuous) counts.t3_vacuous = true;
const pass = t1Ok && t2Ok && t3Ok;
let verdict = pass ? 'PASS' : 'FAIL';
if (!pass && t3Unmeasured) verdict = `FAIL (T3 marker a_decision_file missing in ${t3Unmeasured} cell(s): marker lib not loaded, regression column unmeasured)`;
else if (!pass && t3Vacuous) verdict = 'FAIL (T3 marker a_decision_file never true in either arm: regression column is vacuous)';
done(pass ? 0 : 3, verdict, counts);
