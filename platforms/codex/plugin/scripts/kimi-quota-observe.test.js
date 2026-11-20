'use strict';
// kimi quota from dispatch errors (Fleet task 01M7E1H0): fixture stderr only, temp live dir, no real kimi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const q = require('./lib/kimi-quota-observe');
const obs = require('./lib/account-observation');
const { selectEngine, loadRoles } = require('./pace-select');
const net = require('net');

const live = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-quota-'));
fs.chmodSync(live, 0o700);
const NOW = 1_800_000_000_000;
const nowS = NOW / 1000;
const row = () => obs.readView(live, 'kimi', 'default', {}).view.rows[0].record;

test('429 text -> exhausted with the reset parsed (seconds, minutes, ISO), written to the quota mirror', () => {
  let r = q.observe({ rc: 1, text: 'Error: HTTP 429 Too Many Requests. Try again in 90 seconds', liveDir: live, now: NOW });
  assert.deepEqual([r.wrote, r.state], [true, 'exhausted']);
  assert.deepEqual(row().refusal, { observed_at: nowS, retry_at: nowS + 90, reason: 'rate_limit' });
  r = q.observe({ rc: 1, text: 'usage limit reached, retry in 5 minutes', liveDir: live, now: NOW });
  assert.equal(row().refusal.retry_at, nowS + 300); assert.equal(row().refusal.reason, 'quota');
  q.observe({ rc: 1, text: 'quota exhausted, resets at 2027-01-15T08:00:00Z', liveDir: live, now: NOW });
  assert.equal(row().refusal.retry_at, Date.parse('2027-01-15T08:00:00Z') / 1000);
  q.observe({ rc: 1, text: 'rate limit exceeded', liveDir: live, now: NOW });
  assert.equal(row().refusal.retry_at, null, 'no parsable reset: null');
});

test('exhausted pool is not pickable until the reset, then it is; no reset uses a 60 minute TTL', () => {
  q.observe({ rc: 1, text: '429 rate limit. retry-after: 120', liveDir: live, now: NOW });
  assert.equal(q.exhaustedKimi({ liveDir: live, now: NOW + 119_000 }), true);
  assert.equal(q.exhaustedKimi({ liveDir: live, now: NOW + 121_000 }), false);
  q.observe({ rc: 1, text: 'rate limit', liveDir: live, now: NOW });
  assert.equal(q.exhaustedKimi({ liveDir: live, now: NOW + 3_599_000 }), true);
  assert.equal(q.exhaustedKimi({ liveDir: live, now: NOW + 3_601_000 }), false);
});

test('a clean run records available and clears the exhaustion', () => {
  q.observe({ rc: 1, text: '429', liveDir: live, now: NOW });
  const r = q.observe({ rc: 0, text: 'done', liveDir: live, now: NOW + 1000 });
  assert.deepEqual([r.wrote, r.state], [true, 'available']);
  assert.equal(row().refusal, null); assert.equal(row().token_state, 'ok');
  assert.equal(q.exhaustedKimi({ liveDir: live, now: NOW + 2000 }), false);
});

test('an unrelated error writes nothing', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-quota-'));
  fs.chmodSync(other, 0o700);
  const r = q.observe({ rc: 2, text: 'SyntaxError: unexpected token in task file', liveDir: other, now: NOW });
  assert.deepEqual([r.wrote, r.state], [false, null]);
  assert.equal(fs.existsSync(path.join(other, 'quota')), false);
  fs.rmSync(other, { recursive: true, force: true });
});

test('pace-select never returns an exhausted kimi (negative control: available broker is returned)', async () => {
  const socket = path.join(live, 'broker.sock');
  let connections = 0;
  const server = net.createServer(conn => { connections++; conn.destroy(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  let clock = Date.now();
  const pace = { schema: 'capacity.pace/1', rows: [{ pool: 'kimi', used_pct: 5, expected_pct: 60, stale: false, seen_at: new Date(clock).toISOString(), hours_to_reset: 12 }] };
  const env = { ...process.env, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_KIMI_BROKER_SOCK: socket,
    AUTOPILOT_TASK_SIZE: 'S', AUTOPILOT_TASK_SCOPE: 'docs/example.md' };
  const roles = loadRoles();
  const pick = () => selectEngine({ pace, role: 'implementer', roles, env, now: new Date(clock) });
  try {
    q.observe({ verdict: 'done', liveDir: live, now: clock });
    assert.equal(pick().engine, 'kimi', 'clear quota and a broker socket admit the measured seat');
    q.observe({ verdict: 'stopped_billing', billing_confirmed: true, liveDir: live, now: clock });
    assert.notEqual(pick().engine, 'kimi', 'billing stop excludes the same seat');
    clock += (q.UNKNOWN_RESET_TTL_S + 1) * 1000;
    assert.equal(pick().engine, 'kimi', 'expired exhaustion admits a recheck');
    q.observe({ verdict: 'stopped_billing', billing_confirmed: true, liveDir: live, now: clock });
    assert.notEqual(pick().engine, 'kimi');
    q.observe({ verdict: 'done', text: 'old quota error', liveDir: live, now: clock });
    assert.equal(pick().engine, 'kimi', 'structured done clears old quota text');
    env.AUTOPILOT_KIMI_BROKER_SOCK = path.join(live, 'absent.sock');
    assert.notEqual(pick().engine, 'kimi', 'clear quota cannot substitute for the socket');
    assert.equal(connections, 0, 'availability never connects to the stub broker');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

const FP_LINE = '# Self-bootstrapping: installs the pinned toolchain + rustfmt on demand, so a';

test('unconfirmed stopped_billing writes no refusal and does not mark token_state ok', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-quota-fp-'));
  fs.chmodSync(dir, 0o700);
  q.observe({ rc: 1, text: '429 retry-after: 30', liveDir: dir, now: NOW });
  const before = JSON.stringify(rowOf(dir));
  const r = q.observe({ verdict: 'stopped_billing', billing_confirmed: false, billing_line: FP_LINE, liveDir: dir, now: NOW + 1000 });
  assert.equal(r.wrote, false);
  assert.equal(JSON.stringify(rowOf(dir)), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('confirmed stopped_billing writes the 60 minute refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-quota-bill-'));
  fs.chmodSync(dir, 0o700);
  const r = q.observe({ verdict: 'stopped_billing', billing_confirmed: true, billing_line: 'masked', liveDir: dir, now: NOW });
  assert.equal(r.wrote, true);
  const rec = obs.readView(dir, 'kimi', 'default', {}).view.rows[0].record;
  assert.deepEqual(rec.refusal, { observed_at: nowS, retry_at: nowS + q.UNKNOWN_RESET_TTL_S, reason: 'quota' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('old broker stopped_billing without the two fields writes no refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-quota-old-'));
  fs.chmodSync(dir, 0o700);
  const r = q.observe({ verdict: 'stopped_billing', liveDir: dir, now: NOW });
  assert.equal(r.wrote, false);
  assert.equal(fs.existsSync(path.join(dir, 'quota')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

function rowOf(dir) {
  return obs.readView(dir, 'kimi', 'default', {}).view.rows[0].record;
}

test.after(() => { fs.rmSync(live, { recursive: true, force: true }); });
