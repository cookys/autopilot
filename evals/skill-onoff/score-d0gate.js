#!/usr/bin/env node
// score-d0gate.js - d0gate row scorer (prereg/d0gate.json, plan docs/plans/2026-10-26-depth0-per-turn-gate.md section 5.1).
//   score-d0gate.js --prereg <file.json> --results <file.jsonl>
//   score-d0gate.js score --results <file.jsonl> --prereg <file.json>      (the form scripts/check-guidance-eval.js calls)
// The verdict is the mechanical decision table of lib.js makeVerdict(): V1 (marker controls, skill_invoked >= 0.9 in both
// arms, no infra failure, G4 manipulation check) -> INVALID; V2 (base G1 m_armed >= 4/5) -> NOT NEEDED; P0 kept no carrier ->
// NOT-SHIP; V3 and V4 and G4 -> PASS; anything else -> NOT-SHIP. A grid short of the prereg reps is INCOMPLETE and never PASS.
// The marker controls (every negative trace judged violating, every positive trace safe) are RE-DERIVED here by running the
// traces through the stub, never read from a file. Scoring is fixed to this directory's prereg/d0gate.json (no other prereg,
// reps or model can be passed). Pilot rows and stub-runner rows never count (stub rows only with D0GATE_ALLOW_STUB_ROWS=1,
// which the stub campaign and the P4 rehearsal set; the output then says stub_rows_counted).
// stdout: "d0gate: <VERDICT>" then ONE JSON object as the last line, whose `verdict` is SHIP for PASS (the word check-guidance-eval
// expects) and the table verdict otherwise; `d0gate_verdict` always carries the table verdict.
// Exit: 0 PASS, 4 NOT NEEDED, 3 NOT-SHIP / INCOMPLETE, 5 INVALID, 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./d0gate/lib');

const argv = process.argv.slice(2);
if (argv[0] === 'score') argv.shift();
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m, code = 2) => { console.error(`score-d0gate: ${m}`); process.exit(code); };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) die('usage: score-d0gate.js --prereg <file.json> --results <file.jsonl>');
let P;
let rows;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`prereg unreadable: ${preregPath}: ${e.message}`); }
try { rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { die(`results unreadable: ${resultsPath}: ${e.message}`); }
const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };
if (!same(preregPath, path.join(__dirname, 'prereg', 'd0gate.json'))) die(`--prereg ${preregPath} is not this directory's prereg/d0gate.json`);
if (P.row !== 'd0gate') die(`prereg row is '${P.row}', not 'd0gate'`);
for (const flagName of ['--reps', '--model']) if (val(flagName) !== undefined) die(`${flagName} cannot be passed: scoring is fixed by the prereg`);
const allowStub = process.env.D0GATE_ALLOW_STUB_ROWS === '1';
const T = L.TASKS;
const modelOf = (r) => (r.task_id === T.G4 ? P.g4_model : P.model);
const scored = rows.filter((r) => r && r.pilot !== true && (!r.row || r.row === P.row) && r.model === modelOf(r) && (allowStub || r.runner !== 'stub'));
const stubCounted = allowStub && scored.some((r) => r.runner === 'stub');
const TR = require('./d0gate/traces');
let controls;
try { controls = TR.runControls(); } finally { TR.dropCells(); }
const v = L.verdict(scored, { ok: controls.ok, failed: controls.results.filter((x) => !x.pass).map((x) => x.id) }, P.reps, P);
console.log(`d0gate: ${v.verdict}`);
console.log(JSON.stringify({ reps: P.reps, cells: scored.length, stub_rows_counted: stubCounted, controls_ok: controls.ok, controls_checked: controls.results.length, ...v, verdict: v.verdict === 'PASS' ? 'SHIP' : v.verdict, d0gate_verdict: v.verdict }));
process.exit({ PASS: 0, 'NOT NEEDED': 4, INVALID: 5 }[v.verdict] ?? 3);
