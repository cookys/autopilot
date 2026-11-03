#!/usr/bin/env node
'use strict';
// G40 D4 CLI layer: passive capture, 429 refusal row, audit field `quota_capture`, gated probe (plan 5.1, 5.3, 9, 10, 21.8).
//   G40-N9   a stream argv with an event records; a json argv records nothing; a malformed event is dropped; exit code and
//            stdout bytes equal the run without capture; the wrapper never rewrites a caller's argv
//   G40-N10  a token inside an event line is scrubbed first (outcome token_scrubbed, capture skipped, no token in the mirror)
//   G40-N13  quota_probe unset or off: zero probe spawns (counted by the shim); stale mode probes with the manifest argv
//   G40-N14  tight, cooling, pinned and fresh aliases are never probed
//   G40-N15  probe timeout, 429 and 401 change nothing about the real call and write nothing
//   G40-N66  quota_probe=scheduled is rejected for Claude; unset is off
//   G40-N73  out-of-range probe config is rejected at load
//   G40-N74  a mirror lock held makes the writer skip: audit quota_capture=mirror_lock_busy, exit and stdout unchanged
//   G40-N76  two stale candidates yield exactly one probe spawn
//   G40-N78  a first 429 with no prior window writes a shape (b) refusal row; 401 writes none
//   G40-N84  observed_at is the attempt's start (clock shimmed over a 2 h run), not the capture time
// Tempdir only, FAKE- tokens, Node claude shim only. No real home, credential or network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cli } = require('./claude-account.js');
const { makeFixture, R401, R429, OK } = require('./lib/account-fixtures/shim-install.js');
const observation = require('./lib/account-observation');
const probeLib = require('./lib/account-probe');
const cooldown = require('./lib/account-cooldown');

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'quota-adapters', 'claude.json'), 'utf8'));
const PROBE_ARGV = probeLib.probeArgv(MANIFEST, probeLib.PROBE_PROMPT).slice(1); // the shim logs argv without argv[0]
const RUN = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi'];

async function go(fx, args, over) {
  let out = '';
  let err = '';
  const code = await cli(args, Object.assign({
    env: fx.env, realHome: fx.realHome, warn: () => {}, now: () => NOW,
    write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); },
  }, over || {}));
  return { code, out, err };
}

const ev = (five, seven, over) => JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: Object.assign({
    status: 'allowed', rateLimitType: 'five_hour', isUsingOverage: false,
    unifiedWindows: Object.assign({},
      five === null ? {} : { five_hour: { utilization: five, resetsAt: NOW_S + 3600, status: 'allowed' } },
      seven === null ? {} : { seven_day: { utilization: seven, resetsAt: NOW_S + 86400, status: 'allowed' } }),
  }, over || {}),
  uuid: 'u1', session_id: 's1',
});
const RESULT = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' });
const stream = (...lines) => ({ exit: 0, stdout: [JSON.stringify({ type: 'system', subtype: 'init' }), ...lines, RESULT].join('\n') + '\n' });
const auditLines = (fx) => (fs.existsSync(fx.auditFile) ? fs.readFileSync(fx.auditFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rowOf = (fx, alias) => {
  const r = observation.readView(fx.liveDir, 'claude', alias);
  return r.view && r.view.rows.length > 0 ? r.view.rows[0].record : null;
};
const mirrorFile = (fx, alias) => observation.mirrorPath(fx.liveDir, 'claude', alias);
const win = (kind, u, over) => Object.assign({ kind, utilization: u, resets_at: NOW_S + 3600, source: 'passive', observed_at: NOW_S - 60 }, over || {});
function writeRow(fx, alias, windows, over) {
  const b = observation.buildRecord(Object.assign({ provider: 'claude', alias, visibility: 'L3', windows }, over || {}));
  assert.ok(b.ok, JSON.stringify(b));
  const w = observation.writeLocalRow(fx.liveDir, b.record);
  assert.ok(w.ok, JSON.stringify(w));
}
const probeCalls = (fx) => fx.shim.calls().filter((c) => c.argv.includes('--no-session-persistence'));

// ------------------------------------------------------------------ N9

test('G40-N9: a stream argv with an event records a passive row at the attempt start; exit and stdout equal the run without capture', async () => {
  const resp = stream(ev(0.42, 0.1));
  const on = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
  const off = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp }, config: { accounts: { quota_capture: 'off' } } });
  try {
    const argv = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi', '--output-format', 'stream-json', '--verbose'];
    const r1 = await go(on, argv);
    const r0 = await go(off, argv);
    assert.strictEqual(r1.code, 0);
    assert.strictEqual(r1.code, r0.code);
    assert.strictEqual(r1.out, r0.out, 'stdout bytes equal the run with capture off');
    assert.strictEqual(r1.err, r0.err);
    const rec = rowOf(on, 'a');
    assert.ok(rec, 'a row is on file');
    assert.strictEqual(rec.visibility, 'L3');
    assert.strictEqual(rec.host_role, 'agent');
    assert.deepStrictEqual(rec.windows.map((w) => [w.kind, w.utilization, w.resets_at, w.source, w.observed_at]), [
      ['rolling_5h', 0.42, NOW_S + 3600, 'passive', NOW_S],
      ['weekly', 0.1, NOW_S + 86400, 'passive', NOW_S],
    ]);
    assert.strictEqual(rowOf(off, 'a'), null, 'quota_capture=off records nothing');
    assert.deepStrictEqual(Object.keys(auditLines(on)[0]), ['ts', 'ts_local', 'alias', 'purpose', 'attempt', 'outcome'], 'a clean capture adds no audit key');
  } finally { on.cleanup(); off.cleanup(); }
});

test('G40-N9: a json argv records 0 rows, leaves stdout bytes and argv exactly as without capture', async () => {
  const on = makeFixture({ aliases: [{ alias: 'a' }] });
  const off = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: { quota_capture: 'off' } } });
  try {
    const argv = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi', '--output-format', 'json'];
    const r1 = await go(on, argv);
    const r0 = await go(off, argv);
    assert.strictEqual(r1.code, 0);
    assert.strictEqual(r1.code, r0.code);
    assert.strictEqual(r1.out, r0.out);
    assert.strictEqual(r1.out, `${OK.stdout}`, 'the child json envelope passes through byte for byte');
    assert.strictEqual(fs.existsSync(path.join(on.liveDir, 'quota')), false, 'no mirror directory is even created');
    assert.deepStrictEqual(on.shim.calls().map((c) => c.argv), [['-p', 'hi', '--output-format', 'json']], 'the caller argv is not rewritten');
    assert.deepStrictEqual(off.shim.calls().map((c) => c.argv), on.shim.calls().map((c) => c.argv));
    assert.deepStrictEqual(Object.keys(auditLines(on)[0]), ['ts', 'ts_local', 'alias', 'purpose', 'attempt', 'outcome']);
  } finally { on.cleanup(); off.cleanup(); }
});

test('G40-N9: a malformed event is dropped and audited as bad_event; exit and stdout are unchanged', async () => {
  const cases = [
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: 'not an object' }),
    ev('0.4', 0.1), // utilization is a string
    ev(1.7, 0.1), // above 1.5: almost surely an unconverted percentage, rejected at the boundary
    '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":', // cut off line
  ];
  for (const line of cases) {
    const resp = stream(line);
    const on = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
    const off = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp }, config: { accounts: { quota_capture: 'off' } } });
    try {
      const r1 = await go(on, RUN);
      const r0 = await go(off, RUN);
      assert.strictEqual(r1.code, r0.code);
      assert.strictEqual(r1.out, r0.out);
      assert.strictEqual(rowOf(on, 'a'), null, `no row for ${line.slice(0, 40)}`);
      assert.strictEqual(auditLines(on)[0].quota_capture, 'bad_event');
      assert.strictEqual(auditLines(on)[0].outcome, 'ok');
    } finally { on.cleanup(); off.cleanup(); }
  }
});

test('G40-N9: the LAST event wins; an event above 1 is clamped once and flagged', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: stream(ev(0.9, 0.9), ev(1.02, null)) } });
  try {
    await go(fx, RUN);
    const rec = rowOf(fx, 'a');
    assert.deepStrictEqual(rec.windows.map((w) => [w.kind, w.utilization, w.clamped]), [['rolling_5h', 1, true]], 'last event only; a missing weekly is absent, never 0');
  } finally { fx.cleanup(); }
});

test('G40-N9: a rate-limited attempt that carried an event records the windows (and not a refusal)', async () => {
  const r429 = { exit: 1, stdout: [ev(0.97, 0.2), R429.stdout.trim()].join('\n') + '\n' };
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: r429 } });
  try {
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 0, 'b answers');
    const rec = rowOf(fx, 'a');
    assert.deepStrictEqual(rec.windows.map((w) => [w.kind, w.utilization]), [['rolling_5h', 0.97], ['weekly', 0.2]]);
    assert.strictEqual(rec.refusal, null);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ N10

test('G40-N10: a token inside an event line is scrubbed before capture: token_scrubbed, no row, no token anywhere in the live dir', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const tok = fx.tokens.a;
    const line = ev(0.42, 0.1, { note: `leak ${tok}` });
    fx.shim.setControl({ default: stream(line), tokens: {} });
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 7);
    assert.ok(!r.out.includes(tok) && !r.err.includes(tok));
    assert.strictEqual(auditLines(fx)[0].outcome, 'token_scrubbed');
    assert.strictEqual(rowOf(fx, 'a'), null, 'capture is skipped as a whole');
    assert.strictEqual(fs.existsSync(path.join(fx.liveDir, 'quota')), false);
    assert.strictEqual('quota_capture' in auditLines(fx)[0], false);
    const all = [];
    (function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else all.push(fs.readFileSync(p, 'utf8')); } })(fx.liveDir);
    assert.ok(all.every((t) => !t.includes(tok)), 'no token in any live file');
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ N13 / N76 / N14

test('G40-N13: quota_probe unset or off: a stale alias triggers zero probe spawns; stale mode probes with the manifest argv byte for byte', async () => {
  for (const config of [{}, { accounts: { quota_probe: 'off' } }]) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], config });
    try {
      const r = await go(fx, RUN);
      assert.strictEqual(r.code, 0);
      assert.strictEqual(fx.shim.spawns(), 1, 'only the real call');
      assert.strictEqual(probeCalls(fx).length, 0);
    } finally { fx.cleanup(); }
  }
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], config: { accounts: { quota_probe: 'stale' } }, responses: { a: stream(ev(0.3, 0.1)) } });
  try {
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(fx.shim.spawns(), 2, 'one probe, one real call');
    assert.deepStrictEqual(fx.shim.calls()[0].argv, PROBE_ARGV, 'probe argv = the manifest tinyprobe template with only <PROMPT> filled');
    assert.ok(!fx.shim.calls()[0].argv.includes('--strict-mcp-config'));
    assert.deepStrictEqual(fx.shim.calls()[1].argv, ['-p', 'hi']);
    assert.ok(rowOf(fx, 'a'), 'a row is on file after the probe and the real call');
  } finally { fx.cleanup(); }
});

test('G40-N76: two stale candidates in one run yield exactly one probe spawn', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }, { alias: 'c' }], config: { accounts: { quota_probe: 'stale' } }, responses: { a: stream(ev(0.3, 0.1)) } });
  try {
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 1);
    assert.strictEqual(fx.shim.spawns(), 2);
  } finally { fx.cleanup(); }
});

test('G40-N14: a tight alias, a cooling alias and a pinned run are never probed; a stale ok alias is (control)', async () => {
  const cfg = { accounts: { quota_probe: 'stale' } };
  // tight: 2 h old but still live (resets in the future)
  let fx = makeFixture({ aliases: [{ alias: 'a' }], config: cfg });
  try {
    writeRow(fx, 'a', [win('rolling_5h', 0.95, { observed_at: NOW_S - 7200 })]);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0, 'tight alias');
    assert.strictEqual(fx.shim.spawns(), 1);
  } finally { fx.cleanup(); }
  // cooling: a is cooling, b is fresh
  fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], config: cfg });
  try {
    cooldown.writeCooldown('a', NOW + 3600e3, { dir: fx.cooldownDir, nowMs: NOW });
    writeRow(fx, 'b', [win('rolling_5h', 0.2)]);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0, 'cooling alias');
  } finally { fx.cleanup(); }
  // a live refusal row is cooling too
  fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], config: cfg });
  try {
    writeRow(fx, 'a', [], { visibility: 'L1', refusal: { observed_at: NOW_S - 30, retry_at: NOW_S + 1800, reason: 'rate_limit' } });
    writeRow(fx, 'b', [win('rolling_5h', 0.2)]);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0, 'refusal row');
  } finally { fx.cleanup(); }
  // pinned
  fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], config: cfg });
  try {
    await go(fx, ['run', '--purpose', 'tst', '--alias', 'a', '--', 'claude', '-p', 'hi']);
    assert.strictEqual(probeCalls(fx).length, 0, 'pinned run');
    assert.strictEqual(fx.shim.spawns(), 1);
  } finally { fx.cleanup(); }
  // control: a stale ok alias IS probed
  fx = makeFixture({ aliases: [{ alias: 'a' }], config: cfg, responses: { a: stream(ev(0.3, 0.1)) } });
  try {
    writeRow(fx, 'a', [win('rolling_5h', 0.3, { observed_at: NOW_S - 7200 })]);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 1, 'control: stale and not tight is probed');
  } finally { fx.cleanup(); }
  // a fresh alias is not
  fx = makeFixture({ aliases: [{ alias: 'a' }], config: cfg });
  try {
    writeRow(fx, 'a', [win('rolling_5h', 0.3, { observed_at: NOW_S - 600 })]);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0, 'fresh (10 min < 60)');
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ N15

async function probeFailureCase(label, probeResp, cfgExtra) {
  const cfg = { accounts: Object.assign({ quota_probe: 'stale', quota_probe_timeout_secs: 1 }, cfgExtra || {}) };
  const base = { aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { b: probeResp } };
  const withProbe = makeFixture(Object.assign({ config: cfg }, base));
  const without = makeFixture({ aliases: base.aliases, config: {} });
  try {
    for (const fx of [withProbe, without]) writeRow(fx, 'a', [win('rolling_5h', 0.2)]); // a is fresh; b is the stale candidate
    const r1 = await go(withProbe, RUN);
    const r0 = await go(without, RUN);
    assert.strictEqual(probeCalls(withProbe).length, 1, `${label}: the probe really ran`);
    assert.strictEqual(r1.code, r0.code, `${label}: exit`);
    assert.strictEqual(r1.out, r0.out, `${label}: stdout`);
    assert.strictEqual(r1.err, r0.err, `${label}: stderr`);
    const real = (fx) => auditLines(fx).filter((l) => l.purpose === 'tst').map((l) => [l.alias, l.attempt, l.outcome]);
    assert.deepStrictEqual(real(withProbe), real(without), `${label}: real-call audit`);
    assert.strictEqual(rowOf(withProbe, 'b'), null, `${label}: a failed probe records nothing`);
    assert.deepStrictEqual(rowOf(withProbe, 'a').windows, rowOf(without, 'a').windows);
    assert.strictEqual(fs.existsSync(withProbe.cooldownDir) ? fs.readdirSync(withProbe.cooldownDir).length : 0, 0, `${label}: no cooldown`);
    const pa = auditLines(withProbe).filter((l) => l.purpose === 'quota-probe');
    assert.strictEqual(pa.length, 1);
    return pa[0];
  } finally { withProbe.cleanup(); without.cleanup(); }
}

test('G40-N15: a probe 401 does not change the real call, writes no row and no token_state', async () => {
  const pa = await probeFailureCase('401', R401);
  assert.strictEqual(pa.outcome, 'auth_failed');
});
test('G40-N15: a probe 429 does not change the real call, writes no row and starts no cooldown', async () => {
  const pa = await probeFailureCase('429', R429);
  assert.strictEqual(pa.outcome, 'rate_limited');
});
test('G40-N15: a probe timeout (killed at quota_probe_timeout_secs) does not change the real call', async () => {
  const pa = await probeFailureCase('timeout', Object.assign({ hangMs: 6000 }, OK));
  assert.strictEqual(pa.outcome, 'timeout');
});

// ------------------------------------------------------------------ N66 / N73

test('G40-N66: quota_probe=scheduled is rejected for Claude (starts_window unknown); unset is off', async () => {
  let fx = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: { quota_probe: 'scheduled' } } });
  try {
    const r = await go(fx, ['status']);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /config_quota_probe_scheduled_rejected/);
    const r2 = await go(fx, RUN);
    assert.strictEqual(r2.code, 2);
    assert.strictEqual(fx.shim.spawns(), 0);
  } finally { fx.cleanup(); }
  fx = makeFixture({ aliases: [{ alias: 'a' }], config: {} });
  try {
    assert.strictEqual((await go(fx, ['status'])).code, 0);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0);
  } finally { fx.cleanup(); }
  fx = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: { quota_probe: 'sometimes' } } });
  try { assert.strictEqual((await go(fx, ['status'])).code, 2); } finally { fx.cleanup(); }
});

test('G40-N73: quota_probe_stale_minutes outside 5..360, a non-numeric quota_probe_timeout_secs and the other new knobs are rejected at load', async () => {
  const bad = [
    { quota_probe_stale_minutes: 4 }, { quota_probe_stale_minutes: 361 }, { quota_probe_stale_minutes: 5.5 }, { quota_probe_stale_minutes: '60' },
    { quota_probe_timeout_secs: 'x' }, { quota_probe_timeout_secs: 0 }, { quota_probe_timeout_secs: -3 }, { quota_probe_timeout_secs: null },
    { quota_capture: 'maybe' }, { quota_capture: true }, { host_role: 'Bad Role!' }, { host_role: 7 },
  ];
  for (const a of bad) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: a } });
    try { assert.strictEqual((await go(fx, ['status'])).code, 2, JSON.stringify(a)); } finally { fx.cleanup(); }
  }
  const good = [{ quota_probe_stale_minutes: 5 }, { quota_probe_stale_minutes: 360 }, { quota_probe_timeout_secs: 20 }, { quota_capture: 'off' }, { host_role: 'agent' }];
  for (const a of good) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: a } });
    try { assert.strictEqual((await go(fx, ['status'])).code, 0, JSON.stringify(a)); } finally { fx.cleanup(); }
  }
});

// ------------------------------------------------------------------ N74

test('G40-N74: a mirror lock held makes the writer skip the write: audit quota_capture=mirror_lock_busy, exit and stdout unchanged', async () => {
  const resp = stream(ev(0.42, 0.1));
  const held = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
  const free = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
  try {
    const dir = observation.mirrorDir(held.liveDir, 'claude');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = path.join(dir, 'a.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: 'held-by-test', t: Date.now() }), { mode: 0o600 });
    const r1 = await go(held, RUN);
    const r0 = await go(free, RUN);
    assert.strictEqual(r1.code, r0.code);
    assert.strictEqual(r1.out, r0.out);
    assert.strictEqual(auditLines(held)[0].quota_capture, 'mirror_lock_busy');
    assert.strictEqual(auditLines(held)[0].outcome, 'ok');
    assert.strictEqual(rowOf(held, 'a'), null, 'nothing was written');
    assert.ok(fs.existsSync(lock), 'the holder\'s lock is untouched');
    assert.strictEqual('quota_capture' in auditLines(free)[0], false);
    assert.ok(rowOf(free, 'a'));
  } finally { held.cleanup(); free.cleanup(); }
});

// ------------------------------------------------------------------ N78

test('G40-N78: a first 429 with no prior window writes a shape (b) refusal row: L1, observed_at = attempt start, no window, no record-level source', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: R429 } });
  try {
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 0, 'b answers');
    const rec = rowOf(fx, 'a');
    assert.deepStrictEqual(rec.windows, [], 'no window is invented');
    assert.deepStrictEqual(rec.refusal, { observed_at: NOW_S, retry_at: null, reason: 'rate_limit' });
    assert.strictEqual(rec.visibility, 'L1');
    assert.strictEqual('source' in rec, false);
    assert.strictEqual(rec.token_state, 'unknown');
    assert.deepStrictEqual(observation.validateRecord(rec, { provider: 'claude', alias: 'a' }), { ok: true });
    assert.strictEqual(rowOf(fx, 'b'), null);
  } finally { fx.cleanup(); }
});

test('G40-N78: a quota 429 takes retry_at from the response when present', async () => {
  const retry = NOW_S + 7200;
  const resp = { exit: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: `API Error: 429 Claude AI usage limit reached|${retry}` }) + '\n' };
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: resp } });
  try {
    await go(fx, RUN);
    assert.deepStrictEqual(rowOf(fx, 'a').refusal, { observed_at: NOW_S, retry_at: retry, reason: 'quota' });
  } finally { fx.cleanup(); }
});

test('G40-N78: a 429 with a live window already on file adds no refusal row; a 401 writes no row and no token_state', async () => {
  let fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: R429 } });
  try {
    writeRow(fx, 'a', [win('rolling_5h', 0.3)]);
    const before = fs.readFileSync(mirrorFile(fx, 'a'), 'utf8');
    await go(fx, RUN);
    assert.strictEqual(fs.readFileSync(mirrorFile(fx, 'a'), 'utf8'), before, 'the window row is untouched');
  } finally { fx.cleanup(); }
  fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: { exit: 1, stdout: `${ev(0.5, 0.1)}\n${R401.stdout}` } } }); // even a 401 that carries an event writes nothing (token_state is P3)
  try {
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 6);
    assert.strictEqual(fs.existsSync(path.join(fx.liveDir, 'quota')), false, '401 writes nothing to the mirror');
    assert.strictEqual(fs.existsSync(fx.cooldownDir) ? fs.readdirSync(fx.cooldownDir).length : 0, 0);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ N84

test('G40-N84: a run that lasts 2 h gives observed_at = the attempt start (clock shimmed), not the capture time', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: Object.assign({ hangMs: 150 }, stream(ev(0.42, 0.1))) } });
  try {
    // before the child has been spawned the wrapper clock reads T0; once the shim has logged its call, 2 h later
    const now = () => (fx.shim.spawns() > 0 ? NOW + 7200e3 : NOW);
    const r = await go(fx, RUN, { now });
    assert.strictEqual(r.code, 0);
    const rec = rowOf(fx, 'a');
    assert.deepStrictEqual(rec.windows.map((w) => w.observed_at), [NOW_S, NOW_S], 'the start, in whole seconds');
    assert.ok(Number.isInteger(rec.windows[0].observed_at) && rec.windows[0].observed_at < 1e11, 'seconds, not milliseconds');
  } finally { fx.cleanup(); }
});

test('G40-N84: a 429 refusal row is stamped with the attempt start too', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: Object.assign({ hangMs: 100 }, R429) } });
  try {
    const now = () => (fx.shim.spawns() > 0 ? NOW + 7200e3 : NOW);
    await go(fx, RUN, { now });
    assert.strictEqual(rowOf(fx, 'a').refusal.observed_at, NOW_S);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ usage-probe (explicit)

test('G40-N13: usage-probe prints only {alias, windows}, publishes a probe row and runs even with quota_probe off', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: stream(ev(0.31, 0.05)) } });
  try {
    const r = await go(fx, ['usage-probe', '--alias', 'a']);
    assert.strictEqual(r.code, 0);
    const j = JSON.parse(r.out);
    assert.deepStrictEqual(Object.keys(j), ['alias', 'windows']);
    assert.deepStrictEqual(j.windows.map((w) => [w.kind, w.utilization]), [['rolling_5h', 0.31], ['weekly', 0.05]]);
    assert.deepStrictEqual(fx.shim.calls().map((c) => c.argv), [PROBE_ARGV]);
    assert.deepStrictEqual(rowOf(fx, 'a').windows.map((w) => [w.source, w.observed_at]), [['probe', NOW_S], ['probe', NOW_S]], 'source probe, stamped with the attempt start');
    assert.strictEqual((await go(fx, ['usage-probe'])).code, 2, '--alias is required');
  } finally { fx.cleanup(); }
  const f2 = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: R401 } });
  try {
    const r = await go(f2, ['usage-probe', '--alias', 'a']);
    assert.strictEqual(r.code, 6);
    assert.deepStrictEqual(JSON.parse(r.out), { alias: 'a', windows: [] });
    assert.strictEqual(fs.existsSync(path.join(f2.liveDir, 'quota')), false);
  } finally { f2.cleanup(); }
});

test('G40-N78: cooldown --clear also releases the refusal row a 429 left, so the operator release still works', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: R429 } });
  try {
    await go(fx, RUN);
    assert.ok(rowOf(fx, 'a').refusal, 'a refusal row cools a');
    assert.deepStrictEqual((await go(fx, ['cooldown', '--clear', 'a'])).out, 'cleared alias=a\n');
    assert.strictEqual(rowOf(fx, 'a'), null);
    fx.shim.setControl({});
    const p = await go(fx, ['pick']);
    assert.match(p.out, /^a class=unknown/, 'a is pickable again (priority 1, no cooldown, no refusal)');
    // a row that carries windows is not touched
    writeRow(fx, 'b', [win('rolling_5h', 0.3)]);
    const before = fs.readFileSync(mirrorFile(fx, 'b'), 'utf8');
    await go(fx, ['cooldown', '--clear', 'b']);
    assert.strictEqual(fs.readFileSync(mirrorFile(fx, 'b'), 'utf8'), before);
  } finally { fx.cleanup(); }
});
