#!/usr/bin/env node
'use strict';
// Stub of scripts/wait-dispatch-results.js for the findings-batch eval fixture. One call = one poll. State lives in
// <git-dir>/fbatch/: plan.json (label -> {after, files}), waits (the poll counter). The Nth poll lands every plan
// entry whose `after` <= N by writing its files. A label that is not in the plan has already landed.
// The poll counter is the only clock: fbatch/cell.js replays the same count from the transcript and checks it
// against <git-dir>/fbatch/waits at the end of the cell.
// FBATCH_LAND_ALL=1 (turn2.sh only) lands every entry without counting a poll.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const gitDir = cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const dir = path.join(gitDir, 'fbatch');
const wf = path.join(dir, 'waits');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const landAll = process.env.FBATCH_LAND_ALL === '1';
let n = 0;
try { n = parseInt(fs.readFileSync(wf, 'utf8'), 10) || 0; } catch { /* first poll */ }
// Count the poll before anything can fail, so a usage error still matches the transcript replay.
if (!landAll) { n += 1; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(wf, `${n}\n`); }
const i = process.argv.indexOf('--expect');
const label = i >= 0 ? process.argv[i + 1] : undefined;
if (!label) { console.error('usage: wait-dispatch-results.js --expect <run_id>.<stage>'); process.exit(2); }
const plan = readJson(path.join(dir, 'plan.json'), {});
const landedF = path.join(dir, 'landed.json');
const done = readJson(landedF, {});
for (const [lab, spec] of Object.entries(plan)) {
  if (done[lab] || !(landAll || n >= spec.after)) continue;
  for (const [rel, text] of Object.entries(spec.files || {})) {
    fs.mkdirSync(path.dirname(rel), { recursive: true });
    fs.writeFileSync(rel, text);
  }
  done[lab] = true;
}
fs.writeFileSync(landedF, JSON.stringify(done));
const landed = !(label in plan) || done[label] === true;
console.log(landed ? `poll ${n}: ${label} landed (${label}.exit present)` : `poll ${n}: ${label} not landed yet (${label}.exit absent)`);
