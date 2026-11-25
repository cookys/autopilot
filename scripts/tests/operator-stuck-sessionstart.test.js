'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HANDLER = path.resolve(__dirname, '..', '..', 'src', 'hooks', 'handlers', 'session-start.js');

function fakeFleet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-ss-'));
  const bin = path.join(dir, 'fleet');
  const tasks = JSON.stringify([{ task_id: 'TASK1', state: 'waiting', assignee: 'a/b/lane--claude', waiting_on: 'external:operator reviews x' }]);
  fs.writeFileSync(bin, `#!/usr/bin/env bash\nif [ "$1" = tasks ]; then echo '${tasks}'; else echo '{"cards":[]}'; fi\n`, { mode: 0o755 });
  return bin;
}

function run(address, bin) {
  const code = `process.stdout.write(require(${JSON.stringify(HANDLER)}).stuckNoCardLines())`;
  const env = { ...process.env, OPERATOR_STUCK_FLEET_BIN: bin, FLEET_ADDRESS: address, AUTOPILOT_FLEET_ADDRESS: address, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-home-')) };
  return spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
}

test('PM seat gets the operator-blocked list injected', () => {
  const r = run('ns/courier/pm--claude', fakeFleet());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Operator-blocked tasks without a live decision card \(1\)/);
  assert.match(r.stdout, /TASK1 \| lane--claude/);
});

test('negative control: any other seat gets nothing', () => {
  const r = run('ns/courier/autopilot--claude', fakeFleet());
  assert.equal(r.stdout, '');
});

test('fleet failure is fail-open', () => {
  assert.equal(run('ns/courier/pm--claude', '/nonexistent/fleet').stdout, '');
});
