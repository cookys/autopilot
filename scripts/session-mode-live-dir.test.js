/**
 * Repro of the 2026-10-05 live-store leak (mods P1W LIVEDIR): a plain `session-mode.js set` with
 * AUTOPILOT_LIVE_DIR on a disk-backed filesystem and the watcher autostart ON. Before the fix a
 * rejected (non-RAM) override fell through to $XDG_RUNTIME_DIR/autopilot — in the leak the REAL
 * /run/user/<uid>/autopilot — and the detached watcher lived on after the probe.
 * Isolation: XDG_RUNTIME_DIR points at a scratch dir under /dev/shm, so a fall-through lands there
 * (asserted empty), never in the real store; the review server autostart is off.
 * RED before the fix (w/livedir@297ab2e0; run-w/livedir/red-repro.txt):
 *   2 of 2 failing: the detached watcher published under the scratch XDG dir (override ignored),
 *   and a symlink override started a watcher instead of being refused.
 * Run: node --test scripts/session-mode-live-dir.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SM = path.join(__dirname, 'session-mode.js');
const SHM_OK = (() => { try { fs.accessSync('/dev/shm', fs.constants.W_OK); return true; } catch { return false; } })();

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Kill every watcher whose envelope lives under one of the given live bases (by PID, never by pattern).
function reapWatchers(bases) {
  for (const base of bases) {
    for (const f of listFiles(path.join(base, 'runs')).filter((x) => /\/runs\/[0-9a-f]{16}\.json$/.test(x))) {
      try {
        const pid = JSON.parse(fs.readFileSync(f, 'utf8')).writer.pid;
        if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
      } catch { /* no writer / already gone */ }
    }
  }
  sleep(300);
}

// Safety net for a failing run (the envelope may not exist yet): signal, by PID, every watcher
// process whose environment carries this test's own temp root. Never a pattern kill.
function reapByEnv(root) {
  const needle = Buffer.from(`AUTOPILOT_LIVE_DIR=${root}`);
  for (const name of fs.readdirSync('/proc')) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0');
      if (!(cmd.includes('--watch') && cmd.includes('runs'))) continue;
      if (fs.readFileSync(`/proc/${name}/environ`).includes(needle)) process.kill(Number(name), 'SIGTERM');
    } catch { /* gone or not ours */ }
  }
  sleep(300);
}

function setup() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lvd-repro-'));
  const xdg = fs.mkdtempSync('/dev/shm/lvd-xdg-');
  fs.chmodSync(xdg, 0o700);
  fs.mkdirSync(path.join(T, 'h'));
  fs.mkdirSync(path.join(T, 'r'));
  const git = (...a) => spawnSync('git', a, { cwd: path.join(T, 'r'), encoding: 'utf8' });
  git('init', '-q');
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(T, 'h'),
    AUTOPILOT_SESSION_MODE_DIR: path.join(T, 'm'),
    CLAUDE_CODE_SESSION_ID: 's2',
    XDG_RUNTIME_DIR: xdg,
    AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0',
  };
  return { T, xdg, env, repo: path.join(T, 'r') };
}

function runSet(ctx, liveDir) {
  const env = { ...ctx.env, AUTOPILOT_LIVE_DIR: liveDir };
  return spawnSync(process.execPath, [SM, 'set'], { cwd: ctx.repo, env, encoding: 'utf8', timeout: 30000 });
}

test('plain `set`, disk-backed override, autostart ON: the watcher writes only under the override, XDG scratch stays empty',
  { skip: !SHM_OK && '/dev/shm not writable' }, (t) => {
    const ctx = setup();
    const live = path.join(ctx.T, 'l');
    try {
      const r = runSet(ctx, live);
      assert.strictEqual(r.status, 0, r.stderr);
      // wait for the watcher's first envelope under the override
      let env = [];
      for (let i = 0; i < 100 && env.length === 0; i += 1) {
        env = listFiles(path.join(live, 'runs')).filter((x) => /\/runs\/[0-9a-f]{16}\.json$/.test(x));
        if (env.length === 0) sleep(100);
      }
      assert.deepStrictEqual(listFiles(ctx.xdg), [], 'XDG scratch (the stand-in for the real store) is empty');
      assert.ok(!fs.existsSync(path.join(ctx.xdg, 'autopilot')), 'no autopilot dir created under XDG');
      assert.ok(env.length > 0, `watcher envelope appears under the override. stderr: ${r.stderr}`);
    } finally {
      reapWatchers([live, path.join(ctx.xdg, 'autopilot')]);
      reapByEnv(ctx.T);
      fs.rmSync(ctx.T, { recursive: true, force: true });
      fs.rmSync(ctx.xdg, { recursive: true, force: true });
    }
  });

test('plain `set`, symlink override: marker still written, watcher NOT started, message says refused, nothing written elsewhere',
  { skip: !SHM_OK && '/dev/shm not writable' }, () => {
    const ctx = setup();
    const real = path.join(ctx.T, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    const link = path.join(ctx.T, 'l');
    fs.symlinkSync(real, link);
    try {
      const r = runSet(ctx, link);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stderr, /watcher not started/);
      assert.match(r.stderr, /AUTOPILOT_LIVE_DIR=.* refused: it is a symlink/);
      const marker = JSON.parse(fs.readFileSync(path.join(ctx.T, 'm', 's2.json'), 'utf8'));
      assert.strictEqual(marker.session_id, 's2', 'the marker is still written');
      sleep(1500); // a wrongly-started watcher would have published by now
      assert.deepStrictEqual(listFiles(ctx.xdg), [], 'XDG scratch stays empty');
      assert.deepStrictEqual(listFiles(real), [], 'symlink target stays empty');
    } finally {
      reapWatchers([real, path.join(ctx.xdg, 'autopilot')]);
      reapByEnv(ctx.T);
      fs.rmSync(ctx.T, { recursive: true, force: true });
      fs.rmSync(ctx.xdg, { recursive: true, force: true });
    }
  });
