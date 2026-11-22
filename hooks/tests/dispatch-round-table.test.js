'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../scripts/dispatch-round-table.js');
test('sorted manifests, filters and log tokens', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-table-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'log');
  fs.writeFileSync(log, 'tokens used\n100\ntokens used\n1,234\n');
  const task = '01M81F6G5TWF8AP2EN5PT0T4JJ';
  const first = { run_id: 'hetero-a', runner: 'codex', model: 'model', branch: 'feat/one', commit: '123456789abcdef', started_at: '2025-01-01T01:00:00Z', ended_at: '2025-01-01T02:00:00Z', final_status: 'committed', fleet_task: task, log_path: log };
  const second = { run_id: 'hetero-b', branch: 'feat/two', started_at: '2025-01-02T01:00:00Z', log_path: path.join(dir, 'missing') };
  fs.writeFileSync(path.join(dir, 'hetero-0.manifest.json'), JSON.stringify(second));
  fs.writeFileSync(path.join(dir, 'hetero-1.manifest.json'), JSON.stringify(first));
  const run = (...args) => execFileSync(process.execPath, [script, '--since', '2025-01-01T00:00:00Z', ...args], { env: { ...process.env, AUTOPILOT_DISPATCH_RUNS_DIR: dir }, encoding: 'utf8' });
  assert.deepEqual(run().trim().split('\n'), [
    'hetero-a | codex | model | feat/one | 123456789 | 2025-01-01T01:00:00Z | 2025-01-01T02:00:00Z | committed | 1,234',
    'hetero-b | - | - | feat/two | - | 2025-01-02T01:00:00Z | - | - | -',
  ]);
  assert.equal(JSON.parse(run('--since', '2025-01-02T00:00:00Z', '--json'))[0].run_id, 'hetero-b');
  assert.equal(JSON.parse(run('--branch', 'one', '--task', task, '--json')).length, 1);
  assert.equal(JSON.parse(run('--task', '01M81F6G5TWF8AP2EN5PT0T4JK', '--json')).length, 0);
});
