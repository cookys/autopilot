#!/usr/bin/env node
'use strict';
// Stub of scripts/wait-dispatch-results.js for the findings-batch eval fixture. One call = one poll. State lives in
// <git-dir>/fbatch/: plan.json (label -> {after, lane?, files}), waits (the poll counter: the fixture's only clock),
// landed.json. The Nth poll lands every plan entry whose `after` <= N by writing its files.
// A label that is not in the plan has already landed.
// Ledger (_ledger.js, <git-dir>/fbatch/ledger.jsonl): each run appends a "call" entry first, then one "landed" entry
// per plan entry it lands (label, lane, files; wake:true when the turn-2 wake landed it). fbatch/cell.js builds the
// trace from the ledger: the state a later call sees is whatever the earlier "landed" entries say.
// FBATCH_LAND_ALL=1 (turn2.sh only) lands every entry without counting a poll and without a "call" entry.
const fs = require('fs');
const path = require('path');
const ledger = require('./_ledger.js');
const { land } = require('./_land.js');
const gitDir = require('child_process').execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const dir = path.join(gitDir, 'fbatch');
const wf = path.join(dir, 'waits');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const landAll = process.env.FBATCH_LAND_ALL === '1';
if (!landAll) ledger.append({ kind: 'call', script: 'wait-dispatch-results.js', argv: process.argv.slice(2) });
let n = 0;
try { n = parseInt(fs.readFileSync(wf, 'utf8'), 10) || 0; } catch { /* first poll */ }
// Count the poll before anything can fail.
if (!landAll) { n += 1; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(wf, `${n}\n`); }
const i = process.argv.indexOf('--expect');
const label = i >= 0 ? process.argv[i + 1] : undefined;
if (!label) { console.error('usage: wait-dispatch-results.js --expect <run_id>.<stage>'); process.exit(2); }
const { plan, done } = land({ dir, root: process.cwd(), due: (spec) => landAll || n >= spec.after, by: landAll ? 'wake' : 'poll', wake: landAll });
const landed = !(label in plan) || done[label] === true;
console.log(landed ? `poll ${n}: ${label} landed (${label}.exit present)` : `poll ${n}: ${label} not landed yet (${label}.exit absent)`);
