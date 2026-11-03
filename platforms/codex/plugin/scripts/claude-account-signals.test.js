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

const SCRIPTS = __dirname;
const WRAPPER = path.join(SCRIPTS, 'claude-account.js');
const REVIEW = path.join(SCRIPTS, 'dispatch-review.sh');
const HAS_SETPRIV = process.platform === 'linux' && spawnSync('/usr/bin/setpriv', ['--pdeathsig', 'KILL', 'true'], { stdio: 'ignore' }).status === 0;
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
    return p;
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
