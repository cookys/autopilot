'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { report, reportByRole } = require('./dispatch-usage-report');

test('manifest snapshot counts only the last seven days and skips corrupt files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-report-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.now();
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dispatch-usage-report/runs.json')));
  for (const [i, fixture] of fixtures.entries()) {
    const { age_days, ...m } = fixture;
    m.started_at = new Date(now - age_days * 86400000).toISOString();
    fs.writeFileSync(path.join(dir, `${i}.manifest.json`), JSON.stringify(m));
  }
  fs.writeFileSync(path.join(dir, 'bad.manifest.json'), '{');
  const snapshot = report(dir, now, 7);
  assert.equal(snapshot.totals.runs, 3, 'old manifest must be excluded');
  assert.equal(snapshot.skipped, 1);
  assert.equal(snapshot.schema, 'dispatch-usage-report/1');
  assert.deepEqual(Object.keys(snapshot), ['schema', 'generated_at', 'since', 'host', 'totals', 'by_runner', 'skipped']);
  assert.equal(snapshot.host, os.hostname());
  assert.equal(snapshot.since, new Date(now - 7 * 86400000).toISOString());
  assert.deepEqual({ ...snapshot.totals.by_status }, { committed: 1, no_op: 1, failed: 1 });
  assert.deepEqual(snapshot.by_runner.codex.by_model.alpha, { runs: 2, committed: 1, failed: 0, no_op: 1, tokens_in: 12, tokens_out: 4 });
  assert.deepEqual(snapshot.by_runner.grok.by_model.beta, { runs: 1, committed: 0, failed: 1, no_op: 0 });
  const out = path.join(dir, 'snapshot.json');
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'dispatch-usage-report.js'), '--since', '7d', '--runs-dir', dir, '--out', out, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), JSON.parse(fs.readFileSync(out)));
});

test('authored status is a success, not a failure', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-report-authored-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'a.manifest.json'), JSON.stringify({ runner: 'codex', model: 'alpha', final_status: 'authored', started_at: new Date(now).toISOString() }));
  const g = report(dir, now, 7).by_runner.codex.by_model.alpha;
  assert.equal(g.runs, 1);
  assert.equal(g.failed, 0, 'authored must not count as failed');
});

test('reportByRole: groups by role, keeps rows with missing model as unknown, counts authored as succeeded, sums usd and unknown', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-role-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const ym = new Date(nowMs).toISOString().slice(0, 7).replace('-', '');
  const rows = [
    { run_id: 'r1', role: 'implementer', subagent_type: 'general-purpose', model: 'sonnet', usd: 0.25, status: 'authored', started_at: nowSec - 60, ended_at: nowSec - 10, usage: { input_tokens: 100, output_tokens: 50 } },
    { run_id: 'r2', role: 'implementer', subagent_type: null, model: null, usd: null, status: 'committed', started_at: nowSec - 50, ended_at: nowSec - 5, usage: { input_tokens: 200, output_tokens: 25 } },
    { run_id: 'r3', role: 'reviewer', subagent_type: 'Explore', model: 'gpt-5', usd: 0.1, status: 'runner_failed', started_at: nowSec - 40, ended_at: nowSec - 2, usage: { input_tokens: 10, output_tokens: 5 } },
  ];
  fs.writeFileSync(path.join(dir, `dispatch-usage-${ym}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const res = reportByRole(dir, nowMs, 7);
  assert.equal(res.schema, 'dispatch-usage-role-report/1');
  assert.equal(res.totals.runs, 3);
  assert.equal(res.totals.succeeded, 2);
  assert.equal(res.totals.failed, 1);
  assert.equal(res.totals.tokens, 390);
  assert.ok(Math.abs(res.totals.usd - 0.35) < 1e-9);
  assert.equal(res.totals.usd_unknown, 1);
  assert.equal(res.totals.model_unknown, 1);

  assert.deepEqual(res.by_role.implementer, {
    runs: 2,
    succeeded: 2,
    failed: 0,
    tokens: 375,
    usd: 0.25,
    usd_unknown: 1,
    model_unknown: 1,
    usd_display: '0.25+待量(1)',
  });
  assert.deepEqual(res.by_role.reviewer, {
    runs: 1,
    succeeded: 0,
    failed: 1,
    tokens: 15,
    usd: 0.1,
    usd_unknown: 0,
    model_unknown: 0,
    usd_display: 0.1,
  });

  const out = path.join(dir, 'role-report.json');
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'dispatch-usage-report.js'), '--by-role', '--since', '7d', '--runs-dir', dir, '--out', out, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), JSON.parse(fs.readFileSync(out, 'utf8')));
});

test('negative control: rows without role/model/usd show 待量, never a figure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dur-nc-'));
  const nowMs = Date.now(); const nowSec = Math.floor(nowMs / 1000);
  const ym = new Date(nowMs).toISOString().slice(0, 7).replace('-', '');
  fs.writeFileSync(path.join(dir, `dispatch-usage-${ym}.jsonl`), JSON.stringify({ run_id: 'n1', status: 'committed', started_at: nowSec - 10, ended_at: nowSec - 1 }) + '\n');
  const res = reportByRole(dir, nowMs, 7);
  assert.equal(res.totals.usd_display, '待量');
  assert.equal(res.by_role.unknown.usd_display, '待量');
  assert.equal(res.by_role.unknown.model_unknown, 1);
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'dispatch-usage-report.js'), '--by-role', '--runs-dir', dir, '--out', path.join(dir, 'o.json')], { encoding: 'utf8' });
  assert.match(cli.stdout, /unknown: 1 runs, usd 待量/);
});
