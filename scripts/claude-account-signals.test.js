#!/usr/bin/env node
'use strict';
// G37 orphan-process tests: a timeout or a signal must not leave a claude child running (and spending quota).
// (a) claude-account.js run/exec forwards TERM/INT and escalates to SIGKILL for a child that ignores SIGTERM;
// (b) the wrapper itself dying by SIGKILL (uutils `timeout -s KILL` signals only its direct child) takes the
//     child with it (setpriv --pdeathsig KILL); (c) dispatch-review.sh claude-native, account path vs legacy path.
// Tempdir only, FAKE- tokens, a Node fake claude that ignores SIGTERM. Only pids the fake recorded are killed.
// Both the uutils `timeout` on PATH and GNU timeout (/usr/bin/gnutimeout) are exercised; absent => skip.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { makeFixture } = require('./lib/account-fixtures/shim-install.js');
const { cli, EXIT, preflightExec } = require('./claude-account.js');
const { installReaper, track, guard } = require('./lib/test-reaper.js');

// Every child this file starts is bounded by a wall time and reaped on exit, failure, SIGINT/SIGTERM/SIGHUP
// (a hung child once outlived its test for days: an exec-looping shebang script, 89% CPU, ppid 1).
installReaper();
const CHILD_WALL_MS = 60000; // longest legitimate child here: ~10s of waits
const CLI_WALL_MS = 30000;

const SCRIPTS = __dirname;
const WRAPPER = path.join(SCRIPTS, 'claude-account.js');
const REVIEW = path.join(SCRIPTS, 'dispatch-review.sh');
const HAS_SETPRIV = process.platform === 'linux' && spawnSync('/usr/bin/setpriv', ['--pdeathsig', 'KILL', 'true'], { stdio: 'ignore', timeout: 10000, killSignal: 'SIGKILL' }).status === 0;
const TIMEOUTS = [['uutils-timeout', 'timeout']];
if (fs.existsSync('/usr/bin/gnutimeout')) TIMEOUTS.push(['gnu-timeout', '/usr/bin/gnutimeout']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) {
  try { process.kill(pid, 0); } catch (_) { return false; }
  try { return !/^\d+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch (_) { return false; }
}
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return fn();
}

/** A fake claude: records its pid and its ancestor chain, ignores SIGTERM/SIGINT, never exits by itself. */
function writeFakeClaude(dir, pidFile) {
  const f = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(f, [
    `#!${process.execPath}`,
    "const fs = require('fs');",
    "process.on('SIGTERM', () => {});",
    "process.on('SIGINT', () => {});",
    "const chain = [process.pid];",
    "let p = process.ppid;",
    `while (p > 1 && chain.length < 8 && p !== ${process.pid}) { chain.push(p); try { p = Number(fs.readFileSync('/proc/' + p + '/stat', 'utf8').replace(/^.*\\) \\S+ /, '').split(' ')[0]); } catch (_) { break; } }`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, chain.join(' '));`,
    "try { fs.readFileSync(0); } catch (_) {}",
    'setInterval(() => {}, 1000);',
  ].join('\n'), { mode: 0o755 });
  return f;
}

function world() {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const pidFile = path.join(fx.root, 'pids');
  const fake = writeFakeClaude(fx.root, pidFile);
  const recorded = () => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number) : []);
  const env = Object.assign({}, process.env, fx.env, { AUTOPILOT_SESSION_ID: '' });
  delete env.AUTOPILOT_SESSION_ID;
  const procs = [];
  const launch = (cmd, args, extraEnv) => {
    const p = spawn(cmd, args, { env: Object.assign({}, env, extraEnv || {}), stdio: ['ignore', 'ignore', 'ignore'] });
    procs.push(p);
    return track(p, CHILD_WALL_MS);
  };
  const cleanup = () => {
    // only pids this test recorded or spawned
    for (const pid of recorded()) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ } }
    for (const p of procs) { try { p.kill('SIGKILL'); } catch (_) { /* gone */ } }
    fx.cleanup();
  };
  return { fx, fake, env, recorded, launch, cleanup, pidFile };
}
const exited = (p) => new Promise((r) => { if (p.exitCode !== null || p.signalCode) r(); else p.on('exit', () => r()); });

test('a1: TERM to the wrapper (run) escalates to SIGKILL for a TERM-ignoring child, wrapper exits, child dead', async () => {
  const w = world();
  try {
    const p = w.launch(process.execPath, [WRAPPER, 'run', '--purpose', 'sig', '--', w.fake]);
    assert.ok(await waitFor(() => w.recorded().length > 0, 8000), 'fake claude started');
    const child = w.recorded()[0];
    p.kill('SIGTERM');
    assert.ok(await waitFor(() => !alive(child), 9000), 'child killed within TERM grace + slack');
    await Promise.race([exited(p), sleep(3000)]);
    assert.ok(p.exitCode !== null || p.signalCode, 'wrapper exited');
    // the child died by SIGKILL (128+9): never a clean 0, never an unreadable null
    assert.strictEqual(p.exitCode, 137, 'wrapper exit code is 128+signal');
    const audit = fs.readFileSync(w.fx.auditFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(audit.length > 0 && audit.every((l) => l.outcome === 'other_failure'), `audit outcome: ${JSON.stringify(audit.map((l) => l.outcome))}`);
  } finally { w.cleanup(); }
});

test('a2: TERM to the wrapper (exec) escalates to SIGKILL as well', async () => {
  const w = world();
  try {
    const p = w.launch(process.execPath, [WRAPPER, 'exec', '--alias', 'a', '--purpose', 'sig', '--', w.fake]);
    assert.ok(await waitFor(() => w.recorded().length > 0, 8000), 'fake claude started');
    const child = w.recorded()[0];
    p.kill('SIGTERM');
    assert.ok(await waitFor(() => !alive(child), 9000), 'child killed within TERM grace + slack');
  } finally { w.cleanup(); }
});

for (const [label, bin] of TIMEOUTS) {
  test(`a3 [${label}]: timeout -k 1 1 around the wrapper leaves no child`, async () => {
    const w = world();
    try {
      const p = w.launch(bin, ['-k', '1', '1', process.execPath, WRAPPER, 'run', '--purpose', 'sig', '--', w.fake]);
      assert.ok(await waitFor(() => w.recorded().length > 0, 8000), 'fake claude started');
      const child = w.recorded()[0];
      await Promise.race([exited(p), sleep(10000)]);
      assert.ok(await waitFor(() => !alive(child), 3000), 'child dead after timeout -k');
    } finally { w.cleanup(); }
  });

  test(`b [${label}]: timeout -s KILL kills the wrapper; the child must die with it`, { skip: HAS_SETPRIV ? false : 'no setpriv --pdeathsig on this platform (residual risk, see report)' }, async () => {
    const w = world();
    try {
      const p = w.launch(bin, ['-s', 'KILL', '1', process.execPath, WRAPPER, 'run', '--purpose', 'sig', '--', w.fake]);
      assert.ok(await waitFor(() => w.recorded().length > 0, 8000), 'fake claude started');
      const child = w.recorded()[0];
      await Promise.race([exited(p), sleep(10000)]);
      assert.ok(await waitFor(() => !alive(child), 3000), 'child dead after wrapper SIGKILL');
    } finally { w.cleanup(); }
  });
}

test('b0: the token never appears in the child argv (setpriv prefix carries no secret)', async () => {
  const w = world();
  try {
    const p = w.launch(process.execPath, [WRAPPER, 'run', '--purpose', 'sig', '--', w.fake]);
    assert.ok(await waitFor(() => w.recorded().length > 0, 8000), 'fake claude started');
    const child = w.recorded()[0];
    const cmdline = fs.readFileSync(`/proc/${child}/cmdline`, 'utf8');
    assert.ok(!cmdline.includes('FAKE-'), 'no token in argv');
    p.kill('SIGTERM');
  } finally { w.cleanup(); }
});

// ---- (c) dispatch-review.sh claude-native: account path vs legacy path, TERM to the script
function reviewWorld(mode) {
  const w = world();
  if (mode === 'legacy') fs.rmSync(w.fx.regFile);
  const cfg = path.join(w.fx.root, 'realcfg');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"FAKE-stub"}}');
  const diff = path.join(w.fx.root, 'd.diff');
  fs.writeFileSync(diff, 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n');
  const extra = { CLAUDE_CONFIG_DIR: cfg, AUTOPILOT_SETTLE_MS: '0', DISPATCH_QUIET: '1', AUTOPILOT_STRIKE_WRITER: 'off', ENGINE_CAPABILITY_DIR: path.join(w.fx.root, 'cap'), CALIBRATION_DATA_DIR: path.join(w.fx.root, 'cal') };
  const run = () => w.launch('bash', [REVIEW, '--runner', 'claude-native', '--model', 'claude-opus-5-5', '--diff-file', diff, '--bin', w.fake, '--timeout', '60s'], extra);
  return Object.assign(w, { run });
}
// Pre-existing (not a G37 regression): an untrapped TERM kills only the bash script, so the foreground
// `timeout ... claude` survives on the legacy path too. The account path must be no worse than legacy.
async function termReview(mode) {
  const w = reviewWorld(mode);
  try {
    const p = w.run();
    assert.ok(await waitFor(() => w.recorded().length > 0, 15000), `fake claude started (${mode})`);
    const chain = w.recorded();
    const child = chain[0];
    const viaWrapper = chain.some((pid) => {
      try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('claude-account.js'); } catch (_) { return false; }
    });
    p.kill('SIGTERM');
    await Promise.race([exited(p), sleep(5000)]);
    const dead = await waitFor(() => !alive(child), 3000);
    return { dead, viaWrapper };
  } finally { w.cleanup(); }
}
test('c: TERM to dispatch-review.sh - the account path leaves no more orphans than the legacy path', async () => {
  const legacy = await termReview('legacy');
  const account = await termReview('account');
  assert.strictEqual(legacy.viaWrapper, false, 'legacy path does not go through the wrapper');
  assert.strictEqual(account.viaWrapper, true, 'account path goes through the wrapper');
  assert.ok(account.dead || !legacy.dead, `account path regressed against legacy (legacy dead=${legacy.dead}, account dead=${account.dead})`);
});

// A child binary that does not exist or cannot be executed: with setpriv in front the shell-out would answer 127;
// it must map to the same exit code a direct ENOENT spawn error gets (EXIT.CHILD_ERROR), for run and for exec.
async function goCli(fx, args) {
  let err = '';
  const code = await guard(cli(args, { env: fx.env, realHome: fx.realHome, warn: () => {}, write: (fd, d) => { if (fd === 2) err += d.toString(); } }), CLI_WALL_MS);
  return { code, err };
}
test('d: missing or non-executable child binary maps to the spawn-failure exit code (run and exec)', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const noexec = path.join(fx.root, 'not-exec');
    fs.writeFileSync(noexec, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const missing = path.join(fx.root, 'no-such-binary');
    for (const [label, args, want] of [
      ['run missing', ['run', '--alias', 'a', '--purpose', 'sig', '--', missing], /child_spawn_failed \(ENOENT\)/],
      ['run bare name', ['run', '--alias', 'a', '--purpose', 'sig', '--', 'no-such-binary-xyz'], /child_spawn_failed \(ENOENT\)/],
      ['run not executable', ['run', '--alias', 'a', '--purpose', 'sig', '--', noexec], /child_spawn_failed \(EACCES\)/],
      ['exec missing', ['exec', '--alias', 'a', '--purpose', 'sig', '--', missing], /child_spawn_failed \(ENOENT\)/],
    ]) {
      const r = await goCli(fx, args);
      assert.strictEqual(r.code, EXIT.CHILD_ERROR, `${label}: ${r.err}`);
      assert.match(r.err, want, label);
    }
  } finally { fx.cleanup(); }
});

// Shebang interpreter missing: setpriv would still answer 127. Same mapping, run and exec. PATH-less env falls back
// to /bin:/usr/bin instead of searching only the cwd.
test('d2: script with a missing shebang interpreter, and a PATH-less env, map to the spawn-failure exit code', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const badInterp = path.join(fx.root, 'bad-interp');
    fs.writeFileSync(badInterp, '#!/no/such/interpreter\nexit 0\n', { mode: 0o755 });
    const badEnv = path.join(fx.root, 'bad-env');
    fs.writeFileSync(badEnv, '#!/usr/bin/env no-such-interp-xyz\nexit 0\n', { mode: 0o755 });
    for (const [label, args] of [
      ['run missing interp', ['run', '--alias', 'a', '--purpose', 'sig', '--', badInterp]],
      ['exec missing interp', ['exec', '--alias', 'a', '--purpose', 'sig', '--', badInterp]],
      ['run env interp not on PATH', ['run', '--alias', 'a', '--purpose', 'sig', '--', badEnv]],
      ['exec env interp not on PATH', ['exec', '--alias', 'a', '--purpose', 'sig', '--', badEnv]],
    ]) {
      const r = await goCli(fx, args);
      assert.strictEqual(r.code, EXIT.CHILD_ERROR, `${label}: ${r.err}`);
      assert.match(r.err, /child_spawn_failed \(ENOENT\)/, label);
    }
  } finally { fx.cleanup(); }
});

// Conservative shebang preflight: only a certain miss is rejected; env options, relative interpreters, CRLF and
// assignments go to the real exec (preflight returns null = "file exists and is executable, let exec decide").
test('d2b: shebang preflight rejects only certain misses; unusual forms are left to exec', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const mk = (name, first) => {
      const f = path.join(fx.root, name);
      fs.writeFileSync(f, `${first}\nexit 0\n`, { mode: 0o755 });
      return f;
    };
    const penv = { PATH: '/bin:/usr/bin' };
    const rows = [
      ['abs interp missing', '#!/no/such/interpreter', 'ENOENT'],
      ['env no option, target missing', '#!/usr/bin/env no-such-interp-xyz', 'ENOENT'],
      ['env no option, target present', '#!/usr/bin/env sh', null],
      ['env -S -u (arg is not the program)', '#!/usr/bin/env -S -u NODE_OPTIONS /bin/sh', null],
      ['env -u', '#!/usr/bin/env -u NODE_OPTIONS sh', null],
      ['env -C dir', '#!/usr/bin/env -C /no/such/dir sh', null],
      ['env -i', '#!/usr/bin/env -i no-such-interp-xyz', null],
      ['env -S then missing target', '#!/usr/bin/env -S no-such-interp-xyz', null],
      ['env target with =', '#!/usr/bin/env FOO=1', null],
      ['relative interpreter', '#!sh', null],
      ['relative interpreter, slash', '#!./no/such', null],
      ['CRLF shebang line', '#!/no/such/interp\r', null],
      ['unparseable', '#!', null],
    ];
    for (const [label, first, want] of rows) {
      assert.strictEqual(preflightExec(mk('p', first), penv, fx.root), want, label);
    }
    // a script that really starts through env -S must start under both verbs
    const ok = mk('env-s-ok', '#!/usr/bin/env -S -u NODE_OPTIONS /bin/sh');
    for (const verb of ['run', 'exec']) {
      const r = await goCli(fx, [verb, '--alias', 'a', '--purpose', 'sig', '--', ok]);
      assert.strictEqual(r.code, 0, `${verb} env -S must start: ${r.err}`);
    }
  } finally { fx.cleanup(); }
});

test('d3: child env without PATH resolves a bare name via /bin:/usr/bin, not only the cwd', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try {
    const env = Object.assign({}, fx.env);
    delete env.PATH;
    let err = '';
    const code = await guard(cli(['run', '--alias', 'a', '--purpose', 'sig', '--', 'true'], { env, realHome: fx.realHome, warn: () => {}, write: (fd, d) => { if (fd === 2) err += d.toString(); } }), CLI_WALL_MS);
    assert.ok(!/child_spawn_failed/.test(err), `bare name must be found on the default path: ${err}`);
    assert.notStrictEqual(code, EXIT.CHILD_ERROR, err);
  } finally { fx.cleanup(); }
});
