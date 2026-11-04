'use strict';
// G40 BL-0374: the per-alias mirror lock is an OS flock on a descriptor the writer itself keeps open (a short-lived flock/perl
// run takes the lock on it), so a LIVE writer that stalls for any length of time cannot have the lock taken away, and nothing
// else dying can free it. Red cases (each is run against the real module AND against a mutant):
//   S  a holder stalled past the old hard cap keeps the lock: a second writer gets mirror_lock_busy
//   C  the stalled holder, once it wakes, never overwrites a newer publication
//   T  no flock and no perl on PATH: write_failed / lock_helper, nothing written, no fallback to a lockfile
//   D  the stalled holder's helper process (if any) is killed: the lock is still held, B still gets mirror_lock_busy
//   F  a FIFO at the lock path fails inside the deadline instead of blocking the open
// Negative controls: a MUTANT is a copy of the current module with the OS-lock section replaced by an older mechanism:
//   legacy-lockfile-block.txt   the pre-BL-0374 lockfile with a reclaim rule (aa95f0ce3): S, C, T must be RED on it
//   helper-held-lock-block.txt  the first build, where a persistent helper child held the flock (97b7def2b): D must be RED on it
// and every case GREEN on the real module. Kept green-only cases: K (kill -9 frees the lock), H (a dead helper blocks the
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
const fixtureRoots = new Set();
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
      try { const c = fs.readFileSync(`/proc/${n}/cmdline`, 'latin1'); return c.includes(ROOT) || [...fixtureRoots].some((r) => c.includes(r)); } catch (_) { return false; }
    });
    for (let i = 0; i < 100 && left().length; i += 1) await new Promise((res) => setTimeout(res, 30));
    assert.deepStrictEqual(left(), [], 'no tool or holder process under the test root or a fixture dir is left');
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// The mutant: the current module with the OS-lock section swapped for the legacy lockfile block; relative requires made absolute.
function buildMutant(blockFile, name) {
  const src = fs.readFileSync(REAL, 'utf8');
  const start = src.indexOf('// --- per-alias lock:');
  const end = src.indexOf('// The view envelope keys a writer understands');
  assert.ok(start > 0 && end > start, 'the OS-lock section markers are present');
  assert.ok(!/\bholdsLock\(/.test(src.slice(0, start) + src.slice(end)), 'the module itself no longer asks "do I still hold it"');
  const legacy = fs.readFileSync(path.join(__dirname, 'account-fixtures', blockFile), 'utf8');
  let m = src.slice(0, start) + legacy + src.slice(end);
  m = m.replace(/require\('\.\//g, `require('${__dirname}/`);
  const file = path.join(ROOT, `account-observation.${name}.js`);
  fs.writeFileSync(file, m);
  return file;
}
let mutantFile = null;
const MUTANT = () => { if (!mutantFile) mutantFile = buildMutant('legacy-lockfile-block.txt', 'lockfile-mutant'); return mutantFile; };
let helperMutantFile = null;
const HELPER_MUTANT = () => { if (!helperMutantFile) helperMutantFile = buildMutant('helper-held-lock-block.txt', 'helper-mutant'); return helperMutantFile; };

const CODE = `const cfg = JSON.parse(process.argv[1]); const o = require(cfg.mod); const fs = require('fs');
  const rec = { schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L3', windows: [{ kind: 'rolling_5h', utilization: cfg.u, resets_at: cfg.at + 3600, source: 'passive', observed_at: cfg.at }], refusal: null, token_state: 'unknown', token_state_at: null, host_role: 'agent' };
  const hooks = {};
  if (cfg.stall) hooks.beforeRename = () => { fs.writeSync(1, 'stalled\\n'); process.kill(process.pid, 'SIGSTOP'); };
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
function fixtureDir() { const fx = makeFixture({ aliases: [{ alias: 'a' }] }); fixtureRoots.add(fx.root); return fx; }
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

// D: A stalls just before its rename; whatever child processes A has (a lock helper, in a design that keeps the lock there) are
// killed; B must still be told busy, and when A wakes its rename must not have lost B anything (B could not publish).
const childrenOf = (pid) => fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').split(' ').filter(Boolean).map(Number);
async function caseHelperKilled(mod) {
  const fx = fixtureDir();
  const a = startWriter({ mod, live: fx.liveDir, u: 0.1, at: NOW_S() - 100, stall: true });
  try {
    await a.stalled;
    for (const k of childrenOf(a.c.pid)) { try { process.kill(k, 'SIGKILL'); } catch (_) { /* gone */ } }
    await new Promise((res) => setTimeout(res, 300));
    const b = runWriter({ mod, live: fx.liveDir, u: 0.7, at: NOW_S() - 10, waitMs: 400 });
    assert.deepStrictEqual(b, { ok: false, code: 'mirror_lock_busy' }, 'killing a lock helper must not free the lock of a live writer');
    a.c.kill('SIGCONT');
    await a.exited;
    assert.strictEqual(rowOf(fx), 0.1, 'A published its own row; B never got in');
    const again = runWriter({ mod, live: fx.liveDir, u: 0.7, at: NOW_S() - 10, waitMs: 1500 });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(rowOf(fx), 0.7);
  } finally { a.c.kill('SIGCONT'); a.c.kill('SIGKILL'); await a.exited; fx.cleanup(); }
}
const HAS_PROC = fs.existsSync('/proc/self/task');
test('G40-BL0374 D: killing every child of the stalled writer (a helper, if there were one) leaves the lock held', { skip: !HAS_PROC && 'needs /proc' }, async () => {
  await caseHelperKilled(REAL);
});
test('G40-BL0374 D negative control: with the lock held only by a helper child (the first build) the same case is RED', { skip: !HAS_PROC && 'needs /proc' }, async () => {
  await assert.rejects(caseHelperKilled(HELPER_MUTANT()), (e) => e instanceof assert.AssertionError && /must not free the lock/.test(e.message), 'red for the right reason: B was let in');
});

// F: the lock path is a FIFO. An open that blocks would bypass every deadline; it must fail inside it, with a named reason.
function mkfifo(file) { const r = spawnSync('mkfifo', [file]); assert.strictEqual(r.status, 0, 'mkfifo'); }
test('G40-BL0374 F: a FIFO with no reader at the lock path ends in write_failed/lock_unreadable inside the deadline', { timeout: 30000 }, () => {
  const fx = fixtureDir();
  try {
    assert.strictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.2, at: NOW_S() - 50, waitMs: 300 }).ok, true);
    const lock = path.join(path.dirname(o.mirrorPath(fx.liveDir, 'claude', 'a')), 'a.oslock');
    fs.unlinkSync(lock);
    mkfifo(lock);
    const r = runWriter({ mod: REAL, live: fx.liveDir, u: 0.3, at: NOW_S() - 10, waitMs: 300 }); // runWriter's own 20 s timeout is the "does not hang" bound
    assert.deepStrictEqual(r, { ok: false, code: 'write_failed', reason: 'lock_unreadable:ENXIO' });
    assert.strictEqual(rowOf(fx), 0.2);
  } finally { fx.cleanup(); }
});
test('G40-BL0374 F: a FIFO that has a reader opens, is not a regular file, and is refused (ENOTREG), not locked', { timeout: 30000 }, async () => {
  const fx = fixtureDir();
  let reader = null;
  try {
    assert.strictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.2, at: NOW_S() - 50, waitMs: 300 }).ok, true);
    const lock = path.join(path.dirname(o.mirrorPath(fx.liveDir, 'claude', 'a')), 'a.oslock');
    fs.unlinkSync(lock);
    mkfifo(lock);
    reader = spawn('/bin/sh', ['-c', 'exec 3<>"$1"; exec sleep 600', 'sh', lock], { stdio: 'ignore' });
    kids.add(reader);
    await new Promise((res) => setTimeout(res, 300));
    const r = runWriter({ mod: REAL, live: fx.liveDir, u: 0.3, at: NOW_S() - 10, waitMs: 300 });
    assert.deepStrictEqual(r, { ok: false, code: 'write_failed', reason: 'lock_unreadable:ENOTREG' });
  } finally { if (reader) reader.kill('SIGKILL'); fx.cleanup(); }
});

// Tool lookup: only absolute PATH entries; flock first, perl second; a tool that errors falls through; neither: lock_helper.
function toolDir(files) {
  const d = fs.mkdtempSync(path.join(ROOT, 'tools-'));
  for (const [name, body] of Object.entries(files)) { fs.writeFileSync(path.join(d, name), body, { mode: 0o755 }); }
  return d;
}
test('G40-BL0374 tool lookup: an empty or relative PATH entry is never searched (a ./flock planted in the cwd is not run)', () => {
  const fx = fixtureDir();
  const cwd = toolDir({ flock: '#!/bin/sh\nexit 0\n', perl: '#!/bin/sh\nexit 0\n' }); // would "take the lock" if it were ever run
  try {
    for (const PATH of ['', '.', `:${path.basename(cwd)}`, `.:${path.basename(cwd)}`]) {
      const r = spawnSync(process.execPath, ['-e', CODE, JSON.stringify({ mod: REAL, live: fx.liveDir, u: 0.5, at: NOW_S() - 10, waitMs: 200 })], { encoding: 'utf8', cwd: path.dirname(cwd), env: { PATH }, timeout: 20000 });
      // cwd is the dir that CONTAINS the tool dir, so `<basename>` is a relative entry that would resolve to the planted tools
      assert.deepStrictEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { ok: false, code: 'write_failed', reason: 'lock_helper' }, `PATH=${JSON.stringify(PATH)}`);
    }
    assert.strictEqual(fs.existsSync(o.mirrorPath(fx.liveDir, 'claude', 'a')), false);
  } finally { fx.cleanup(); }
});
test('G40-BL0374 tool lookup: perl alone locks (ok / busy against a real holder); a tool that errors falls through; all erroring is lock_helper', () => {
  const real = require('./account-fixtures/os-lock-holder').findTool('perl');
  if (!real) return; // no perl on this host: nothing to exercise
  const fx = fixtureDir();
  try {
    const perlOnly = fs.mkdtempSync(path.join(ROOT, 'perl-'));
    fs.symlinkSync(real, path.join(perlOnly, 'perl'));
    const env = { PATH: perlOnly };
    assert.strictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.2, at: NOW_S() - 50, waitMs: 300 }, env).ok, true, 'perl fallback takes the lock');
    const lock = path.join(path.dirname(o.mirrorPath(fx.liveDir, 'claude', 'a')), 'a.oslock');
    const h = holdOsLock(lock);
    try {
      assert.deepStrictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.3, at: NOW_S() - 10, waitMs: 200 }, env), { ok: false, code: 'mirror_lock_busy' }, 'EWOULDBLOCK is busy, not an error');
    } finally { h.release(); }
    // a flock that errors (exit 3, neither 0 nor busy) must not be read as "busy": the next tool (real perl) is tried
    const broken = toolDir({ flock: '#!/bin/sh\nexit 3\n' });
    fs.symlinkSync(real, path.join(broken, 'perl'));
    assert.strictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.4, at: NOW_S() - 5, waitMs: 200 }, { PATH: broken }).ok, true, 'errored flock falls through to perl');
    // every tool erroring is visible, not busy
    const allBad = toolDir({ flock: '#!/bin/sh\nexit 3\n', perl: '#!/bin/sh\nexit 2\n' });
    assert.deepStrictEqual(runWriter({ mod: REAL, live: fx.liveDir, u: 0.6, at: NOW_S() - 2, waitMs: 200 }, { PATH: allBad }), { ok: false, code: 'write_failed', reason: 'lock_helper' });
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
