'use strict';
// G40 D4 pure capture functions (plan 5.1, 6, 21.8). Run: node --test scripts/lib/account-capture.test.js
//   G40-N9   event extraction: last wins, missing window is absent, malformed is `bad`, a bare rejection is `none`
//   G40-N49  units: the capture code carries no millisecond spelling and builds seconds only
//   G40-N50  an overshoot is clamped once
//   G40-N78  shape (b) refusal row validates; nothing else is invented
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const c = require('./account-capture');
const observation = require('./account-observation');

const info = (uw, over) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: Object.assign({ status: 'allowed', unifiedWindows: uw }, over || {}) });
const W = (u, r) => ({ utilization: u, resetsAt: r, status: 'allowed' });

test('G40-N9: extractRateLimit takes the last event; five_hour and seven_day map to rolling_5h and weekly verbatim', () => {
  const text = [info({ five_hour: W(0.1, 1800003600) }), '{"type":"assistant"}', info({ five_hour: W(0.4, 1800003600), seven_day: W(0.2, 1800086400) })].join('\n');
  assert.deepStrictEqual(c.extractRateLimit(text), { status: 'event', windows: [
    { kind: 'rolling_5h', utilization: 0.4, resets_at: 1800003600 }, { kind: 'weekly', utilization: 0.2, resets_at: 1800086400 }] });
});

test('G40-N9: a window the event lacks is absent, never 0; an event with no window and a non-event stdout are `none`', () => {
  assert.deepStrictEqual(c.extractRateLimit(info({ seven_day: W(0.3, 1800086400) })).windows.map((w) => w.kind), ['weekly']);
  assert.deepStrictEqual(c.extractRateLimit(info({ five_hour: { status: 'allowed' } })), { status: 'none' });
  assert.deepStrictEqual(c.extractRateLimit(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', isUsingOverage: false } })), { status: 'none' });
  for (const t of ['', '{"type":"result","result":"OK"}\n', 'plain text', null, undefined, 42]) assert.deepStrictEqual(c.extractRateLimit(t), { status: 'none' });
});

test('G40-N9: rate_limit_info on a rejected result line counts; the older top-level shape is one window', () => {
  const res = JSON.stringify({ type: 'result', is_error: true, rate_limit_info: { unifiedWindows: { five_hour: W(1, 1800003600) } } });
  assert.strictEqual(c.extractRateLimit(res).windows[0].utilization, 1);
  const old = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.9, resetsAt: 1800086400 } });
  assert.deepStrictEqual(c.extractRateLimit(old).windows, [{ kind: 'weekly', utilization: 0.9, resets_at: 1800086400 }]);
});

test('G40-N9: a malformed event is `bad`, and a bad LAST event is not rescued by an earlier good one', () => {
  const good = info({ five_hour: W(0.4, 1800003600) });
  for (const bad of [info('x'), info({ five_hour: W('0.4', 1800003600) }), info({ five_hour: W(0.4, '1800003600') }), JSON.stringify({ type: 'rate_limit_event', rate_limit_info: [] }),
    '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":']) {
    assert.deepStrictEqual(c.extractRateLimit(`${good}\n${bad}\n`), { status: 'bad' }, bad.slice(0, 50));
  }
});

test('G40-N50: buildPassiveRow clamps an overshoot once and rejects a value above 1.5', () => {
  const ok = c.buildPassiveRow({ alias: 'a', windows: [{ kind: 'rolling_5h', utilization: 1.02, resets_at: 1800003600 }], observedAtS: 1799999000, hostRole: 'agent' });
  assert.ok(ok.ok);
  assert.deepStrictEqual([ok.record.windows[0].utilization, ok.record.windows[0].clamped], [1, true]);
  assert.strictEqual(ok.record.windows[0].source, 'passive');
  assert.strictEqual(ok.record.windows[0].observed_at, 1799999000);
  assert.strictEqual(ok.record.visibility, 'L3');
  assert.strictEqual(c.buildPassiveRow({ alias: 'a', windows: [{ kind: 'rolling_5h', utilization: 62, resets_at: 1800003600 }], observedAtS: 1799999000 }).ok, false);
  assert.strictEqual(c.buildPassiveRow({ alias: 'a', source: 'probe', windows: [{ kind: 'weekly', utilization: 0.1, resets_at: null }], observedAtS: 1799999000 }).record.windows[0].source, 'probe');
});

test('G40-N78: buildRefusalRow is shape (b): L1, no window, no record-level source; retry_at only when after observed_at', () => {
  const r = c.buildRefusalRow({ alias: 'a', observedAtS: 1799999000, retryAtS: 1800000000, reason: 'quota', hostRole: 'agent' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.record.windows, []);
  assert.deepStrictEqual(r.record.refusal, { observed_at: 1799999000, retry_at: 1800000000, reason: 'quota' });
  assert.strictEqual(r.record.visibility, 'L1');
  assert.strictEqual('source' in r.record, false);
  assert.strictEqual(c.buildRefusalRow({ alias: 'a', observedAtS: 1799999000, retryAtS: 1799990000, reason: 'rate_limit' }).record.refusal.retry_at, null);
  assert.strictEqual(c.buildRefusalRow({ alias: 'a', observedAtS: 1799999000, retryAtS: null, reason: 'rate_limit' }).record.refusal.retry_at, null);
  assert.strictEqual(c.buildRefusalRow({ alias: 'a', observedAtS: 1799999000, reason: 'bogus' }).ok, false);
});

test('G40-N78: parseRetryAt reads the usage-limit epoch and nothing else', () => {
  assert.strictEqual(c.parseRetryAt('API Error: 429 Claude AI usage limit reached|1799999999'), 1799999999);
  assert.strictEqual(c.parseRetryAt('This request would exceed your account\'s rate limit'), null);
  assert.strictEqual(c.parseRetryAt(undefined), null);
});

test('G40-N74: captureReason maps a failed write to a closed audit code and treats superseded as no failure', () => {
  assert.strictEqual(c.captureReason({ ok: true, superseded: true }), null);
  assert.strictEqual(c.captureReason({ ok: true, path: 'x', reset: false }), null);
  assert.strictEqual(c.captureReason({ ok: false, code: 'mirror_lock_busy' }), 'mirror_lock_busy');
  assert.strictEqual(c.captureReason({ ok: false, code: 'view_unsupported', reason: 'schema' }), 'view_unsupported');
  assert.strictEqual(c.captureReason({ ok: false, code: 'write_failed', reason: 'lock_unreadable:EACCES' }), 'lock_unreadable:EACCES');
  assert.strictEqual(c.captureReason({ ok: false, code: 'write_failed' }), 'write_failed');
  assert.strictEqual(c.captureReason({ ok: false, code: 'something_new' }), 'capture_error');
  assert.strictEqual(c.captureReason({ ok: false, code: 'write_failed', reason: 'sk-ant-leak' }), 'write_failed');
});

test('G40-N49: the capture and probe libraries hold no millisecond spelling and no clock read', () => {
  for (const f of ['account-capture.js', 'account-probe.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\b\w+_ms\b/.test(src), `${f}: no *_ms spelling`);
    assert.ok(!/Date\.now|new Date|performance\.now/.test(src), `${f}: no clock read`);
    assert.ok(!/child_process|\bspawn\b|credentials|\.claude/.test(src), `${f}: no spawn, no credential path`);
  }
  const b = c.buildPassiveRow({ alias: 'a', windows: [{ kind: 'rolling_5h', utilization: 0.5, resets_at: 1800003600 }], observedAtS: 1799999000 });
  assert.strictEqual(observation.hasMsKey(b.record), false);
  assert.strictEqual(c.buildPassiveRow({ alias: 'a', windows: [{ kind: 'rolling_5h', utilization: 0.5, resets_at: 1800003600 }], observedAtS: 1799999000000 }).ok, false, 'a millisecond observed_at is refused by the contract');
});
