#!/usr/bin/env node
// run-qs3-campaign.js — one command for the qs row (prereg/qs.{md,json}); thin wrapper over run-skill-onoff-matrix.sh.
//   run-qs3-campaign.js --results <file.jsonl> [--tasks a,b] [--arms off,on] [--reps 3] [--runner cc|stub] [--dry-run] [--score]
// Default cells = the prereg's full 48: every task x {off,on} x reps, plus red-a on its tasks and red-b on its tasks.
// --tasks/--arms/--reps narrow it (a pilot is `--tasks qs-s1-hooks-selective --arms off,on --reps 1` with its OWN results file).
// Resumable (the matrix skips complete cells). Cell artifacts are kept under <results>.cells/<task>/<arm>/<rep>/.
// ONOFF_TIMEOUT defaults to the prereg's cell_timeout. Run the live campaign detached (setsid nohup) and watch the log.
'use strict';
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const HERE = __dirname; const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const results = val('--results'); if (!results) { console.error('usage: run-qs3-campaign.js --results <file.jsonl> [...]'); process.exit(2); }
const P = JSON.parse(fs.readFileSync(val('--prereg', path.join(HERE, 'prereg', 'qs-v3.json')), 'utf8'));
const reps = Number(val('--reps', String(P.reps))); const runner = val('--runner', 'cc');
const only = val('--tasks') ? val('--tasks').split(',') : null; const armsSel = val('--arms') ? val('--arms').split(',') : null;
const plan = []; // [task, arms[]]
for (const t of Object.keys(P.tasks)) {
  if (only && !only.includes(t)) continue;
  const arms = ['off', 'on'].concat(Object.entries(P.red_arms).filter(([, s]) => s.tasks.includes(t)).map(([a]) => a)).filter((a) => !armsSel || armsSel.includes(a));
  if (arms.length) plan.push([t, arms]);
}
const n = plan.reduce((s, [, a]) => s + a.length * reps, 0);
console.log(`qs campaign: ${plan.length} tasks, ${n} cells (reps ${reps}), runner ${runner}`);
for (const [t, a] of plan) console.log(`  ${t}: ${a.join(',')}`);
if (argv.includes('--dry-run')) process.exit(0);
const keep = `${results}.cells`; fs.mkdirSync(keep, { recursive: true });
for (const [t, arms] of plan) {
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix.sh'), '--model', P.model, '--reps', String(reps), '--results', results, '--tasks', t, '--arms', arms.join(','),
    '--runner', runner, '--arm-manifests', path.join(HERE, 'arms', 'qs-v3'), '--check-skill', 'quality-pipeline'], {
    stdio: 'inherit', env: { ...process.env, ONOFF_PROMPT_PREFIX: P.prompt_prefix, ONOFF_TIMEOUT: process.env.ONOFF_TIMEOUT || P.cell_timeout, ONOFF_KEEP_CELLS_DIR: keep } });
  if (r.status !== 0) { console.error(`matrix stopped on ${t} (exit ${r.status})`); process.exit(r.status || 1); }
}
if (argv.includes('--score')) { const s = cp.spawnSync('node', [path.join(HERE, 'score-qs3.js'), '--prereg', path.join(HERE, 'prereg', 'qs-v3.json'), '--results', results], { stdio: 'inherit' }); process.exit(s.status); }
