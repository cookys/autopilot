'use strict';
// run.js: --dry-run end to end, round timeout, hard stop, and the provider's lead mode via a stub codex.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('../lib');
const fx = require('../fixtures');
const { runExam } = require('../run');
const { callProvider } = require('../transport');

const items = lib.loadItems();
const RUN = path.join(__dirname, '..', 'run.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-test-'));

test('--dry-run end to end writes a run record and a valid report JSON, no model call', () => {
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--seed', 'dry-1', '--out-dir', tmp], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const run = JSON.parse(fs.readFileSync(path.join(tmp, 'run-dry-run-reference.json'), 'utf8'));
  assert.strictEqual(run.outputs.length, 6);
  assert.strictEqual(run.dry_run, true);
  const rep = JSON.parse(fs.readFileSync(path.join(tmp, 'report-dry-run-reference.json'), 'utf8'));
  assert.strictEqual(rep.schema, 'lead-exam-report/1');
  assert.strictEqual(rep.standalone_measurement, true);
  assert.strictEqual(rep.judge.stub, true);
  assert.strictEqual(rep.status, 'ok');
  assert.strictEqual(rep.examinees[0].total, 100);
  assert.deepStrictEqual(rep.examinees[0].hard_fails.all, []);
  assert.ok(rep.calls.length >= 7 && rep.calls.every((c) => 'ms' in c && 'in_tokens_est' in c));
  assert.strictEqual(rep.totals.tokens_are_estimates, true);
});

test('a live run without --kind/--model is a usage error (exit 2) and calls nothing', () => {
  const r = spawnSync(process.execPath, [RUN, '--seed', 'x', '--out-dir', tmp], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

// bounded: if the timeout were removed this call never settles, and the test's own 5 s limit turns that into a failure
// instead of a hang (the g1 negative control hung until the outer 170 s limit).
test('a round that exceeds its timeout is blank and flagged, later rounds still run', { timeout: 5000 }, async () => {
  const gold = fx.goldOutputs('t1', items);
  const rec = await runExam({
    items, seed: 't1', name: 'slow', model: 'stub', roundTimeoutMs: 30,
    call: async (_p, r) => (r === 2 ? new Promise(() => {}) : { text: gold[r - 1], ms: 1, in_tokens_est: 1, out_tokens_est: 1 }),
  });
  assert.strictEqual(rec.outputs[1], '');
  assert.strictEqual(rec.rounds[1].timed_out, true);
  assert.strictEqual(rec.outputs[2], gold[2]);
  assert.ok(rec.rounds[2].prompt_chars > 0);
});

test('the 24 minute hard stop blanks every remaining round', async () => {
  const gold = fx.goldOutputs('t1', items);
  let t = 0;
  const rec = await runExam({
    items, seed: 't1', name: 'late', model: 'stub', hardStopMs: 1000, now: () => t,
    call: async (_p, r) => { t += 600; return { text: gold[r - 1], ms: 1 }; },
  });
  assert.strictEqual(rec.outputs.filter((o) => o === '').length, 4);
  assert.ok(rec.rounds.slice(2).every((r) => r.timed_out));
});

test('a blank timed-out round is reported red by the grader and scores zero', async () => {
  const { gradeExam } = require('../grade');
  const jd = require('../judge');
  const outs = fx.goldOutputs('t2', items); outs[3] = '';
  const run = { name: 'x', model: 'stub', outputs: outs, rounds: [{ round: 4, timed_out: true }] };
  const rep = await gradeExam({ items, seed: 't2', runs: [run], judge: jd.stubJudge(items), rand: () => 0.3 });
  const e = rep.examinees[0];
  assert.ok(e.red.some((m) => /round 4 timed out/.test(m)));
  assert.strictEqual(e.categories.D.score, 0);
});

test('provider lead mode: raw text passes through untouched, prompt travels on stdin, role gating', async () => {
  const stub = path.join(tmp, 'stub-codex');
  fs.writeFileSync(stub, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({ stdin }));
const i = process.argv.indexOf('--output-last-message');
fs.writeFileSync(process.argv[i + 1], process.env.STUB_OUTPUT);
`, { mode: 0o755 });
  const capture = path.join(tmp, 'capture.json');
  const reply = '```json\n{"order":["PM-1"],"decisions":[],"claims":[]}\n```\n理由一行。\n理由二行。';
  const res = await callProvider('FAKE-PROMPT-BODY', {
    kind: 'codex', model: 'fake-model', timeoutMs: 20000, cliBin: stub,
    passEnv: { STUB_CAPTURE: capture, STUB_OUTPUT: reply, CODEX_HOME: path.join(tmp, 'fake-codex-home') },
  });
  assert.strictEqual(res.text, reply, 'not re-extracted, not re-serialized');
  const cap = JSON.parse(fs.readFileSync(capture, 'utf8'));
  assert.ok(cap.stdin.includes('FAKE-PROMPT-BODY'));
  assert.ok(cap.stdin.includes('TOOLS ARE FORBIDDEN'));
  assert.ok(!cap.stdin.includes('DATA UNDER REVIEW'));
  // a reviewer-role request to the lead mode is refused
  const bad = spawnSync(process.execPath, [require('../transport').PROVIDER], {
    input: JSON.stringify({ schema_version: 1, request_id: 'r', role: 'reviewer', payload: { format: 'case_content', content: 'x' } }),
    env: { PATH: process.env.PATH, QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'codex', QRP_CLI_BIN: stub, QRP_MODEL: 'm', QRP_PROVIDER: 'p', QRP_PROMPT_MODE: 'lead' },
    encoding: 'utf8',
  });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /lead-role case/);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
