'use strict';
// kimi quota from dispatch errors (Fleet task 01M7E1H0): fixture stderr only, temp live dir, no real kimi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const q = require('./lib/kimi-quota-observe');
const obs = require('./lib/account-observation');
const { selectEngine } = require('./pace-select');

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

test('pace-select never returns an exhausted kimi (negative control: available is returned)', () => {
  const pace = { schema: 'capacity.pace/1', rows: [{ key: 'kimi', used_pct: 5, expected_pct: 60, stale: false }] };
  const pick = () => {
    try { return selectEngine({ pace, role: 'implementer', pools: undefined, roles: { implementer: ['kimi'], _disabled: [] } }); } catch (e) { return { error: e.code || e.message }; }
  };
  const saved = process.env.AUTOPILOT_LIVE_DIR;
  process.env.AUTOPILOT_LIVE_DIR = live;
  try {
    q.observe({ rc: 0, text: 'ok', liveDir: live, now: Date.now() });
    const ok = pick();
    q.observe({ rc: 1, text: '429 rate limit retry in 10 minutes', liveDir: live, now: Date.now() });
    const bad = pick();
    assert.notEqual(JSON.stringify(ok), JSON.stringify(bad), 'exhaustion changes the pick');
    assert.doesNotMatch(JSON.stringify(bad), /"key":"kimi"|"engine":"kimi/);
  } finally { if (saved === undefined) delete process.env.AUTOPILOT_LIVE_DIR; else process.env.AUTOPILOT_LIVE_DIR = saved; }
});

test.after(() => { fs.rmSync(live, { recursive: true, force: true }); });
