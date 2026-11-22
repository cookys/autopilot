'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../scripts/lib/dispatch-strike.js');
const { strikes } = require(script);

function fixture(t, statuses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-strike-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  statuses.forEach((status, i) => fs.writeFileSync(path.join(dir, `${i}.manifest.json`), JSON.stringify({
    run_id: `run-${i}`, runner: 'fixture', fleet_task: 'task', started_at: `2026-01-01T00:00:0${i}Z`,
    final_status: status, commit: status === 'committed' ? 'abc' : null,
  })));
  return dir;
}
function cli(dir) { return spawnSync(process.execPath, [script, '--task', 'task'], { encoding: 'utf8', env: { ...process.env, AUTOPILOT_DISPATCH_RUNS_DIR: dir } }); }

test('success resets two failures and filters task and since', t => {
  const dir = fixture(t, ['failure', 'no_op', 'committed']);
  const result = strikes(dir, { fleetTask: 'task' });
  assert.equal(result.strikes, 0);
  assert.deepEqual(result.rounds.map(r => r.status), ['failure', 'no_op', 'committed']);
  assert.equal(strikes(dir, { fleetTask: 'other' }).rounds.length, 0);
  assert.equal(strikes(dir, { fleetTask: 'task', since: '2026-01-01T00:00:01Z' }).rounds.length, 2);
});
test('two tail failures escalate', t => {
  const dir = fixture(t, ['committed', 'failure', 'boundary_rejected']);
  const result = cli(dir);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /strikes=2 rounds=3\ntwo-strike: change approach or escalate to the lead \(P1 01M81F6G5\)/);
});
test('one failure exits zero', t => {
  const result = cli(fixture(t, ['no_op']));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'strikes=1 rounds=1\n');
});
