'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const q = require('./lib/cursor-quota-observe');
const obs = require('./lib/account-observation');
const client = require('./lib/cursor-broker-client');

const NOW = 1_800_000_000_000;
const nowS = NOW / 1000;
const FP_LINE = '# Self-bootstrapping: installs the pinned toolchain + rustfmt on demand, so a';

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-quota-'));
  fs.chmodSync(dir, 0o700);
  return dir;
}
function record(dir) {
  const view = obs.readView(dir, 'cursor', 'default', {}).view;
  return view ? view.rows[0].record : null;
}

test('unconfirmed stopped_billing writes no refusal and does not mark token_state ok', () => {
  const dir = fresh();
  q.observe({ verdict: 'done', liveDir: dir, now: NOW });
  const before = JSON.stringify(record(dir));
  const r = q.observe({ verdict: 'stopped_billing', billing_confirmed: false, billing_line: FP_LINE, liveDir: dir, now: NOW + 1000 });
  assert.equal(r.wrote, false);
  assert.equal(JSON.stringify(record(dir)), before);
  assert.notEqual(record(dir).token_state, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('confirmed stopped_billing writes the 60 minute refusal', () => {
  const dir = fresh();
  const r = q.observe({ verdict: 'stopped_billing', billing_confirmed: true, billing_line: 'masked', liveDir: dir, now: NOW });
  assert.equal(r.wrote, true);
  assert.deepEqual(record(dir).refusal, { observed_at: nowS, retry_at: nowS + q.RECHECK_S, reason: 'quota' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('old broker stopped_billing without the two fields writes no refusal', () => {
  const dir = fresh();
  const r = q.observe({ verdict: 'stopped_billing', liveDir: dir, now: NOW });
  assert.equal(r.wrote, false);
  assert.equal(record(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('projectReply passes billing_confirmed and billing_line; missing fields are false and empty', () => {
  const base = { ok: false, diff: '', log: '', run_id: 'run-1', verdict: 'stopped_billing', reason: 'quota' };
  const present = client.projectReply({ ...base, billing_confirmed: true, billing_line: FP_LINE }, 'cursor').response;
  assert.equal(present.billing_confirmed, true);
  assert.equal(present.billing_line, FP_LINE);
  assert.equal(present.run_id, 'run-1');
  const missing = client.projectReply(base, 'kimi').response;
  assert.equal(missing.billing_confirmed, false);
  assert.equal(missing.billing_line, '');
  assert.equal(missing.run_id, 'run-1');
});
