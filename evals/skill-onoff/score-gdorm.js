#!/usr/bin/env node
// score-gdorm.js — gdorm row scorer (prereg/gdorm.json).
// PASS only when all three column rules hold and every formal cell is present
// with failure_class null. V1 (skill_invoked ratio) is copied from dcard-v3:
// below 0.9 in either arm is INSTRUMENT-INVALID and is not a content judgement.
// Exit: 0 PASS, 3 FAIL, 5 instrument-invalid, 2 usage.
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argsAt(i) : undefined; };
function argsAt(i) { return argv[i + 1]; }
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) {
  console.error('usage: score-gdorm.js --prereg <file.json> --results <file.jsonl>');
  process.exit(2);
}
let P;
let rows;
try {
  P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
  rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
} catch (e) {
  console.error(`unreadable input: ${e.message}`);
  process.exit(2);
}
const T = P.thresholds || {};
const OFF = P.arms.off;
const ON = P.arms.on;
const REPS = T.reps || P.reps;
const COLS = [
  { task: 'gdorm-qcpanel', marker: 'q_qcpanel_run' },
  { task: 'gdorm-archive', marker: 'r_archive_import' },
  { task: 'gdorm-tree', marker: 't_tree_run' },
];

const done = (code, verdict, counts) => {
  console.log(`${P.row}: ${verdict}\n${JSON.stringify(counts || {})}`);
  process.exit(code);
};

// Last row per task|arm|rep. The matrix appends a retry rather than replacing
// the failed row, so cell, hits, invoked, and the infra check all read this map.
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
const needRatio = T.v1_min_invoked_ratio;
const vOff = invoked(OFF);
const vOn = invoked(ON);
const counts = {
  q_qcpanel_run: { base: hits('gdorm-qcpanel', 'q_qcpanel_run', OFF), change: hits('gdorm-qcpanel', 'q_qcpanel_run', ON) },
  r_archive_import: { base: hits('gdorm-archive', 'r_archive_import', OFF), change: hits('gdorm-archive', 'r_archive_import', ON) },
  t_tree_run: { base: hits('gdorm-tree', 't_tree_run', OFF), change: hits('gdorm-tree', 't_tree_run', ON) },
  v1_off: vOff,
  v1_on: vOn,
};
if (typeof needRatio === 'number') {
  const need = (v) => v.inv >= Math.ceil(v.eff * needRatio);
  if (!need(vOff) || !need(vOn)) done(5, 'INSTRUMENT-INVALID (V1: target skill not invoked in enough cells — no content judgement)', counts);
}
const qc = counts.q_qcpanel_run;
const ar = counts.r_archive_import;
const tr = counts.t_tree_run;
const qcRule = T.q_qcpanel_run || { base_min: 4, change_max: 1 };
const drop = (T.r_archive_import && T.r_archive_import.max_drop) || 1;
const rise = (T.t_tree_run && T.t_tree_run.max_rise) || 1;
const qcOk = qc.base >= qcRule.base_min && qc.change <= qcRule.change_max;
const arOk = ar.change >= ar.base - drop;
const trOk = tr.change <= tr.base + rise;
const v2min = T.v2_min_diff;
const v2Ok = typeof v2min !== 'number' || (qc.base - qc.change) >= v2min;
counts.rules = { q_qcpanel_run: qcOk, r_archive_import: arOk, t_tree_run: trOk, v2: v2Ok };
const pass = qcOk && arOk && trOk && v2Ok;
done(pass ? 0 : 3, pass ? 'PASS' : 'FAIL', counts);
