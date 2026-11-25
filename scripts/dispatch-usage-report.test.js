'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { report } = require('./dispatch-usage-report');

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
