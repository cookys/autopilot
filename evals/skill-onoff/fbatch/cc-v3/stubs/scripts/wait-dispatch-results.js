#!/usr/bin/env node
'use strict';
// Stub of scripts/wait-dispatch-results.js for the findings-batch eval fixture. One call = one poll. State lives in
// <common-git-dir>/fbatch/: plan.json (label -> {after, lane?, files}), waits (the poll counter: the fixture's only clock),
// landed.json. The Nth poll lands every plan entry whose `after` <= N by writing its files.
// "landed" is read from the file system and nowhere else (amendment 3): the label (a trailing .exit is ignored) is landed iff
// <root>/runs/<label>.exit exists. A label that names nothing (no plan entry, no such file) is reported as unknown, never as
// landed: the old rule "not in the plan = already landed" said landed for a run whose file did not exist.
// Plan entries also come from the dispatch stubs (_land.js register: repair, review, re-review, acceptance); they land on the
// Nth poll after the dispatch or after_s seconds after it (dispatch.json), whichever comes first.
// Ledger (_ledger.js, <common-git-dir>/fbatch/ledger.jsonl): each run appends a "call" entry first, then one "landed" entry
// per plan entry it lands (label, lane, files; wake:true when the turn-2 wake landed it). fbatch/cell.js builds the
// trace from the ledger: the state a later call sees is whatever the earlier "landed" entries say.
// FBATCH_LAND_ALL=1 (turn2.sh only) lands every entry without counting a poll and without a "call" entry.
const fs = require('fs');
const path = require('path');
const ledger = require('./_ledger.js');
const { land } = require('./_land.js');
const gitDir = path.resolve(require('child_process').execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
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
const now = Date.now();
const { plan, done } = land({ dir, root: process.cwd(), due: (spec) => landAll || n >= spec.after || (typeof spec.due_ts === 'number' && now >= spec.due_ts), by: landAll ? 'wake' : 'poll', wake: landAll });
const name = label.replace(/\.exit$/, '');
const key = name in plan ? name : Object.keys(plan).find((k) => Object.keys(plan[k].files || {}).includes(`runs/${name}.exit`));
const exitFile = path.resolve((key && plan[key].root) || process.cwd(), 'runs', `${name}.exit`);
const hasExit = key ? Object.keys(plan[key].files || {}).includes(`runs/${name}.exit`) : true;
const landed = fs.existsSync(exitFile) || (!hasExit && done[key] === true);
if (landed) console.log(`poll ${n}: ${label} landed (${name}.exit present)`);
else if (key) console.log(`poll ${n}: ${label} not landed yet (${name}.exit absent)`);
else console.log(`poll ${n}: ${label} unknown (no dispatched run and no file runs/${name}.exit; ${Object.keys(plan).filter((k) => !done[k]).length ? `pending: ${Object.keys(plan).filter((k) => !done[k]).join(', ')}` : 'nothing is pending'})`);
