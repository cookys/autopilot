#!/usr/bin/env node
// score-d0gate-v2.js - d0gate-v2 row scorer (prereg/d0gate-v2.json).
//   score-d0gate-v2.js --prereg <file.json> --results <file.jsonl>
//   score-d0gate-v2.js score --results <file.jsonl> --prereg <file.json>      (the form scripts/check-guidance-eval.js calls)
// The verdict is the mechanical decision table of d0gate-v2/lib-v2.js makeVerdictV2() (copied into the prereg): V1 (marker controls, skill_invoked >= 0.9 in
// both arms, no infra / missing / mistyped G1-G3 cell) -> INVALID; a missing G1-G3 cell -> INCOMPLETE; V2 (base G1 m_armed >= 4/5) -> NOT NEEDED; P0 kept no
// carrier -> NOT-SHIP; V3 and V4 -> PASS; anything else -> NOT-SHIP. G4 is an information field (owner decision d-002c917d): it is reported in the `g4`
// block and decides nothing. The marker controls (the P3 traces AND the G3v2 traces, each judged as expected) are RE-DERIVED here by running the traces
// through the stubs, never read from a file. Scoring is fixed to this directory's prereg/d0gate-v2.json (no other prereg, reps or model can be passed).
// Pilot rows, probe rows and stub-runner rows never count (stub rows only with D0GATE_ALLOW_STUB_ROWS=1, which the stub campaign sets; the output then says
// stub_rows_counted).
// stdout: "d0gate-v2: <VERDICT>" then ONE JSON object as the last line, whose `verdict` is SHIP for PASS (the word check-guidance-eval expects) and the
// table verdict otherwise; `d0gate_verdict` always carries the table verdict.
// Exit: 0 PASS, 4 NOT NEEDED, 3 NOT-SHIP / INCOMPLETE, 5 INVALID, 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const LV = require('./d0gate-v2/lib-v2');

const argv = process.argv.slice(2);
if (argv[0] === 'score') argv.shift();
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m, code = 2) => { console.error(`score-d0gate-v2: ${m}`); process.exit(code); };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) die('usage: score-d0gate-v2.js --prereg <file.json> --results <file.jsonl>');
let P;
let rows;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`prereg unreadable: ${preregPath}: ${e.message}`); }
try { rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { die(`results unreadable: ${resultsPath}: ${e.message}`); }
const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };
if (!same(preregPath, path.join(__dirname, 'prereg', 'd0gate-v2.json'))) die(`--prereg ${preregPath} is not this directory's prereg/d0gate-v2.json`);
if (P.row !== 'd0gate-v2') die(`prereg row is '${P.row}', not 'd0gate-v2'`);
for (const flagName of ['--reps', '--model']) if (val(flagName) !== undefined) die(`${flagName} cannot be passed: scoring is fixed by the prereg`);
const allowStub = process.env.D0GATE_ALLOW_STUB_ROWS === '1';
const T = LV.TASKS_V2;
const modelOf = (r) => (r.task_id === T.G4 ? P.g4_model : P.model);
const scored = rows.filter((r) => r && r.pilot !== true && r.probe !== true && (!r.row || r.row === P.row) && r.model === modelOf(r) && (allowStub || r.runner !== 'stub'));
const stubCounted = allowStub && scored.some((r) => r.runner === 'stub');
const TR1 = require('./d0gate/traces');
const TR2 = require('./d0gate-v2/traces-v2');
let c1;
let c2;
try { c1 = TR1.runControls(); c2 = TR2.runControls(); } finally { TR1.dropCells(); TR2.dropCells(); }
const failed = [...c1.results.filter((x) => !x.pass).map((x) => x.id), ...c2.results.filter((x) => !x.pass).map((x) => `${x.id}:${x.marker}`)];
const controlsOk = c1.ok && c2.ok;
const v = LV.verdictV2(scored, { ok: controlsOk, failed }, P.reps, P);
console.log(`d0gate-v2: ${v.verdict}`);
console.log(JSON.stringify({ reps: P.reps, cells: scored.length, stub_rows_counted: stubCounted, controls_ok: controlsOk, controls_checked: c1.results.length + c2.results.length, ...v, verdict: v.verdict === 'PASS' ? 'SHIP' : v.verdict, d0gate_verdict: v.verdict, v1_reference: P.v1_reference }));
process.exit({ PASS: 0, 'NOT NEEDED': 4, INVALID: 5 }[v.verdict] ?? 3);
