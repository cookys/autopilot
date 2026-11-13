'use strict';
// P2 step 2. Stubs only (deps.run / deps.now / deps.sleep / deps.fs). No tmux, claude, fleet or codeforge process.
//
// Negative control (evidence-discipline §58), shown red first: a handoff file that already
// exists but is older than the request must not count. With the mtime comparison removed
// (existence alone), that case returns ok and this test is red. With the comparison, the
// wait sleeps until the timeout and the test is green.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { requestHandoff, DEFAULT_TIMEOUT_MS } = require('./lane-switch-handoff.js');
const { journalFile } = require('./switch-journal.js');

const ORDER = '01M70ABCDE';
const SEAT = 'ns/c/lane--claude';
const LANE = 'l1';
const HANDOFF = '/work/proj/HANDOFF.md';
const START = 10_000;

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lsw-ho-'));
}
function rows(base) {
  return fs.readFileSync(journalFile(base), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// timeline[i] is observation i (stat, then peers). Past the end, the last row repeats.
function scripted(timeline, { sendStatus = 0, timeoutMs, pollMs = 1000 } = {}) {
  const base = tempBase();
  let clock = START;
  let step = 0;
  let sleeps = 0;
  const calls = [];
  const at = (i) => timeline[Math.min(i, timeline.length - 1)];
  const deps = {
    now: () => clock,
    sleep: async (ms) => { sleeps += 1; clock += ms; },
    fs: {
      statSync: (p) => {
        assert.strictEqual(p, HANDOFF);
        const row = at(step);
        step += 1;
        if (!row.exists) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
        return { mtimeMs: row.mtimeMs };
      },
    },
    run: (cmd, args) => {
      calls.push([cmd, [...args]]);
      assert.strictEqual(cmd, 'fleet');
      if (args[0] === 'send') return { status: sendStatus, stdout: '', stderr: sendStatus === 0 ? '' : 'refused' };
      if (args[0] === 'peers') {
        const row = at(step - 1);
        return { status: 0, stdout: JSON.stringify({ members: [{ namespace: 'ns', courier: 'c', member: 'lane--claude', activity: row.activity }] }) };
      }
      throw new Error(`unexpected argv ${args.join(' ')}`);
    },
  };
  const opts = {
    order: ORDER, lane: LANE, seat: SEAT, handoffPath: HANDOFF, base, pollMs,
    from: 'stranity', to: 'cookys', fleetBin: 'fleet',
  };
  if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
  return { base, deps, opts, calls, sleeps: () => sleeps };
}

test('negative control: file older than the request keeps waiting, then timeout', async () => {
  const s = scripted(
    [{ exists: true, mtimeMs: START - 1, activity: 'idle' }],
    { timeoutMs: 3000, pollMs: 1000 },
  );
  const r = await requestHandoff(s.opts, s.deps);
  assert.deepStrictEqual(r, { ok: false, reason: 'timeout' });
  assert.ok(s.sleeps() >= 1, 'must keep waiting, not return on the old file');
  assert.ok(s.calls.filter((c) => c[1][0] === 'peers').length >= 2);
  const got = rows(s.base);
  assert.deepStrictEqual(got.map((row) => [row.step, row.outcome]), [['handoff-send', 'sent'], ['handoff-wait', 'timeout']]);
  assert.ok(got.every((row) => row.order === ORDER && row.lane === LANE && row.from === 'stranity' && row.to === 'cookys'));
  assert.ok(!JSON.stringify(got).includes('@'));
});

test('file appears, then the lane goes idle: ok', async () => {
  assert.strictEqual(DEFAULT_TIMEOUT_MS, 15 * 60 * 1000);
  const s = scripted([
    { exists: false, activity: 'busy' },
    { exists: true, mtimeMs: START + 20, activity: 'busy' },
    { exists: true, mtimeMs: START + 20, activity: 'idle' },
  ], { pollMs: 1000 });
  const r = await requestHandoff(s.opts, s.deps);
  assert.deepStrictEqual(r, { ok: true, handoff_path: HANDOFF, waited_ms: 2000 });
  assert.strictEqual(s.sleeps(), 2);
  const send = s.calls[0];
  assert.deepStrictEqual(send, ['fleet', ['send', SEAT, `order ${ORDER}: run autopilot:handoff`]]);
  assert.ok(s.calls.slice(1).every((c) => c[1][0] === 'peers' && c[1][1] === '--json'));
  const got = rows(s.base);
  assert.deepStrictEqual(got.map((row) => [row.step, row.outcome]), [['handoff-send', 'sent'], ['handoff-wait', 'ok']]);
  assert.strictEqual(fs.statSync(journalFile(s.base)).mode & 0o777, 0o600);
});

test('send fails: send_failed, no wait', async () => {
  const s = scripted(
    [{ exists: true, mtimeMs: START + 20, activity: 'idle' }],
    { sendStatus: 1, timeoutMs: 3000 },
  );
  const r = await requestHandoff(s.opts, s.deps);
  assert.deepStrictEqual(r, { ok: false, reason: 'send_failed' });
  assert.strictEqual(s.sleeps(), 0);
  assert.deepStrictEqual(s.calls.map((c) => c[1][0]), ['send']);
  const got = rows(s.base);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].step, 'handoff-send');
  assert.strictEqual(got[0].outcome, 'send_failed');
  assert.match(got[0].detail, /^status_/);
});
