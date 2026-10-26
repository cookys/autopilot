#!/usr/bin/env node
// score-fbatch-v2.js — findings-batch-v2 scorer (prereg/findings-batch-v2.json). A copy of score-fbatch.js (v1 is digest-frozen) that
// uses fbatch/lib-v2.js: the V3 rule for T1 m_clean_proceeds is non-inferiority (change >= 4/5), the rest is the v1 math. Below: the v1 header.
// score-fbatch.js — findings-batch row scorer (prereg/findings-batch.json, plan §4 decision rules).
//   score-fbatch.js --prereg <file.json> --results <file.jsonl> [--arms-dir <dir>] [--model sonnet|haiku] [--reps N]
// The rule math is fbatch/lib.js verdict(): V1 (skill_invoked ratio >= 0.9 in both arms, plus the marker-table
// negative/positive trace controls, computed here from the arms on disk), V2 (base already does it: NOT NEEDED),
// V3 (paired effect shape + one-sided Fisher p reported), V4 (change-arm safety; any T3 m_merge_blocked miss is
// NOT-SHIP). Only formal rows of --model (default: the prereg model) are read; pilot rows and rows of another model
// never count (pilot rates check wiring only, plan §4). A cell with no scorable row after its attempts ran out makes the grid INVALID (an infra row a later row replaced is only counted, amendment 1); a partial grid is
// INCOMPLETE and never PASS.
// Exit: 0 PASS, 4 NOT NEEDED (V2: the row closes without shipping), 3 NOT-SHIP / FAIL / INCOMPLETE,
//       5 INVALID (instrument or infra), 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./fbatch/lib-v2');

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m, code = 2) => { console.error(`score-fbatch-v2: ${m}`); process.exit(code); };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) die('usage: score-fbatch-v2.js --prereg <file.json> --results <file.jsonl> [--arms-dir <dir>] [--model sonnet|haiku] [--reps N]');
let P;
let rows;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`prereg unreadable: ${preregPath}: ${e.message}`); }
try { rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { die(`results unreadable: ${resultsPath}: ${e.message}`); }
if (!P || typeof P !== 'object' || typeof P.row !== 'string') die(`prereg ${preregPath} has no row`);
const model = val('--model') || P.model;
const reps = val('--reps') !== undefined ? Number(val('--reps')) : (P.reps || 5);
if (!Number.isInteger(reps) || reps < 1) die('--reps must be a positive integer');
const armsDir = path.resolve(val('--arms-dir') || path.join(__dirname, 'fbatch', 'arms'));
let controls;
try { controls = L.negativeControls(L.loadArms(armsDir)); } catch (e) { die(`arms unreadable: ${armsDir}: ${e.message}`); }
const scored = rows.filter((j) => j && j.pilot !== true && j.model === model && (!j.row || j.row === P.row));
const v = L.verdict(scored, controls, reps, P.row);
console.log(`${P.row}: ${v.verdict}`);
if (v.superseded_infra > 0) console.log(`infra rows superseded by a later scorable row (kept in the results file, not INVALID): ${v.superseded_infra}`);
console.log(JSON.stringify({ model, reps, cells: scored.length, controls, ...v }));
process.exit({ PASS: 0, 'NOT NEEDED': 4, INVALID: 5 }[v.verdict] ?? 3);
