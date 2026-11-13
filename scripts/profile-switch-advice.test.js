'use strict';
// profile-switch-advice: unit tests for §P3 rules (a)-(g), injected now/fs/run.
// Uses isolated temp dirs, no real ~/.claude, no credential files, no email/token shapes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('./profile-switch-advice.js');
const { SCHEMA, quotaDir } = require('./lib/account-quota.js');
const { claudeAccount } = require('./lib/account-alias.js');
const { writeManifest } = require('./lib/lane-manifest.js');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BASE_NOW = Date.parse('2026-11-10T04:00:00.000Z'); // 12:00 +08

function makeFx(profiles = ['home', 'work']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'psat-'));
  const baseDir = path.join(home, '.config', 'autopilot');
  const liveBase = path.join(home, 'live');
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(quotaDir(liveBase), { recursive: true, mode: 0o700 });

  const aliases = {};
  for (const p of profiles) {
    const dir = p === 'home' ? path.join(home, '.claude') : path.join(home, '.claude-profiles', p);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const env = { HOME: home };
    if (p !== 'home') env.CLAUDE_CONFIG_DIR = dir;
    aliases[p] = claudeAccount(env);
  }

  return {
    home,
    baseDir,
    liveBase,
    aliases,
    readingsFile: path.join(baseDir, 'quota-readings.jsonl'),
    stateFile: path.join(baseDir, 'profile-switch-advice-state.json'),
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); },
  };
}

function addLane(fx, lane, profile) {
  writeManifest(fx.baseDir, {
    lane,
    pane: 'lanes:1.0',
    cwd: '/work/project',
    seat: `${lane}--claude`,
    session_id: `sid-${lane}`,
    model: 'opus',
    launch_flags: [],
    profile,
  });
}

function writeSnap(fx, profile, { writtenAtMs, pct, resetsAtSec }) {
  const alias = fx.aliases[profile];
  const file = path.join(quotaDir(fx.liveBase), `${alias}.json`);
  const snap = {
    schema: SCHEMA,
    alias,
    written_at_ms: writtenAtMs,
    seven_day: { pct, resets_at: resetsAtSec },
  };
  fs.writeFileSync(file, JSON.stringify(snap), { mode: 0o600 });
}

function runAdvice(fx, { argv = [], nowMs = BASE_NOW, runCalls = [], runImpl } = {}) {
  const out = [];
  const err = [];
  const run = (bin, args, opts) => {
    runCalls.push({ bin, args, opts });
    // The executed program (bin, or a script passed to node) must never be lane-switch; the
    // recommendation text itself carries the lane-switch command for the PM to run.
    const exe = [bin, bin === 'node' || /\/node$/.test(bin) ? (args || [])[0] : ''].join(' ');
    assert.ok(!exe.includes('lane-switch'), `runner must never invoke lane-switch: ${exe}`);
    if (typeof runImpl === 'function') return runImpl(bin, args, opts);
    return { status: 0, stdout: 'sent\n', stderr: '' };
  };
  const code = main(argv, {
    fs,
    now: () => nowMs,
    run,
    home: fx.home,
    baseDir: fx.baseDir,
    liveBase: fx.liveBase,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), runCalls };
}

test('a: pool at 0.90 with target at 0.40 emits one [建議] move-out with lane-switch command', () => {
  const fx = makeFx(['home', 'work']);
  try {
    addLane(fx, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 12 * HOUR_MS) / 1000);
    writeSnap(fx, 'home', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.90, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.40, resetsAtSec: resetSec + 3600 });

    const r = runAdvice(fx);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.runCalls.length, 0);
    const lines = r.out.split('\n');
    assert.strictEqual(lines[0], '[建議]');
    assert.match(r.out, /車道：l1/);
    assert.match(r.out, /來源：home/);
    assert.match(r.out, /90%/);
    assert.match(r.out, /目標：work/);
    assert.match(r.out, /40%/);
    assert.match(r.out, /\+08/);
    assert.ok(!/\d{4}-\d{2}-\d{2}T.*Z/.test(r.out), 'Taipei output must not contain UTC Z timestamps');
    assert.ok(
      r.out.includes('node scripts/lane-switch.js --lane l1 --profile work --order <PM 訊息 id>'),
      `expected exact lane-switch command in:\n${r.out}`,
    );

    // Verify Rule 6: readings appended via jsonl-store without sensitive fields
    const rows = fs.readFileSync(fx.readingsFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows.length, 2);
    for (const row of rows) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['alias', 'pct', 'profile', 'resets_at', 'ts_ms']);
    }
  } finally {
    fx.cleanup();
  }
});

test('b: burn-rate 2 h apart (0.60 -> 0.75, resets_at 10 h away) triggers move-out; 30 min apart stays silent', () => {
  const fx2h = makeFx(['home', 'work']);
  try {
    addLane(fx2h, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 10 * HOUR_MS) / 1000);
    writeSnap(fx2h, 'home', { writtenAtMs: BASE_NOW - 2 * HOUR_MS, pct: 0.60, resetsAtSec: resetSec });
    writeSnap(fx2h, 'work', { writtenAtMs: BASE_NOW - 2 * HOUR_MS, pct: 0.25, resetsAtSec: resetSec + 3600 });
    const r1 = runAdvice(fx2h, { nowMs: BASE_NOW - 2 * HOUR_MS });
    assert.strictEqual(r1.code, 0);
    assert.strictEqual(r1.out, '');

    writeSnap(fx2h, 'home', { writtenAtMs: BASE_NOW, pct: 0.75, resetsAtSec: resetSec });
    writeSnap(fx2h, 'work', { writtenAtMs: BASE_NOW, pct: 0.25, resetsAtSec: resetSec + 3600 });
    const r2 = runAdvice(fx2h, { nowMs: BASE_NOW });
    assert.strictEqual(r2.code, 0);
    assert.strictEqual(r2.out.split('\n')[0], '[建議]');
    assert.match(r2.out, /來源：home/);
    assert.match(r2.out, /預估/);
    assert.ok(r2.out.includes('node scripts/lane-switch.js --lane l1 --profile work --order <PM 訊息 id>'));
  } finally {
    fx2h.cleanup();
  }

  const fx30m = makeFx(['home', 'work']);
  try {
    addLane(fx30m, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 10 * HOUR_MS) / 1000);
    const t0 = BASE_NOW - 30 * 60 * 1000;
    writeSnap(fx30m, 'home', { writtenAtMs: t0, pct: 0.60, resetsAtSec: resetSec });
    writeSnap(fx30m, 'work', { writtenAtMs: t0, pct: 0.25, resetsAtSec: resetSec + 3600 });
    assert.strictEqual(runAdvice(fx30m, { nowMs: t0 }).out, '');

    writeSnap(fx30m, 'home', { writtenAtMs: BASE_NOW, pct: 0.75, resetsAtSec: resetSec });
    writeSnap(fx30m, 'work', { writtenAtMs: BASE_NOW, pct: 0.25, resetsAtSec: resetSec + 3600 });
    const r = runAdvice(fx30m, { nowMs: BASE_NOW });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.out, '');
  } finally {
    fx30m.cleanup();
  }
});

test('c: no usable reading (absent or stale > 6 h) produces no output and exits 0', () => {
  const fx = makeFx(['home', 'work']);
  try {
    addLane(fx, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 12 * HOUR_MS) / 1000);
    // Absent reading first
    const rMissing = runAdvice(fx);
    assert.strictEqual(rMissing.code, 0);
    assert.strictEqual(rMissing.out, '');

    // Stale (> 6 h) high reading
    writeSnap(fx, 'home', { writtenAtMs: BASE_NOW - (6 * HOUR_MS + 60 * 1000), pct: 0.95, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: BASE_NOW - 10 * 60 * 1000, pct: 0.20, resetsAtSec: resetSec });
    const rStale = runAdvice(fx);
    assert.strictEqual(rStale.code, 0);
    assert.strictEqual(rStale.out, '');
  } finally {
    fx.cleanup();
  }
});

test('d: no target under 0.70 prints [建議] saying no target and prints no lane-switch command', () => {
  const fx = makeFx(['home', 'work', 'backup']);
  try {
    addLane(fx, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 12 * HOUR_MS) / 1000);
    writeSnap(fx, 'home', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.92, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.70, resetsAtSec: resetSec }); // 0.70 is not < 0.70
    writeSnap(fx, 'backup', { writtenAtMs: BASE_NOW - (6 * HOUR_MS + 1000), pct: 0.10, resetsAtSec: resetSec }); // stale target

    const r = runAdvice(fx);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.out.split('\n')[0], '[建議]');
    assert.match(r.out, /無可用目標訂閱池/);
    assert.ok(!/lane-switch\.js/.test(r.out), `must not print lane-switch command when no target exists:\n${r.out}`);
  } finally {
    fx.cleanup();
  }
});

test('e: second run within 24 h for the same lane is silent; after 24 h recommends again', () => {
  const fx = makeFx(['home', 'work']);
  try {
    addLane(fx, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 48 * HOUR_MS) / 1000);
    writeSnap(fx, 'home', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.91, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: BASE_NOW - 5 * 60 * 1000, pct: 0.30, resetsAtSec: resetSec });

    const r1 = runAdvice(fx, { nowMs: BASE_NOW });
    assert.strictEqual(r1.code, 0);
    assert.match(r1.out, /\[建議\]/);

    // 12 hours later (< 24h) -> silent
    const t2 = BASE_NOW + 12 * HOUR_MS;
    writeSnap(fx, 'home', { writtenAtMs: t2 - 5 * 60 * 1000, pct: 0.93, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: t2 - 5 * 60 * 1000, pct: 0.31, resetsAtSec: resetSec });
    const r2 = runAdvice(fx, { nowMs: t2 });
    assert.strictEqual(r2.code, 0);
    assert.strictEqual(r2.out, '');

    // 25 hours later (>= 24h) -> emits again
    const t3 = BASE_NOW + 25 * HOUR_MS;
    writeSnap(fx, 'home', { writtenAtMs: t3 - 5 * 60 * 1000, pct: 0.94, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: t3 - 5 * 60 * 1000, pct: 0.32, resetsAtSec: resetSec });
    const r3 = runAdvice(fx, { nowMs: t3 });
    assert.strictEqual(r3.code, 0);
    assert.match(r3.out, /\[建議\]/);
  } finally {
    fx.cleanup();
  }
});

test('f: origin pool reset (resets_at passed or later window < 0.70) recommends move-back', () => {
  // f1: later window reading < 0.70
  const fx1 = makeFx(['home', 'work']);
  try {
    addLane(fx1, 'l1', 'home');
    const reset1Sec = Math.floor((BASE_NOW + 20 * HOUR_MS) / 1000);
    writeSnap(fx1, 'home', { writtenAtMs: BASE_NOW, pct: 0.92, resetsAtSec: reset1Sec });
    writeSnap(fx1, 'work', { writtenAtMs: BASE_NOW, pct: 0.25, resetsAtSec: reset1Sec + 48 * 3600 });
    const rOut = runAdvice(fx1, { nowMs: BASE_NOW });
    assert.match(rOut.out, /--profile work/);

    // Simulate PM executed switch to work
    addLane(fx1, 'l1', 'work');

    // Origin pool resets into new window with 0.05 used (after 24h cooldown)
    const tBack = BASE_NOW + DAY_MS + HOUR_MS;
    const reset2Sec = reset1Sec + 7 * 24 * 3600;
    writeSnap(fx1, 'home', { writtenAtMs: tBack - 5 * 60 * 1000, pct: 0.05, resetsAtSec: reset2Sec });
    writeSnap(fx1, 'work', { writtenAtMs: tBack - 5 * 60 * 1000, pct: 0.45, resetsAtSec: reset1Sec + 48 * 3600 });
    const rBack = runAdvice(fx1, { nowMs: tBack });
    assert.strictEqual(rBack.code, 0);
    assert.strictEqual(rBack.out.split('\n')[0], '[建議]');
    assert.match(rBack.out, /來源：work/);
    assert.match(rBack.out, /目標：home/);
    assert.match(rBack.out, /原訂閱池已重置/);
    assert.ok(rBack.out.includes('node scripts/lane-switch.js --lane l1 --profile home --order <PM 訊息 id>'));
  } finally {
    fx1.cleanup();
  }

  // f2: origin resets_at passed without fresh post-reset reading yet
  const fx2 = makeFx(['home', 'work']);
  try {
    addLane(fx2, 'l1', 'home');
    const reset1Sec = Math.floor((BASE_NOW + 20 * HOUR_MS) / 1000);
    writeSnap(fx2, 'home', { writtenAtMs: BASE_NOW, pct: 0.91, resetsAtSec: reset1Sec });
    writeSnap(fx2, 'work', { writtenAtMs: BASE_NOW, pct: 0.20, resetsAtSec: reset1Sec + 48 * 3600 });
    runAdvice(fx2, { nowMs: BASE_NOW });

    addLane(fx2, 'l1', 'work');
    const tPassed = BASE_NOW + DAY_MS + 2 * HOUR_MS; // past reset1Sec and past 24h cooldown
    writeSnap(fx2, 'work', { writtenAtMs: tPassed - 5 * 60 * 1000, pct: 0.35, resetsAtSec: reset1Sec + 48 * 3600 });
    const rBack = runAdvice(fx2, { nowMs: tPassed });
    assert.strictEqual(rBack.code, 0);
    assert.strictEqual(rBack.out.split('\n')[0], '[建議]');
    assert.match(rBack.out, /目標：home/);
    assert.ok(rBack.out.includes('node scripts/lane-switch.js --lane l1 --profile home --order <PM 訊息 id>'));
  } finally {
    fx2.cleanup();
  }
});

test('g: --send-to calls fleet send once and runner is never called with lane-switch', () => {
  const fx = makeFx(['home', 'work']);
  try {
    addLane(fx, 'l1', 'home');
    const resetSec = Math.floor((BASE_NOW + 12 * HOUR_MS) / 1000);
    writeSnap(fx, 'home', { writtenAtMs: BASE_NOW - 1000, pct: 0.95, resetsAtSec: resetSec });
    writeSnap(fx, 'work', { writtenAtMs: BASE_NOW - 1000, pct: 0.20, resetsAtSec: resetSec + 3600 });

    const r = runAdvice(fx, { argv: ['--send-to', 'autopilot/courier/pm'] });
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.out, '');
    assert.strictEqual(r.runCalls.length, 1);
    const call = r.runCalls[0];
    assert.strictEqual(call.bin, 'fleet');
    assert.strictEqual(call.args[0], 'send');
    assert.strictEqual(call.args[1], 'autopilot/courier/pm');
    assert.strictEqual(call.args[2].split('\n')[0], '[建議]');
    assert.ok(call.args[2].includes('node scripts/lane-switch.js --lane l1 --profile work --order <PM 訊息 id>'));
    assert.ok(r.runCalls.every((c) => !c.bin.includes('lane-switch') && !c.args.some((a) => String(a).includes('lane-switch.js --lane') && c.bin !== 'fleet')));
    assert.ok(r.runCalls.every((c) => !c.bin.includes('lane-switch')));
  } finally {
    fx.cleanup();
  }
});
