#!/usr/bin/env node
'use strict';
// gate-scorer.js — `--scorer` adapter for scripts/check-guidance-eval.js: `score --results <jsonl> --prereg <json>`.
// Prints one last JSON line {verdict, reasons}. Re-derives the verdict from the recorded cells.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const argv = process.argv.slice(2);
const results = argv[argv.indexOf('--results') + 1];
const fail = (reasons) => { process.stdout.write(`${JSON.stringify({ verdict: 'UNSCORABLE', reasons })}\n`); process.exit(1); };
let row;
try { row = JSON.parse(fs.readFileSync(results, 'utf8').trim().split('\n')[0]); } catch (e) { fail([`unreadable results: ${e.message}`]); }
const cellsDir = path.resolve(path.dirname(results), row.cells || 'cells');
if (!fs.existsSync(cellsDir)) fail([`cells dir missing: ${cellsDir}`]);
const r = cp.spawnSync('node', [path.join(__dirname, 'harness.js'), 'score', '--phase', 'main', '--out', cellsDir], { encoding: 'utf8', maxBuffer: 1 << 26 });
let parsed; try { parsed = JSON.parse(r.stdout); } catch (e) { fail([`harness score unparseable: ${(r.stderr || '').slice(0, 200)}`]); }
const verdict = parsed.overall;
process.stdout.write(`${JSON.stringify({ verdict, reasons: parsed.seats.map((s) => `${s.seat}:${s.verdict}`) })}\n`);
process.exit(verdict === 'SHIP' ? 0 : 1);
