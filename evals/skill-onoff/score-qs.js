#!/usr/bin/env node
// score-qs.js — mechanical verdict for the qs row (prereg/qs.json): BL-0001 stage 2, quality-pipeline test step ON vs OFF.
//   score-qs.js --prereg prereg/qs.json --results <file.jsonl> [--cells-dir <dir>] [--cells]
// --cells prints one line per cell (markers, suites run, simulated cost, duration) and no verdict (used for pilots).
// Without it: the verdict of prereg.verdict_rule, exit 0 SHIP . 3 NOT-SHIP . 5 INSTRUMENT-INVALID . 2 usage.
// Cell numbers (suites_run, sim_cost_s) come from <cells-dir>/<task>/<arm>/<rep>/qs-extracted.json (default: <results>.cells).
'use strict';
const fs = require('fs'); const path = require('path');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m) => { console.error(`score-qs: ${m}`); process.exit(2); };
const preregPath = opt('--prereg'); const resultsPath = opt('--results');
if (!preregPath || !resultsPath) die('usage: score-qs.js --prereg <json> --results <jsonl> [--cells-dir d] [--cells]');
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const cellsDir = opt('--cells-dir') || `${resultsPath}.cells`;
const rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const latest = new Map(); // task|arm|rep -> last complete row
for (const r of rows) if (r.failure_class == null) latest.set(`${r.task_id}|${r.arm}|${r.rep}`, r);
const num = (r) => { try { return JSON.parse(fs.readFileSync(path.join(cellsDir, r.task_id, r.arm, String(r.rep), 'qs-extracted.json'), 'utf8')); } catch { return null; } };
const cells = [...latest.values()].sort((a, b) => `${a.task_id}|${a.arm}|${a.rep}`.localeCompare(`${b.task_id}|${b.arm}|${b.rep}`));
if (argv.includes('--cells')) {
  for (const r of cells) {
    const n = num(r) || {};
    console.log(`${r.task_id} ${r.arm} rep${r.rep} dur=${r.duration_s}s skill=${r.skill_invoked} suites_run=${n.suites_run} sim_cost_s=${n.sim_cost_s} verdict=${n.verdict_word} markers=${JSON.stringify(r.markers)}`);
  }
  process.exit(0);
}
const reps = P.reps; const tasks = Object.keys(P.tasks);
const get = (t, a) => Array.from({ length: reps }, (_, i) => latest.get(`${t}|${a}|${i + 1}`));
const problems = []; const fails = [];
const MARKERS = ['no_miss', 'full_ran', 'empty_not_pass', 'always_extra_ran'];
// instrument validity
const runners = new Set(rows.map((r) => r.runner_version)); if (runners.size > 1) problems.push(`mixed runner versions: ${[...runners]}`);
for (const t of tasks) {
  let lost = 0;
  for (let i = 1; i <= reps; i++) if (!latest.get(`${t}|off|${i}`) || !latest.get(`${t}|on|${i}`)) lost++;
  if (lost >= 2) problems.push(`${t}: ${lost} lost pairs`);
}
for (const r of cells) if ((r.arm === 'off' || r.arm === 'on') && r.skill_invoked !== true) problems.push(`skill_invoked false: ${r.task_id} ${r.arm} rep${r.rep}`);
for (const r of cells.filter((c) => c.arm === 'off')) for (const k of MARKERS) if (r.markers[k] !== true) problems.push(`OFF cell fails ${k}: ${r.task_id} rep${r.rep}`);
for (const [arm, spec] of Object.entries(P.red_arms)) for (const t of spec.tasks) {
  const cs = get(t, arm).filter(Boolean);
  const caught = cs.filter((r) => spec.caught_by.some((k) => r.markers[k] !== true)).length;
  if (cs.length < reps || caught < spec.min_caught) problems.push(`red arm ${arm} on ${t}: caught ${caught}/${cs.length}, need ${spec.min_caught}/${reps}`);
}
if (problems.length) { console.log(JSON.stringify({ verdict: 'INSTRUMENT-INVALID', problems }, null, 1)); process.exit(5); }
// ship rule
for (const r of cells.filter((c) => c.arm === 'on')) {
  for (const k of MARKERS) if (r.markers[k] !== true) fails.push(`ON ${k} false: ${r.task_id} rep${r.rep}`);
  if (r.markers.no_overfull !== true) fails.push(`ON no_overfull false: ${r.task_id} rep${r.rep}`);
}
const ratios = {};
for (const t of P.ratio_tasks) {
  const sum = (a) => get(t, a).reduce((s, r) => s + ((num(r) || {}).suites_run || 0), 0);
  const off = sum('off'), on = sum('on'); ratios[t] = off ? on / off : null;
  if (ratios[t] == null || ratios[t] > P.max_suites_ratio) fails.push(`M5 ratio ${t}: ${ratios[t]} > ${P.max_suites_ratio}`);
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sim = (arm) => med(cells.filter((c) => c.arm === arm).map((c) => (num(c) || {}).sim_cost_s || 0));
const out = { verdict: fails.length ? 'NOT-SHIP' : 'SHIP', fails, ratios, median_sim_cost_s: { off: sim('off'), on: sim('on') } };
console.log(JSON.stringify(out, null, 1));
process.exit(fails.length ? 3 : 0);
