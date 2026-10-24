// Negative controls for check-recompute.js. Run inside this directory: node test-check-recompute.js
// Works on temporary copies: the unmodified copy must pass; each single-input mutation must make the checker exit non-zero.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const here = __dirname; let bad = 0;
const run = (dir) => cp.spawnSync('node', ['check-recompute.js'], { cwd: dir, encoding: 'utf8' }).status;
const copy = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ncr-')); fs.cpSync(here, d, { recursive: true }); return d; };
const expect = (name, got, want) => { const ok = (want === 0) === (got === 0); console.log((ok ? 'ok   ' : 'FAIL ') + name + ' (exit ' + got + ')'); if (!ok) bad = 1; };
let d = copy(); expect('unmodified copy passes', run(d), 0);
const mut = (name, fn) => { const x = copy(); fn(x); expect('mutation fails: ' + name, run(x), 1); fs.rmSync(x, { recursive: true, force: true }); };
const sub = (f, a, b) => (x) => { const p = path.join(x, f); const s = fs.readFileSync(p, 'utf8'); if (!s.includes(a)) throw new Error('mutation target not found in ' + f); fs.writeFileSync(p, s.replace(a, b)); };
mut('flip a block to allow in a hook log', sub('raw-excerpts/t3/hook.log', '"decision":"block"', '"decision":"allow"'));
mut('change a result cost in a stream excerpt', sub('raw-excerpts/t2/stream-excerpt--.jsonl', '"total_cost_usd":0.016572', '"total_cost_usd":0.026572'));
mut('change the mishap cost', sub('mishap-call.txt', 'mishap_cost_usd=0.032369', 'mishap_cost_usd=0.132369'));
mut('delete a debug partner file', (x) => fs.rmSync(path.join(x, 'raw-excerpts/t2/debug-stop-lines--.txt')));
mut('change a first timestamp in call-times.txt', sub('call-times.txt', '2026-10-24T00:39:32.738Z', '2026-10-24T00:39:32.739Z'));
fs.rmSync(d, { recursive: true, force: true });
console.log(bad ? 'FAILED' : 'all negative controls behave'); process.exit(bad);
