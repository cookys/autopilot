'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide } = require('./shed-route.js');

test('routes only fresh listed mechanical work', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-route-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'burn-more.json');
  const now = new Date('2026-11-21T06:00:00Z');
  const write = (overrides = {}) => fs.writeFileSync(file, JSON.stringify({
    schema: 'capacity.burn_more/1', run_id: 'bm-test', generated_at: now.toISOString(),
    shed: { pools: [{ pool: 'stranity-personal', seats: ['capacity--claude'] }], rules: {
      mechanical_classes: ['文件', '測試'], targets_in_order: ['minimax', 'kimi', 'local-27b', 'codex'],
      keep_on_origin: ['判斷類工作'], prefer: 'from scratch first'
    } }, ...overrides
  }));
  const env = { AUTOPILOT_BURN_MORE: file, AUTOPILOT_FLEET_ADDRESS: 'ns/host/capacity--claude@session' };
  const briefText = 'Work-Class: 文件\nTask-Shape: from-scratch\n';
  write();
  assert.deepEqual(decide({ env, briefText, now }), { shed: true, run_id: 'bm-test', pool: 'stranity-personal', target: 'minimax', reason: 'listed_mechanical' });
  assert.equal(decide({ env, briefText: 'Work-Class: 測試\n', now }).target, 'local');
  assert.equal(decide({ env: { ...env, AUTOPILOT_FLEET_ADDRESS: 'ns/host/other@session' }, briefText, now }).reason, 'not_listed');
  assert.equal(decide({ env, briefText: 'Work-Class: 判斷類工作\n', now }).reason, 'not_mechanical');
  write({ shed: { pools: [{ pool: 'stranity-personal', seats: ['capacity--claude'] }], rules: {
    mechanical_classes: ['文件'], targets_in_order: ['minimax', 'kimi'], keep_on_origin: []
  } } });
  assert.equal(decide({ env, briefText: 'Work-Class: 文件\nTask-Shape: patch\n', now }).reason, 'no_eligible_target');
  assert.deepEqual(decide({ env, briefText, now, skippedTargets: [
    { target: 'minimax', reason: 'blocked-minimax' }, { target: 'kimi', reason: 'blocked-kimi' }
  ] }), { shed: false, reason: 'no_eligible_target', skipped_targets: [
    { target: 'minimax', reason: 'blocked-minimax' }, { target: 'kimi', reason: 'blocked-kimi' }
  ] });
  write({ generated_at: '2026-11-20T23:00:00Z' });
  assert.equal(decide({ env, briefText, now }).reason, 'stale');
  fs.rmSync(file);
  assert.equal(decide({ env, briefText, now }).reason, 'no_file');
  write();
  assert.equal(decide({ env: { ...env, AUTOPILOT_SHED_ROUTE: '0' }, briefText, now }).reason, 'off');
});
