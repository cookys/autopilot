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
  write('reviewer.manifest.json', {
    role: 'reviewer', runner: 'local', endpoint: 'qwen_local', started_at: now,
    review_receipt: { pass: true, first_review_pass: false }, rework_count: 0, queue_wait_s: null, queue_wait_ms: 1500,
  });
  write('evidence.manifest.json', {
    role: 'implementer', runner: 'local', endpoint: 'qwen_local', started_at: now,
    review_receipt: { pass: true, first_review_pass: false }, rework_count: 0, queue_wait_s: null, queue_wait_ms: 1500,
  });
  write('glm.manifest.json', { runner: 'local', endpoint: 'glm_local', started_at: now, local_fallback: null });
  const o = report(dir, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(o.local_runs, 5);
  assert.equal(o.implementer_total, 5);
  assert.deepEqual(o.by_endpoint, { qwen_local: 4, glm_local: 1 });
  assert.deepEqual(o.cloud_fallbacks, [{ reason: 'no_free_slot', count: 1 }, { reason: 'draining', count: 1 }]);
  assert.equal(o.local_first_review_pass.count, 1);
  assert.equal(o.local_first_review_pass.ratio, 1 / 3);
  assert.equal(o.local_reworked.count, 1);
  assert.equal(o.local_reworked.ratio, 1 / 3);
  assert.equal(o.mean_queue_wait_s, (2 + 4 + 1.5) / 3);
  assert.equal(o.fallbacks, 2);
  assert.deepEqual(o.fallback_reasons, {
    'no_free_slot:endpoint_not_ready': 1,
    'draining:draining': 1,
  });
  assert.deepEqual(o.backends, {});
  const none = report(dir, Date.parse('2099-01-01T00:00:00Z'));
  assert.equal(none.local_runs, 0);
  assert.equal(none.local_first_review_pass.count, null);
  assert.equal(none.mean_queue_wait_s, null);
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'local-impl-report.js'), '--dir', dir, '--since', '2026-11-21T00:00:00Z', '--text'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim().split('\n').length, 5);
  assert.match(cli.stdout, /本機派工 5 次/);
});

test('local-impl-report keys fallbacks by reason and detail prefix and counts backends', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lir-slots-'));
  const now = '2026-11-21T12:00:00Z';
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
  write('full.manifest.json', {
    runner: 'grok', started_at: now,
    local_fallback: { reason: 'no_free_slot', detail: 'all_full' },
    local_slots: { source: 'gateway', free: 0, backend: 'gpu-a', detail: 'all_full' },
  });
  write('fail.manifest.json', {
    runner: 'grok', started_at: now,
    local_fallback: { reason: 'no_free_slot', detail: 'slot_query_failed:timeout' },
    local_slots: { source: 'gateway', free: null, backend: null, detail: 'slot_query_failed:timeout' },
  });
  write('local.manifest.json', {
    runner: 'local', endpoint: 'qwen_local', started_at: now,
    local_fallback: null,
    local_slots: { source: 'gateway', free: 2, backend: 'gpu-a', detail: 'free' },
  });
  write('local-glm.manifest.json', { runner: 'local', endpoint: 'glm_local', started_at: now, local_slots: { source: 'gateway', free: 1, backend: 'gpu-b', detail: 'free' } });
  const o = report(dir, Date.parse('2026-11-21T00:00:00Z'));
  assert.equal(o.fallback_reasons['no_free_slot:all_full'], 1);
  assert.equal(o.fallback_reasons['no_free_slot:slot_query_failed'], 1);
  assert.deepEqual(o.backends, { 'gpu-a': 2, 'gpu-b': 1 });
  assert.deepEqual(o.by_endpoint, { qwen_local: 1, glm_local: 1 });
});
