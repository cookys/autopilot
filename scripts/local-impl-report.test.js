'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { report } = require('./local-impl-report');

test('local-impl-report counts local runs, review fields, and fallbacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lir-'));
  const now = '2026-11-21T12:00:00Z';
  const old = '2020-01-01T00:00:00Z';
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
  write('a.manifest.json', {
    runner: 'local', endpoint: 'qwen_local', started_at: now,
    review_receipt: { first_pass: true, reworked: false }, queue_wait_s: 2, local_fallback: null,
  });
  write('b.manifest.json', {
    runner: 'local', started_at: now,
    review_receipt: { first_pass: false, reworked: true }, queue_wait_s: 4,
  });
  write('c.manifest.json', {
    runner: 'grok', model: 'grok-4.7', started_at: now,
    local_fallback: { reason: 'no_free_slot', detail: 'endpoint_not_ready' },
  });
  write('d.manifest.json', {
    runner: 'grok', started_at: now,
    local_fallback: { reason: 'draining', detail: 'draining' },
  });
  write('old.manifest.json', { runner: 'local', started_at: old, review_receipt: { first_pass: true } });
  write('unknown.manifest.json', { runner: 'local', started_at: now });
  const o = report(dir, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(o.local_runs, 3);
  assert.equal(o.local_first_review_pass.count, 1);
  assert.equal(o.local_first_review_pass.ratio, 0.5);
  assert.equal(o.local_reworked.count, 1);
  assert.equal(o.local_reworked.ratio, 0.5);
  assert.equal(o.mean_queue_wait_s, 3);
  assert.equal(o.fallbacks, 2);
  assert.deepEqual(o.fallback_reasons, { no_free_slot: 1, draining: 1 });
  const none = report(dir, Date.parse('2099-01-01T00:00:00Z'));
  assert.equal(none.local_runs, 0);
  assert.equal(none.local_first_review_pass.count, null);
  assert.equal(none.mean_queue_wait_s, null);
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'local-impl-report.js'), '--dir', dir, '--since', '2026-11-21T00:00:00Z', '--text'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim().split('\n').length, 5);
  assert.match(cli.stdout, /本機派工 3 次/);
});
