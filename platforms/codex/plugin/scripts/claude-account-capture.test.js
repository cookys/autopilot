#!/usr/bin/env node
'use strict';
// G40 D4 CLI layer: passive capture, 429 refusal row, audit field `quota_capture`, gated probe (plan 5.1, 5.3, 9, 10, 21.8).
//   G40-N9   a stream argv with an event records; a json argv records nothing; a malformed event is dropped; exit code and
//            stdout bytes equal the run without capture; the wrapper never rewrites a caller's argv
//   G40-N10  a token inside an event line is scrubbed first (outcome token_scrubbed, capture skipped, no token in the mirror)
//   G40-N13  quota_probe off: zero probe spawns (counted by the shim); unset follows the manifest (BL-0375); stale mode probes with the manifest argv
//   G40-N14  tight, cooling, pinned and fresh aliases are never probed
//   G40-N15  probe timeout, 429 and 401 change nothing about the real call and write nothing
//   G40-N66  quota_probe=scheduled is rejected for Claude; unset is on-demand (stale) for Claude (BL-0375)
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
const { makeFixture, loadPatched, R401, R429, OK } = require('./lib/account-fixtures/shim-install.js');
const audit = require('./lib/account-audit');
const os = require('os');
const observation = require('./lib/account-observation');
const probeLib = require('./lib/account-probe');
const cooldown = require('./lib/account-cooldown');
const { holdOsLock, isHeld, installLeakCheck } = require('./lib/account-fixtures/os-lock-holder');

installLeakCheck(test.after);

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

test('G40-N13: quota_probe off: a stale alias triggers zero probe spawns; stale mode probes with the manifest argv byte for byte', async () => {
  for (const config of [{ accounts: { quota_probe: 'off' } }]) {
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

test('G40-N66: quota_probe=scheduled is rejected for Claude (starts_window unknown); unset is on-demand', async () => {
  let fx = makeFixture({ aliases: [{ alias: 'a' }], config: { accounts: { quota_probe: 'scheduled' } } });
  try {
    const r = await go(fx, ['status']);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /config_quota_probe_scheduled_rejected/);
    const r2 = await go(fx, RUN);
    assert.strictEqual(r2.code, 2);
    assert.strictEqual(fx.shim.spawns(), 0);
  } finally { fx.cleanup(); }
  fx = makeFixture({ aliases: [{ alias: 'a' }], config: {}, probeFromManifest: true });
  try {
    assert.strictEqual((await go(fx, ['status'])).code, 0);
    await go(fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 1, 'unset follows the manifest: Claude is unknown, so one on-demand probe for the never-observed alias');
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
  let holder = null;
  try {
    const dir = observation.mirrorDir(held.liveDir, 'claude');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = path.join(dir, 'a.oslock');
    holder = holdOsLock(lock);
    const r1 = await go(held, RUN);
    const r0 = await go(free, RUN);
    assert.strictEqual(r1.code, r0.code);
    assert.strictEqual(r1.out, r0.out);
    assert.strictEqual(auditLines(held)[0].quota_capture, 'mirror_lock_busy');
    assert.strictEqual(auditLines(held)[0].outcome, 'ok');
    assert.strictEqual(rowOf(held, 'a'), null, 'nothing was written');
    assert.ok(isHeld(lock), 'the holder\'s lock is untouched');
    assert.strictEqual('quota_capture' in auditLines(free)[0], false);
    assert.ok(rowOf(free, 'a'));
  } finally { if (holder) holder.release(); held.cleanup(); free.cleanup(); }
});

// BL-0374: with neither flock nor perl the mirror write fails closed. That must be VISIBLE (audit reason and `status`), and
// only then: a run without a mirror failure leaves `status` byte for byte as it was.
test('G40-BL0374: no lock tool on PATH: run is unchanged, the audit says quota_capture=lock_helper, `status` shows it; nothing else in status changes', async () => {
  const resp = stream(ev(0.42, 0.1));
  const broken = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
  const off = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp }, config: { accounts: { quota_capture: 'off' } } });
  const free = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: resp } });
  const savedPath = process.env.PATH;
  const emptyDir = fs.mkdtempSync(path.join(broken.root, 'nopath-'));
  try {
    process.env.PATH = emptyDir; // the writer looks for its tool on the process PATH; the shim claude is found through fx.env
    let r1;
    try { r1 = await go(broken, RUN); } finally { process.env.PATH = savedPath; }
    const r0 = await go(off, RUN);
    const rf = await go(free, RUN);
    assert.deepStrictEqual([r1.code, r1.out, r1.err], [r0.code, r0.out, r0.err], 'run output equals the adapter-off run');
    assert.strictEqual(auditLines(broken)[0].quota_capture, 'lock_helper');
    assert.strictEqual(rowOf(broken, 'a'), null, 'nothing was written');
    const st = await go(broken, ['status']);
    assert.strictEqual(st.code, 0);
    assert.match(st.out, / quota_capture=lock_helper\n/);
    // everything but the new suffix equals the status of the adapter-off world
    const stOff = await go(off, ['status']);
    assert.strictEqual(st.out.replace(' quota_capture=lock_helper', ''), stOff.out);
    // a world whose mirror write worked prints no quota_capture at all
    assert.doesNotMatch((await go(free, ['status'])).out, /quota_capture/);
    assert.ok(rf.code === 0 && rowOf(free, 'a'));
  } finally { process.env.PATH = savedPath; broken.cleanup(); off.cleanup(); free.cleanup(); }
});

// ------------------------------------------------------------------ N78

test('G40-N78: a first 429 with no prior window writes a shape (b) refusal row: L1, observed_at = attempt start, no window, no record-level source', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: R429 } });
  try {
    const r = await go(fx, RUN);
    assert.strictEqual(r.code, 0, 'b answers');
    const rec = rowOf(fx, 'a');
    assert.deepStrictEqual(rec.windows, [], 'no window is invented');
    assert.deepStrictEqual(rec.refusal, { observed_at: NOW_S, retry_at: NOW_S + 300, reason: 'rate_limit' }, 'PM (A): retry_at = the G37 throttle cooldown end (5 min)');
    const until = cooldown.readCooldown('a', { dir: fx.cooldownDir, nowMs: NOW });
    assert.strictEqual(until, NOW + 300e3, 'the refusal ends exactly when the G37 cooldown does');
    const m = require('./lib/account-interpret').interpretWindows(observation.readView(fx.liveDir, 'claude', 'a').view.rows, MANIFEST, NOW_S);
    assert.strictEqual(m.refusal.remaining_s, 300, 'remaining equals the G37 cooldown, not the manifest 30 minutes');
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

// ------------------------------------------------------------------ review round: refusal clear under the lock, bad event + 429, --purpose

const PEER = 'ns/courier/peer';
function writePeer(fx, alias) {
  const b = observation.buildRecord({ provider: 'claude', alias, visibility: 'L3', windows: [win('rolling_5h', 0.4)] });
  assert.ok(b.ok);
  const w = observation.writeLocalRow(fx.liveDir, b.record, { courier: PEER });
  assert.ok(w.ok, JSON.stringify(w));
}
function writeRefusal(fx, alias, over) {
  const b = observation.buildRecord(Object.assign({ provider: 'claude', alias, visibility: 'L1', windows: [], refusal: { observed_at: NOW_S, retry_at: NOW_S + 300, reason: 'rate_limit' } }, over || {}));
  assert.ok(b.ok, JSON.stringify(b));
  assert.ok(observation.writeLocalRow(fx.liveDir, b.record).ok);
}
const viewOf = (fx, alias) => JSON.parse(fs.readFileSync(mirrorFile(fx, alias), 'utf8'));

test('G40-N78: removeLocalRefusal with a peer row on file removes only the local refusal and leaves the peer row byte for byte', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    writePeer(fx, 'a');
    writeRefusal(fx, 'a');
    const peerBefore = JSON.stringify(viewOf(fx, 'a').rows.find((r) => r.writer_courier === PEER));
    assert.strictEqual(viewOf(fx, 'a').rows.length, 2);
    assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a'), { ok: true, removed: true });
    const rows = viewOf(fx, 'a').rows;
    assert.deepStrictEqual(rows.map((r) => r.writer_courier), [PEER]);
    assert.strictEqual(JSON.stringify(rows[0]), peerBefore);
    assert.strictEqual(fs.statSync(mirrorFile(fx, 'a')).mode & 0o777, 0o600);
  } finally { fx.cleanup(); }
});

test('G40-N78: removeLocalRefusal re-reads inside the lock: a capture that replaced the row with a windowed one while we waited is not deleted', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    writeRefusal(fx, 'a');
    const hooks = { beforeLock() { writeRow(fx, 'a', [win('rolling_5h', 0.3, { observed_at: NOW_S + 1 })]); } };
    assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a', { hooks }), { ok: true, removed: false });
    assert.deepStrictEqual(rowOf(fx, 'a').windows.map((w) => w.utilization), [0.3]);
  } finally { fx.cleanup(); }
});

test('G40-N78: removeLocalRefusal leaves a local row that carries a window; deletes the file when only the local refusal is on file; refuses to force a held lock', () => {
  let fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    writeRow(fx, 'a', [win('rolling_5h', 0.3)], { refusal: { observed_at: NOW_S - 30, retry_at: NOW_S + 300, reason: 'rate_limit' }, visibility: 'L3' });
    const before = fs.readFileSync(mirrorFile(fx, 'a'), 'utf8');
    assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a'), { ok: true, removed: false });
    assert.strictEqual(fs.readFileSync(mirrorFile(fx, 'a'), 'utf8'), before);
  } finally { fx.cleanup(); }
  fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    writeRefusal(fx, 'a');
    assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a'), { ok: true, removed: true });
    assert.strictEqual(fs.existsSync(mirrorFile(fx, 'a')), false);
    assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a'), { ok: true, removed: false }, 'nothing left: not an error');
    writeRefusal(fx, 'a');
    const holder = holdOsLock(path.join(path.dirname(mirrorFile(fx, 'a')), 'a.oslock'));
    try {
      assert.deepStrictEqual(observation.removeLocalRefusal(fx.liveDir, 'claude', 'a', { waitMs: 150 }), { ok: false, code: 'mirror_lock_busy' });
      assert.ok(rowOf(fx, 'a').refusal, 'not forced');
    } finally { holder.release(); }
  } finally { fx.cleanup(); }
});

test('G40-N78: cooldown --clear reports a refusal it could not release (lock held) on stderr and exits non-zero', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    writeRefusal(fx, 'a');
    const holder = holdOsLock(path.join(path.dirname(mirrorFile(fx, 'a')), 'a.oslock'));
    try {
      const r = await go(fx, ['cooldown', '--clear', 'a']);
      assert.notStrictEqual(r.code, 0);
      assert.match(r.err, /refusal_not_cleared alias=a \(mirror_lock_busy\)/);
      assert.ok(rowOf(fx, 'a').refusal);
    } finally { holder.release(); }
  } finally { fx.cleanup(); }
});

test('G40-N9: a malformed event on a 429 with no prior window still writes the L1 refusal row; the audit keeps bad_event', async () => {
  for (const line of [JSON.stringify({ type: 'rate_limit_event', rate_limit_info: 'junk' }), ev(1.7, 0.1)]) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], responses: { a: { exit: 1, stdout: `${line}\n${R429.stdout}` } } });
    try {
      const r = await go(fx, RUN);
      assert.strictEqual(r.code, 0, 'b answers');
      const rec = rowOf(fx, 'a');
      assert.ok(rec && rec.refusal, 'refusal row written');
      assert.strictEqual(rec.visibility, 'L1');
      assert.deepStrictEqual(rec.windows, []);
      const l = auditLines(fx).find((x) => x.alias === 'a');
      assert.strictEqual(l.quota_capture, 'bad_event');
      assert.strictEqual(l.outcome, 'rate_limited');
    } finally { fx.cleanup(); }
  }
});

test('G40-N13: usage-probe --purpose reaches the audit line; without it the purpose is quota-probe', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: stream(ev(0.31, 0.05)) } });
  try {
    await go(fx, ['usage-probe', '--alias', 'a', '--purpose', 'my-check']);
    await go(fx, ['usage-probe', '--alias', 'a']);
    assert.deepStrictEqual(auditLines(fx).map((l) => l.purpose), ['my-check', 'quota-probe']);
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ BL-0375 probe policy per provider

const REPO = path.resolve(__dirname, '..');
const CLI_SRC = path.join(__dirname, 'claude-account.js');
const MANIFEST_LITERAL = "path.join(__dirname, 'quota-adapters', 'claude.json')";
const EVD = 'docs/plans/evidence/2026-11-03-g40-agent-lane-quota/capability-matrix.md';
const Q5 = { percent: 0.5, window: 'rolling_5h', evidence: EVD };
const tmpDirs = [];
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
// A copy of the shipped Claude manifest with the policy facts changed: the CLI reads it instead of claude.json. Test-only
// source rewrite of an in-memory copy of claude-account.js; the production file has no switch for this.
function cliWithManifest(mut) {
  const m = JSON.parse(JSON.stringify(MANIFEST));
  mut(m);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g40-manifest-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'claude.json');
  fs.writeFileSync(file, JSON.stringify(m));
  return (extra) => loadPatched(CLI_SRC, [[MANIFEST_LITERAL, JSON.stringify(file)]].concat(extra || [])).cli;
}
const CONFIRMED = (m) => {
  m.starts_window = false; m.starts_window_evidence = EVD; m.starts_window_confidence = 'high';
  m.capture.find((x) => x.mode === 'tinyprobe').quota_share_per_probe = Q5;
};
const UNKNOWN = () => {};
async function goWith(cliFn, fx, args) {
  let out = '';
  let err = '';
  const code = await cliFn(args, { env: fx.env, realHome: fx.realHome, warn: () => {}, now: () => NOW, write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); } });
  return { code, out, err };
}
const demandLine = (fx, alias, ageS, purpose) => audit.appendAudit({ alias, purpose: purpose || 'tst', attempt: 1, outcome: 'ok' }, { path: fx.auditFile, now: NOW - ageS * 1000 });
const dueFx = (extra) => makeFixture(Object.assign({ aliases: [{ alias: 'a' }, { alias: 'b' }], config: {}, probeFromManifest: true }, extra || {}));

test('G40-BL0375: unset quota_probe on a confirmed-false manifest with Q5 is periodic: --due --dry-run lists the alias that a run used and has no newer observation; --due probes it', async () => {
  const cli = cliWithManifest(CONFIRMED)();
  const fx = dueFx({ responses: { a: stream(ev(0.3, 0.1)) } });
  try {
    demandLine(fx, 'a', 3600);
    const dry = await goWith(cli, fx, ['usage-probe', '--due', '--dry-run']);
    assert.strictEqual(dry.code, 0, dry.err);
    assert.deepStrictEqual(JSON.parse(dry.out), { due: ['a'], probed: [] });
    assert.strictEqual(fx.shim.spawns(), 0, 'dry run never spawns');
    const live = await goWith(cli, fx, ['usage-probe', '--due']);
    assert.strictEqual(live.code, 0, live.err);
    assert.deepStrictEqual(JSON.parse(live.out), { due: ['a'], probed: [{ alias: 'a', outcome: 'ok' }] });
    assert.strictEqual(probeCalls(fx).length, 1);
    assert.deepStrictEqual(fx.shim.calls()[0].argv, PROBE_ARGV);
    assert.ok(rowOf(fx, 'a'), 'the probe wrote a mirror row');
    const again = await goWith(cli, fx, ['usage-probe', '--due', '--dry-run']);
    assert.deepStrictEqual(JSON.parse(again.out).due, [], 'a fresh observation (< 30 min) skips the alias');
  } finally { fx.cleanup(); }
});

test('G40-N13/BL0375 red: unknown, true, false below high, false+high without Q5, and explicit off or stale never get a periodic spawn, even with demand and a stale alias', async () => {
  const cases = {
    'unknown (the shipped Claude manifest)': [UNKNOWN, {}],
    'true': [(m) => { m.starts_window = true; m.starts_window_evidence = EVD; m.starts_window_confidence = 'high'; m.capture.find((x) => x.mode === 'tinyprobe').quota_share_per_probe = Q5; }, {}],
    'false + medium': [(m) => { CONFIRMED(m); m.starts_window_confidence = 'medium'; }, {}],
    'false + high, no Q5': [(m) => { CONFIRMED(m); delete m.capture.find((x) => x.mode === 'tinyprobe').quota_share_per_probe; }, {}],
    'confirmed but explicit off': [CONFIRMED, { accounts: { quota_probe: 'off' } }],
    'confirmed but explicit stale': [CONFIRMED, { accounts: { quota_probe: 'stale' } }],
  };
  for (const [name, [mut, config]] of Object.entries(cases)) {
    const fx = dueFx({ config });
    try {
      demandLine(fx, 'a', 60);
      const r = await goWith(cliWithManifest(mut)(), fx, ['usage-probe', '--due']);
      assert.strictEqual(r.code, 0, `${name}: ${r.err}`);
      assert.deepStrictEqual(JSON.parse(r.out), { due: [], probed: [] }, name);
      assert.strictEqual(fx.shim.spawns(), 0, `${name}: zero spawns`);
    } finally { fx.cleanup(); }
  }
});

test('G40-BL0375: on-demand probing at run needs no Q5: false+high without Q5 and unknown both probe once before pick; explicit off does not; confirmed also probes on demand', async () => {
  const noQ5 = (m) => { CONFIRMED(m); delete m.capture.find((x) => x.mode === 'tinyprobe').quota_share_per_probe; };
  for (const [name, mut, config, want] of [['unknown', UNKNOWN, {}, 1], ['false+high no Q5', noQ5, {}, 1], ['confirmed (periodic)', CONFIRMED, {}, 1], ['explicit off', CONFIRMED, { accounts: { quota_probe: 'off' } }, 0]]) {
    const fx = dueFx({ config });
    try {
      const r = await goWith(cliWithManifest(mut)(), fx, RUN);
      assert.strictEqual(r.code, 0, `${name}: ${r.err}`);
      assert.strictEqual(probeCalls(fx).length, want, name);
    } finally { fx.cleanup(); }
  }
});

test('G40-BL0375: explicit scheduled is accepted only when the periodic gate passes', async () => {
  const cfg = { accounts: { quota_probe: 'scheduled' } };
  let fx = dueFx({ config: cfg });
  try { assert.strictEqual((await goWith(cliWithManifest(CONFIRMED)(), fx, ['status'])).code, 0); } finally { fx.cleanup(); }
  fx = dueFx({ config: cfg });
  try {
    const r = await goWith(cliWithManifest((m) => { CONFIRMED(m); delete m.capture.find((x) => x.mode === 'tinyprobe').quota_share_per_probe; })(), fx, ['status']);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /config_quota_probe_scheduled_rejected/);
  } finally { fx.cleanup(); }
});

test('G40-BL0375 fail closed: a missing, damaged, unreadable or stale audit log means no demand, so --due probes nothing', async () => {
  const cli = cliWithManifest(CONFIRMED);
  const scenarios = {
    'audit file missing': () => {},
    'audit path is a directory': (fx) => { fs.mkdirSync(fx.auditFile, { recursive: true }); },
    'audit path is a symlink': (fx) => { fs.mkdirSync(path.dirname(fx.auditFile), { recursive: true }); fs.symlinkSync(path.join(fx.root, 'elsewhere.jsonl'), fx.auditFile); },
    'one damaged line next to a good demand line': (fx) => { demandLine(fx, 'a', 60); fs.appendFileSync(fx.auditFile, 'not json\n'); },
    'a line with an unknown key': (fx) => { demandLine(fx, 'a', 60); fs.appendFileSync(fx.auditFile, JSON.stringify({ ts: NOW, extra: 1 }) + '\n'); },
    'demand older than 24 h': (fx) => { demandLine(fx, 'a', 86401); },
    'only the probe wrote the line': (fx) => { demandLine(fx, 'a', 60, 'quota-probe'); },
  };
  for (const [name, setup] of Object.entries(scenarios)) {
    const fx = dueFx();
    try {
      setup(fx);
      const r = await goWith(cli(), fx, ['usage-probe', '--due']);
      assert.strictEqual(r.code, 0, `${name}: ${r.err}`);
      assert.deepStrictEqual(JSON.parse(r.out), { due: [], probed: [] }, name);
      assert.strictEqual(fx.shim.spawns(), 0, name);
    } finally { fx.cleanup(); }
  }
});

test('G40-BL0375 negative control: a CLI that drops the fail-closed audit read is caught by the fail-closed scenarios', async () => {
  // Each scenario would list alias a as due if the audit read did not fail closed (a good demand line is present or implied).
  const damaged = (fx) => { demandLine(fx, 'a', 60); fs.appendFileSync(fx.auditFile, 'not json\n'); };
  const refused = (fx) => { fs.mkdirSync(fx.auditFile, { recursive: true }); };
  const unreadable = (fx) => { fs.mkdirSync(path.dirname(fx.auditFile), { recursive: true }); fs.symlinkSync(path.join(fx.root, 'elsewhere.jsonl'), fx.auditFile); };
  const dueOf = async (cli, setup) => {
    const fx = dueFx();
    try { setup(fx); return JSON.parse((await goWith(cli, fx, ['usage-probe', '--due', '--dry-run'])).out).due; } finally { fx.cleanup(); }
  };
  const real = cliWithManifest(CONFIRMED)();
  for (const setup of [damaged, refused, unreadable]) assert.deepStrictEqual(await dueOf(real, setup), []);
  const noInvalidCheck = cliWithManifest(CONFIRMED)([['if (res.refused || res.invalid > 0) return new Set();', '']]);
  assert.notDeepStrictEqual(await dueOf(noInvalidCheck, damaged), [], 'mutant: damaged log still counts as demand');
  const noCatch = cliWithManifest(CONFIRMED)([['return probe.demandAliases(res.records, ctx.now());\n  } catch (_) { return new Set(); }', "return probe.demandAliases(res.records, ctx.now());\n  } catch (_) { return new Set(['a']); }"]]);
  assert.notDeepStrictEqual(await dueOf(noCatch, unreadable), [], 'mutant: an unreadable log counts everyone as demand');
  const noPolicy = cliWithManifest(CONFIRMED)([["if (res.refused || res.invalid > 0) return new Set();", "if (res.refused) return new Set(['a']);"]]);
  assert.notDeepStrictEqual(await dueOf(noPolicy, refused), [], 'mutant: a refused log counts as demand');
});

test('G40-BL0375 negative control: a run that probes on demand only under `stale` (not `scheduled`) is caught', async () => {
  const mutant = cliWithManifest(CONFIRMED)([["if (cfg.quota_probe !== 'off' && !pinned && !probeChecked) {", "if (cfg.quota_probe === 'stale' && !pinned && !probeChecked) {"]]);
  const fx = dueFx();
  try {
    await goWith(mutant, fx, RUN);
    assert.strictEqual(probeCalls(fx).length, 0, 'the mutant skips the on-demand probe that the real CLI makes (see the on-demand test)');
  } finally { fx.cleanup(); }
});

test('G40-BL0375 no registry: with quota_probe unset every registry command ends as before (registry_not_configured / unconfigured), with zero spawns and no file written', async () => {
  const before = (fx) => fs.readdirSync(fx.root).sort().join(',') + '|' + (fs.existsSync(fx.auditFile) ? 'audit' : 'no-audit');
  for (const args of [RUN, ['usage-probe', '--alias', 'a'], ['status'], ['pick'], ['env-check'], ['sync-statusline'], ['cooldown', '--clear', 'a']]) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }], config: {}, probeFromManifest: true });
    try {
      fs.rmSync(fx.regFile);
      const was = before(fx);
      const r = await go(fx, args);
      assert.ok(r.err.includes('registry_not_configured') || r.out.includes('unconfigured') || r.code === 0, `${args[0]}: ${r.err}${r.out}`);
      assert.strictEqual(fx.shim.spawns(), 0, args[0]);
      assert.strictEqual(before(fx), was, `${args[0]}: nothing written`);
      assert.ok(!fs.existsSync(fx.liveDir + '/quota-mirror'), 'no mirror directory');
    } finally { fx.cleanup(); }
  }
});
