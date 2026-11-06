'use strict';
// LEAD_EXAM_* timer seams may only shorten a timer. Over the production default: refuse (exit 2).
// Shorter: still runs. Unset: the production default is what is adopted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveKnobs } = require('../run');

const RUN = path.join(__dirname, '..', 'run.js');
const KNOBS = ['LEAD_EXAM_ROUND_TIMEOUT_MS', 'LEAD_EXAM_HARD_STOP_MS', 'LEAD_EXAM_KILL_GRACE_MS'];
const PROD = { LEAD_EXAM_ROUND_TIMEOUT_MS: 240000, LEAD_EXAM_HARD_STOP_MS: 1440000, LEAD_EXAM_KILL_GRACE_MS: 2000 };

function runDry(setEnv) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-knobs-'));
  const env = { ...process.env };
  KNOBS.forEach((k) => { delete env[k]; });
  Object.assign(env, setEnv);
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--seed', 'k', '--out-dir', out], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const record = path.join(out, 'run-dry-run-reference.json');
  return { status: r.status, stderr: r.stderr, record: fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : null };
}

test('unset knobs adopt the production defaults', () => {
  assert.deepStrictEqual(resolveKnobs({}), { roundTimeoutMs: 240000, hardStopMs: 1440000, graceMs: 2000 });
  const r = runDry({});
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.record.rounds[0].timeout_ms, 240000);
});

test('empty knob value is treated as unset', () => {
  assert.deepStrictEqual(resolveKnobs({ LEAD_EXAM_HARD_STOP_MS: '' }), { roundTimeoutMs: 240000, hardStopMs: 1440000, graceMs: 2000 });
});

for (const k of KNOBS) {
  test(`${k} above the production default refuses with exit 2`, () => {
    const r = runDry({ [k]: '3600000' });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, new RegExp(k));
    assert.strictEqual(r.record, null);
  });

  test(`${k} non-integer or non-positive refuses with exit 2`, () => {
    for (const bad of ['1.5', '0', '-5', 'abc']) {
      const r = runDry({ [k]: bad });
      assert.strictEqual(r.status, 2, `${k}=${bad}: ${r.stderr}`);
    }
  });

  test(`${k} shorter than the production default still runs`, () => {
    const short = k === 'LEAD_EXAM_ROUND_TIMEOUT_MS' ? '300' : String(PROD[k] - 1);
    const r = runDry({ [k]: short });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.record, 'run record written');
    if (k === 'LEAD_EXAM_ROUND_TIMEOUT_MS') assert.strictEqual(r.record.rounds[0].timeout_ms, 300);
  });
}
