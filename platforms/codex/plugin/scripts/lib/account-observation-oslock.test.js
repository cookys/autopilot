'use strict';
// G40 BL-0374: the per-alias mirror lock is an OS flock held by a helper process, so a LIVE writer that stalls for any
// length of time cannot have the lock taken away. Red cases (each is run against the real module AND against a mutant):
//   S  a holder stalled past the old hard cap keeps the lock: a second writer gets mirror_lock_busy
//   C  the stalled holder, once it wakes, never overwrites a newer publication
//   T  no flock and no perl on PATH: write_failed / lock_helper, nothing written, no fallback to a lockfile
// Negative control: the MUTANT is a copy of the current module with the OS-lock section replaced by the pre-BL-0374 lockfile
// mechanism (account-fixtures/legacy-lockfile-block.txt, frozen from aa95f0ce3). Cases S, C, T must be RED on it
// (rejects) and GREEN on the real module. Kept green-only cases: K (kill -9 frees the lock), H (a dead helper blocks the
// publish), the stall-before-the-lock case, and a leak check (no holder, helper or stalled child outlives the file).
// The cap is injected small (hardMaxMs: 300) so nothing sleeps 120 s; the real mechanism ignores it.
// Run: node --test scripts/lib/account-observation-oslock.test.js
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const o = require('./account-observation');
const { makeFixture } = require('./account-fixtures/shim-install');
const { holdOsLock, installLeakCheck } = require('./account-fixtures/os-lock-holder');

installLeakCheck(after);

const REAL = path.join(__dirname, 'account-observation.js');
const kids = new Set();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'oslock-test-'));

after(async () => {
  for (const k of kids) { try { k.kill('SIGCONT'); k.kill('SIGKILL'); } catch (_) { /* gone */ } }
  await Promise.all([...kids].map((k) => new Promise((res) => { if (k.exitCode !== null || k.signalCode !== null) res(); else k.on('exit', res); })));
  const pids = [...kids].map((k) => k.pid);
  kids.clear();
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `child ${pid} left no process behind`);
  // no helper (flock/perl/sh holding an .oslock under our root) survives either; give a dying one a moment
  if (fs.existsSync('/proc/self/cmdline')) {
    const left = () => fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).filter((n) => {
      try { return fs.readFileSync(`/proc/${n}/cmdline`, 'latin1').includes(ROOT); } catch (_) { return false; }
    });
    for (let i = 0; i < 100 && left().length; i += 1) await new Promise((res) => setTimeout(res, 30));
    assert.deepStrictEqual(left(), [], 'no helper process under the test root is left');
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// The mutant: the current module with the OS-lock section swapped for the legacy lockfile block; relative requires made absolute.
function buildMutant() {
  const src = fs.readFileSync(REAL, 'utf8');
  const start = src.indexOf('// --- per-alias lock: an OS-held flock');
  const end = src.indexOf('// The view envelope keys a writer understands');
  assert.ok(start > 0 && end > start, 'the OS-lock section markers are present');
  const legacy = fs.readFileSync(path.join(__dirname, 'account-fixtures', 'legacy-lockfile-block.txt'), 'utf8');
  let m = src.slice(0, start) + legacy + src.slice(end);
  m = m.replace(/require\('\.\//g, `require('${__dirname}/`);
  const file = path.join(ROOT, 'account-observation.mutant.js');
  fs.writeFileSync(file, m);
  return file;
}
let mutantFile = null;
const MUTANT = () => { if (!mutantFile) mutantFile = buildMutant(); return mutantFile; };

const CODE = `const cfg = JSON.parse(process.argv[1]); const o = require(cfg.mod); const fs = require('fs');
  const rec = { schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L3', windows: [{ kind: 'rolling_5h', utilization: cfg.u, resets_at: cfg.at + 3600, source: 'passive', observed_at: cfg.at }], refusal: null, token_state: 'unknown', token_state_at: null, host_role: 'agent' };
  const hooks = {};
  if (cfg.stall) hooks.beforeRename = () => { fs.writeSync(1, 'stalled\\n'); process.kill(process.pid, 'SIGSTOP'); };
  if (cfg.killHelper) hooks.beforePublish = () => { for (const t of fs.readFileSync('/proc/' + process.pid + '/task/' + process.pid + '/children', 'utf8').split(' ').filter(Boolean)) { try { process.kill(Number(t), 'SIGKILL'); } catch (_) {} } };
  const opts = { waitMs: cfg.waitMs, hooks };
  if (cfg.hardMaxMs !== undefined) opts.hardMaxMs = cfg.hardMaxMs;
  const r = o.writeLocalRow(cfg.live, rec, opts);
  process.stdout.write(JSON.stringify(r) + '\\n');`;
const NOW_S = () => Math.floor(Date.now() / 1000);

function startWriter(cfg, env) {
  const c = spawn(process.execPath, ['-e', CODE, JSON.stringify(cfg)], { stdio: ['ignore', 'pipe', 'inherit'], env: env || process.env });
  kids.add(c);
  let out = '';
  const stalled = new Promise((res) => { c.stdout.on('data', (d) => { out += d; if (out.includes('stalled')) res(); }); });
  const exited = new Promise((res) => c.on('exit', res));
  return { c, stalled, exited, out: () => out };
}
function runWriter(cfg, env) {
  const r = spawnSync(process.execPath, ['-e', CODE, JSON.stringify(cfg)], { encoding: 'utf8', timeout: 20000, env: env || process.env });
  assert.strictEqual(r.signal, null, `the writer child was not killed (${r.stderr})`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
function fixtureDir() { return makeFixture({ aliases: [{ alias: 'a' }] }); }
const rowOf = (fx) => { const v = o.readView(fx.liveDir, 'claude', 'a'); return v && v.view && v.view.rows.length ? v.view.rows[0].record.windows[0].utilization : null; };

// S: A stalls (alive) between its last check and the rename for longer than the cap; B must be told busy.
async function caseStalled(mod) {
  const fx = fixtureDir();
  const a = startWriter({ mod, live: fx.liveDir, u: 0.1, at: NOW_S() - 100, stall: true });
  try {
    await a.stalled;
    await new Promise((res) => setTimeout(res, 700)); // longer than the injected 300 ms cap
    const b = runWriter({ mod, live: fx.liveDir, u: 0.7, at: NOW_S() - 10, waitMs: 600, hardMaxMs: 300 });
    assert.deepStrictEqual(b, { ok: false, code: 'mirror_lock_busy' }, 'a stalled but live holder keeps the lock');
  } finally { a.c.kill('SIGCONT'); a.c.kill('SIGKILL'); await a.exited; fx.cleanup(); }
}
// C: the stalled A wakes after B tried to publish a newer row; whatever B got, the newer row must not be lost to A's rename.
async function caseNoClobber(mod) {
  const fx = fixtureDir();
  const a = startWriter({ mod, live: fx.liveDir, u: 0.1, at: NOW_S() - 100, stall: true });
  try {
    await a.stalled;
    await new Promise((res) => setTimeout(res, 700));
    const first = runWriter({ mod, live: fx.liveDir, u: 0.7, at: NOW_S() - 10, waitMs: 600, hardMaxMs: 300 });
    a.c.kill('SIGCONT');
    await a.exited;
    if (first.ok === true) assert.strictEqual(rowOf(fx), 0.7, 'B published while A slept; A\'s rename must not have overwritten it');
    const again = runWriter({ mod, live: fx.liveDir, u: 0.7, at: NOW_S() - 10, waitMs: 1500 });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(rowOf(fx), 0.7);
  } finally { a.c.kill('SIGKILL'); await a.exited; fx.cleanup(); }
}
// T: neither flock nor perl on PATH: fail closed, visibly, and write nothing.
async function caseNoTool(mod) {
  const fx = fixtureDir();
  const empty = fs.mkdtempSync(path.join(ROOT, 'path-'));
  try {
    const r = runWriter({ mod, live: fx.liveDir, u: 0.5, at: NOW_S() - 10, waitMs: 300 }, { PATH: empty });
    assert.deepStrictEqual(r, { ok: false, code: 'write_failed', reason: 'lock_helper' });
    assert.strictEqual(fs.existsSync(o.mirrorPath(fx.liveDir, 'claude', 'a')), false, 'nothing was written');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(o.mirrorPath(fx.liveDir, 'claude', 'a'))).filter((n) => /\.lock$/.test(n)), [], 'no lockfile fallback');
  } finally { fx.cleanup(); }
}

test('G40-BL0374 S: a live holder stalled past the (injected) hard cap keeps the lock; the competitor gets mirror_lock_busy', async () => {
  await caseStalled(REAL);
});
test('G40-BL0374 S negative control: on the old lockfile mechanism the same case is RED (the lock is taken from the live holder)', async () => {
  await assert.rejects(caseStalled(MUTANT()), (e) => e instanceof assert.AssertionError && /keeps the lock/.test(e.message), 'red for the right reason: B was not told busy');
});
test('G40-BL0374 C: a holder that wakes after a newer publish attempt never overwrites a newer publication', async () => {
  await caseNoClobber(REAL);
});
test('G40-BL0374 C negative control: on the old mechanism the woken holder overwrites the newer row (RED)', async () => {
  await assert.rejects(caseNoClobber(MUTANT()), (e) => e instanceof assert.AssertionError && /must not have overwritten/.test(e.message), 'red for the right reason: the newer row was lost');
});
test('G40-BL0374 T: no flock and no perl on PATH fails closed with write_failed/lock_helper and writes nothing', async () => {
  await caseNoTool(REAL);
});
test('G40-BL0374 T negative control: on the old mechanism a missing tool changes nothing and the write succeeds silently (RED)', async () => {
  await assert.rejects(caseNoTool(MUTANT()), (e) => e instanceof assert.AssertionError && /ok: true/.test(e.message), 'red for the right reason: the write went through');
});

test('G40-BL0374 K: kill -9 of a writer that holds the lock frees it at once; the next writer needs no wait', async () => {
  const fx = fixtureDir();
  const a = startWriter({ mod: REAL, live: fx.liveDir, u: 0.1, at: NOW_S() - 100, stall: true });
  try {
    await a.stalled;
    a.c.kill('SIGKILL');
    await a.exited;
    const t0 = Date.now();
    const b = runWriter({ mod: REAL, live: fx.liveDir, u: 0.6, at: NOW_S() - 10, waitMs: 300 });
    assert.strictEqual(b.ok, true, 'the helper saw EOF on its stdin and let go');
    assert.ok(Date.now() - t0 < 5000);
    assert.strictEqual(rowOf(fx), 0.6);
  } finally { a.c.kill('SIGKILL'); fx.cleanup(); }
});

function recAt(u, at) {
  return { schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L3', windows: [{ kind: 'rolling_5h', utilization: u, resets_at: at + 3600, source: 'passive', observed_at: at }], refusal: null, token_state: 'unknown', token_state_at: null, host_role: 'agent' };
}

test('G40-BL0374 stall before the lock: a writer that takes the lock late reads the newer row inside it and is superseded', () => {
  const fx = fixtureDir();
  try {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, recAt(0.1, NOW_S() - 10)).ok, true); // B, newer, published while A was not yet in the lock
    const late = runWriter({ mod: REAL, live: fx.liveDir, u: 0.2, at: NOW_S() - 500, waitMs: 500 }); // A, older, wakes up now
    assert.deepStrictEqual([late.ok, late.superseded], [true, true]);
    assert.strictEqual(rowOf(fx), 0.1);
  } finally { fx.cleanup(); }
});

test('G40-BL0374 H: a helper that dies under a live writer blocks the publish (mirror_lock_busy) and the file is untouched', (t) => {
  if (!fs.existsSync('/proc/self/task')) { t.skip('needs /proc to find the helper'); return; }
  const fx = fixtureDir();
  try {
    assert.strictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.3, at: NOW_S() - 100, waitMs: 500 }).ok, true);
    const before = fs.readFileSync(o.mirrorPath(fx.liveDir, 'claude', 'a'), 'utf8');
    const r = runWriter({ mod: REAL, live: fx.liveDir, u: 0.9, at: NOW_S() - 10, waitMs: 500, killHelper: true });
    assert.deepStrictEqual(r, { ok: false, code: 'mirror_lock_busy' });
    assert.strictEqual(fs.readFileSync(o.mirrorPath(fx.liveDir, 'claude', 'a'), 'utf8'), before);
  } finally { fx.cleanup(); }
});

test('G40-BL0374 release: the lock is free the moment writeLocalRow returns; a fixture holder is a real flock that blocks it', () => {
  const fx = fixtureDir();
  try {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, recAt(0.2, NOW_S() - 20)).ok, true);
    const lock = path.join(path.dirname(o.mirrorPath(fx.liveDir, 'claude', 'a')), 'a.oslock');
    const h = holdOsLock(lock);
    assert.deepStrictEqual(o.writeLocalRow(fx.liveDir, recAt(0.3, NOW_S() - 10), { waitMs: 100 }), { ok: false, code: 'mirror_lock_busy' });
    h.release();
    assert.strictEqual(o.writeLocalRow(fx.liveDir, recAt(0.3, NOW_S() - 10), { waitMs: 100 }).ok, true);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, recAt(0.4, NOW_S() - 5), { waitMs: 100 }).ok, true, 'the previous write let go');
  } finally { fx.cleanup(); }
});
