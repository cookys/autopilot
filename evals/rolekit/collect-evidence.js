#!/usr/bin/env node
'use strict';
// collect-evidence.js -- run the rolekit unit tests and write the G6 evidence file that score-rolekit.js (pilot mode) reads.
//   bash <suite env wrapper> node collect-evidence.js --row pilot --head <40-hex sha> --sentinel-calls <N> > evidence.json
// It RUNS the tests itself (node --test over test/*.test.js, no model call), takes pass/fail counts from the runner's own
// summary, and derives graders_red from the names of tests that passed: a grader is listed only if a test of its negative
// control (a bad output judged a failure, see README "Negative controls") passed in this run. --sentinel-calls is the count
// the suite wrapper printed (it cannot be observed from inside); score-rolekit accepts only the integer 0.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const row = opt('--row'); const head = opt('--head'); const sentinel = Number(opt('--sentinel-calls'));
if (!row || !/^[0-9a-f]{40}$/.test(head || '') || !Number.isInteger(sentinel)) { console.error('usage: collect-evidence.js --row pilot|formal --head <sha> --sentinel-calls <N>'); process.exit(2); }

const GRADER_TESTS = {
  reviewer: /^(negctl )?reviewer/, implementer: /^(negctl )?implementer/, verifier: /^(negctl )?verifier/, planner: /^(negctl )?planner/,
  debugger: /^(negctl )?debugger/, explorer: /^(negctl )?explorer/, 'score-rolekit': /^score-rolekit:/, 'compile-kit': /^negative controls: each broken kit/, 'stamp-rolekit': /^\(a\) after stamping/,
};
const dir = path.join(__dirname, 'test');
const only = opt('--only'); // test-only: restrict to named files (a partial run cannot satisfy G6)
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && (!only || only.split(',').includes(f))).sort().map((f) => path.join(dir, f));
const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // a nested run must report like a top-level one
const r = cp.spawnSync('node', ['--test', '--test-reporter=spec', ...files], { encoding: 'utf8', maxBuffer: 1 << 26, env });
const out = `${r.stdout}\n${r.stderr}`;
const num = (k) => { const m = new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(out); return m ? Number(m[1]) : NaN; };
const names = [...out.matchAll(/^✔ (.+?) \([\d.]+ms\)$/gm)].map((m) => m[1]);
const ev = {
  schema_version: 1, row, head_sha: head,
  unit_tests: { files: files.map((f) => path.basename(f)), tests: num('tests'), pass: num('pass'), fail: num('fail') },
  negative_controls: { graders_red: Object.entries(GRADER_TESTS).filter(([, re]) => names.some((n) => re.test(n))).map(([g]) => g) },
  sentinel_calls: sentinel,
};
process.stdout.write(`${JSON.stringify(ev, null, 2)}\n`);
process.exit(r.status === 0 ? 0 : 1);
