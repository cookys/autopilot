#!/usr/bin/env node
// score-dcard.js — dcard row scorer. Same judgement order as score-p1w.js.
// A prereg `secondary` list is counted and printed; it never changes the exit code.
// control.reps, when set, is the rep count for the control tasks (primary uses reps).
// Exit codes match score-p1w.js: 0 pass, 3 fail, 4 STOP, 5 instrument-invalid, 2 usage.
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) {
  console.error('usage: score-dcard.js --prereg <file.json> --results <file.jsonl> [--json]');
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
const T = P.thresholds;
const OFF = P.arms.off;
const ON = P.arms.on;
const primary = P.primary.tasks;
const control = P.control || null;
const secondary = Array.isArray(P.secondary) ? P.secondary : [];
const controlReps = control && Number.isInteger(control.reps) ? control.reps : P.reps;

const done = (code, verdict, report) => {
  report.verdict = verdict;
  if (secondary.length) report.secondary = secondaryCounts();
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(`${P.row}: ${verdict}\n${JSON.stringify(report.counts || {})}${report.secondary ? `\nsecondary ${JSON.stringify(report.secondary)}` : ''}`);
  process.exit(code);
};

const mine = rows.filter((r) => [OFF, ON].includes(r.arm));
const models = [...new Set(mine.map((r) => r.model))];
const versions = [...new Set(mine.filter((r) => r.runner === 'cc').map((r) => r.runner_version))];
if (models.length > 1) done(5, `INSTRUMENT-INVALID (mixed models: ${models.join(', ')})`, {});
if (versions.length > 1) done(5, `INSTRUMENT-INVALID (runner_version drift: ${versions.join(' | ')})`, {});

const ok = new Map();
for (const r of mine) if (r.failure_class === null || r.failure_class === undefined) ok.set(`${r.task_id}|${r.arm}|${r.rep}`, r);

const reps = P.reps;
const excluded = new Set();
for (const task of Object.keys(primary))
  for (let rep = 1; rep <= reps; rep++)
    if (!ok.has(`${task}|${OFF}|${rep}`) || !ok.has(`${task}|${ON}|${rep}`)) excluded.add(`${task}|${rep}`);

const usable = (arm) => {
  let n = 0;
  for (const task of Object.keys(primary))
    for (let rep = 1; rep <= reps; rep++) if (!excluded.has(`${task}|${rep}`) && ok.has(`${task}|${arm}|${rep}`)) n++;
  return n;
};
const uOff = usable(OFF);
const uOn = usable(ON);
const base = { counts: { usable_off: uOff, usable_on: uOn, excluded_pairs: excluded.size } };
if (uOff < T.min_usable || uOn < T.min_usable || excluded.size > T.max_lost_pairs)
  done(4, `STOP (survivors: off=${uOff} on=${uOn} excluded_pairs=${excluded.size}; need >=${T.min_usable} and <=${T.max_lost_pairs} lost) — no aggregate claim`, base);

const count = (arm, tasksMap, nReps) => {
  let hit = 0;
  for (const [task, need] of Object.entries(tasksMap))
    for (let rep = 1; rep <= nReps; rep++) {
      if (nReps === reps && excluded.has(`${task}|${rep}`)) continue;
      const r = ok.get(`${task}|${arm}|${rep}`);
      if (r && need.every((m) => r.markers && r.markers[m] === true)) hit++;
    }
  return hit;
};
const invoked = (arm) => {
  let inv = 0;
  let eff = 0;
  for (const task of Object.keys(primary))
    for (let rep = 1; rep <= reps; rep++) {
      if (excluded.has(`${task}|${rep}`)) continue;
      const r = ok.get(`${task}|${arm}|${rep}`);
      if (!r) continue;
      eff++;
      if (r.skill_invoked === true) inv++;
    }
  return { inv, eff };
};
function secondaryCounts() {
  const tally = (arm) => {
    const out = {};
    for (const m of secondary) {
      let hit = 0;
      let n = 0;
      for (const task of Object.keys(primary))
        for (let rep = 1; rep <= reps; rep++) {
          if (excluded.has(`${task}|${rep}`)) continue;
          const r = ok.get(`${task}|${arm}|${rep}`);
          if (!r) continue;
          n++;
          if (r.markers && r.markers[m] === true) hit++;
        }
      out[m] = { hit, n };
    }
    return out;
  };
  return { off: tally(OFF), on: tally(ON) };
}
const vOff = invoked(OFF);
const vOn = invoked(ON);
const need = (v) => Math.ceil(v.eff * T.v1_min_invoked_ratio);
const counts = { ...base.counts, on: count(ON, primary, reps), off: count(OFF, primary, reps), v1_on: vOn, v1_off: vOff };
if (vOff.inv < need(vOff) || vOn.inv < need(vOn))
  done(5, 'INSTRUMENT-INVALID (V1: target skill not invoked in enough cells — no content judgement)', { counts });
if (counts.on - counts.off < T.v2_min_diff)
  done(5, `INSTRUMENT-INVALID (V2: on-off=${counts.on - counts.off} < ${T.v2_min_diff} — not load-bearing)`, { counts });

let ctl = null;
if (control) {
  const on = count(ON, control.tasks, controlReps);
  const off = count(OFF, control.tasks, controlReps);
  ctl = { on_false_positive: on, off_false_positive: off, pass: on <= control.max_on_false_positive && on <= off + 1 };
  counts.control = ctl;
}
const pass = counts.on >= T.on_min && counts.off <= T.off_max && (!ctl || ctl.pass);
done(pass ? 0 : 3, pass ? 'PASS' : 'FAIL', { counts });
