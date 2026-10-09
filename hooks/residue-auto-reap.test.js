// residue-auto-reap (SessionStart hook, residue auto-reap R3): knobs, skips, throttle + flock, spawn argv, advisory.
// Real hook process against a fixture repo and a STUB sweep script (the real sweep is not run here; hand A owns it).
// HOME, AUTOPILOT_LIVE_DIR and the stub sweep all live under a mktemp dir: nothing touches the real ~/.autopilot.
// Run: node --test hooks/residue-auto-reap.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HOOK = path.join(__dirname, 'residue-auto-reap.js');
const LIB = require('./residue-auto-reap-lib.js');

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

// Stub sweep: records its argv (one JSON line per call) and writes a valid autopilot.residue-auto/1 result.
function stubSweep(dir, { needs = 2, bytes = 5 * 1048576, staleRanAt = false } = {}) {
  const file = path.join(dir, 'stub-sweep.js');
  fs.writeFileSync(file, `'use strict';
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
fs.appendFileSync(${JSON.stringify(path.join(dir, 'argv.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
const repo = process.argv[process.argv.indexOf('--repo') + 1];
const common = path.resolve(repo, cp.execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
fs.writeFileSync(path.join(common, 'autopilot-residue-auto.json'), JSON.stringify({
  schema: 'autopilot.residue-auto/1', ran_at: ${staleRanAt ? "'2020-01-01T00:00:00.000Z'" : 'new Date().toISOString()'},
  removed: [], archived: [], needs_human: [], needs_human_count: ${needs}, needs_human_bytes: ${bytes},
}));
`);
  return file;
}

function fixture(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rar-'));
  const home = path.join(root, 'home');
  const live = path.join(root, 'live');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  fs.mkdirSync(repo);
  sh('git', ['init', '-q', '-b', 'main'], repo);
  sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], repo);
  if (opts.config) fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify(opts.config));
  const sweep = stubSweep(root, opts.sweep);
  const env = {
    PATH: process.env.PATH, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RESIDUE_AUTO_SWEEP: sweep, ...(opts.env || {}),
  };
  return { root, home, live, repo, sweep, env, common: path.join(repo, '.git'), argvLog: path.join(root, 'argv.log') };
}

function runHook(fx, payload, cwd) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', env: fx.env, cwd: cwd || fx.repo,
  });
  return { ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function calls(fx) {
  try { return fs.readFileSync(fx.argvLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_e) { return []; }
}

function waitFor(pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return pred();
}

function advisories(fx, sid) {
  try {
    return fs.readFileSync(path.join(fx.live, 'advisories', `${sid}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (_e) { return []; }
}

const SID = 'sess-1';

test('disabled(): default on; env and config knobs switch it off', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rar-home-'));
  assert.strictEqual(LIB.disabled({}, {}, home), false);
  assert.strictEqual(LIB.disabled({ AUTOPILOT_HOOK_RESIDUE_AUTO_REAP: '0' }, {}, home), true);
  assert.strictEqual(LIB.disabled({ AUTOPILOT_HOOK_RESIDUE_AUTO_REAP: 'false' }, {}, home), true);
  assert.strictEqual(LIB.disabled({ AUTOPILOT_HOOK_RESIDUE_AUTO_REAP: '1' }, {}, home), false);
  assert.strictEqual(LIB.disabled({ AUTOPILOT_RESIDUE_AUTO_REAP: '0' }, {}, home), true);
  assert.strictEqual(LIB.disabled({}, { hooks: { 'residue-auto-reap': false } }, home), true);
  assert.strictEqual(LIB.disabled({}, { hooks: { 'residue-auto-reap': true } }, home), false);
  assert.strictEqual(LIB.disabled({}, { hooks: { 'residue-auto-reap': 'garbage' } }, home), false);
});

test('disabled(): residue.auto_reap goes through scripts/lib/residue-config.js (same chain and env as the sweep)', () => {
  const cfgHome = (residue) => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'rar-home-'));
    fs.mkdirSync(path.join(h, '.autopilot'));
    fs.writeFileSync(path.join(h, '.autopilot', 'config.json'), JSON.stringify({ residue }));
    return h;
  };
  const off = cfgHome({ auto_reap: false });
  const on = cfgHome({ auto_reap: true, lease_hours: 72 });
  assert.strictEqual(LIB.disabled({}, {}, off), true, 'user config residue.auto_reap=false');
  assert.strictEqual(LIB.disabled({}, {}, on), false);
  assert.strictEqual(LIB.disabled({ AUTOPILOT_RESIDUE_AUTO_REAP: '1' }, {}, off), false, 'env =1 beats the user config tier, as in the sweep');
  assert.strictEqual(LIB.disabled({ AUTOPILOT_RESIDUE_AUTO_REAP: '0' }, {}, on), true, 'env =0 beats the user config tier');
  // the hook decides exactly what the sweep's resolver decides
  const { loadResidueConfig } = require('../scripts/lib/residue-config.js');
  for (const [env, h] of [[{}, off], [{}, on], [{ AUTOPILOT_RESIDUE_AUTO_REAP: '1' }, off], [{ AUTOPILOT_RESIDUE_AUTO_REAP: '0' }, on]]) {
    assert.strictEqual(LIB.disabled(env, {}, h), !loadResidueConfig({ env, home: h }).auto_reap);
  }
  // 'off' was accepted by the old private reader but is not part of the shared chain: the sweep would still run
  assert.strictEqual(LIB.disabled({ AUTOPILOT_RESIDUE_AUTO_REAP: 'off' }, {}, on), false);
});

test('fires: spawns the sweep detached with the contract argv, writes the stamp, advisory after the sweep', () => {
  const fx = fixture();
  const r = runHook(fx, { hook_event_name: 'SessionStart', session_id: SID, cwd: fx.repo });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '', 'the hook injects no context');
  assert.ok(waitFor(() => advisories(fx, SID).length === 1), 'advisory appended after the sweep ended');
  const c = calls(fx);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0], ['reap', '--auto', '--yes', '--repo', fs.realpathSync(fx.repo)]);
  assert.ok(fs.existsSync(path.join(fx.common, 'autopilot-residue-auto.stamp')), 'stamp exists');
  const [adv] = advisories(fx, SID);
  assert.strictEqual(adv.kind, 'residue');
  assert.match(adv.text, /2 worktree\/branch leftovers need you, 5 MB/);
  assert.match(adv.text, /Hygiene tab/);
});

test('the hook returns fast (it never waits for the sweep)', () => {
  const fx = fixture();
  const slow = path.join(fx.root, 'slow-sweep.js');
  fs.writeFileSync(slow, "'use strict';\nsetTimeout(() => {}, 4000);\n");
  fx.env.AUTOPILOT_RESIDUE_AUTO_SWEEP = slow;
  const r = runHook(fx, { hook_event_name: 'SessionStart', session_id: SID, cwd: fx.repo });
  assert.ok(r.ms < 1500, `hook took ${r.ms} ms while the sweep sleeps 4 s`);
});

test('throttle: a second session within 24 h does not run again; a 25 h-old stamp runs again', () => {
  const fx = fixture({ sweep: { needs: 0 } });
  runHook(fx, { session_id: SID, cwd: fx.repo });
  assert.ok(waitFor(() => calls(fx).length === 1));
  assert.ok(waitFor(() => fs.existsSync(path.join(fx.common, 'autopilot-residue-auto.json'))));
  runHook(fx, { session_id: 'sess-2', cwd: fx.repo });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  assert.strictEqual(calls(fx).length, 1, 'second session within 24 h: no second sweep');
  const stamp = path.join(fx.common, 'autopilot-residue-auto.stamp');
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(stamp, old, old);
  runHook(fx, { session_id: 'sess-3', cwd: fx.repo });
  assert.ok(waitFor(() => calls(fx).length === 2), 'stamp older than 24 h: runs again');
});

test('zero needs_human_count writes no advisory; a result file older than the run is ignored', () => {
  const none = fixture({ sweep: { needs: 0 } });
  runHook(none, { session_id: SID, cwd: none.repo });
  assert.ok(waitFor(() => calls(none).length === 1));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  assert.deepStrictEqual(advisories(none, SID), []);

  const stale = fixture({ sweep: { needs: 3, staleRanAt: true } });
  runHook(stale, { session_id: SID, cwd: stale.repo });
  assert.ok(waitFor(() => calls(stale).length === 1));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  assert.deepStrictEqual(advisories(stale, SID), [], 'stale result is not this run');
});

test('flock: while another runner holds the lock no second sweep starts', () => {
  const fx = fixture();
  const holder = spawn('flock', [path.join(fx.common, 'autopilot-residue-auto.lock'), 'sleep', '3'], { stdio: 'ignore' });
  try {
    assert.ok(waitFor(() => fs.existsSync(path.join(fx.common, 'autopilot-residue-auto.lock'))));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    runHook(fx, { session_id: SID, cwd: fx.repo });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
    assert.strictEqual(calls(fx).length, 0, 'lock busy: flock -n exits, the sweep never starts');
    assert.ok(!fs.existsSync(path.join(fx.common, 'autopilot-residue-auto.stamp')), 'and no stamp is taken');
  } finally {
    holder.kill('SIGKILL');
  }
});

test('skips: knobs, not a repo, inside a dispatch worktree', () => {
  const skipped = (fx, cwd) => {
    runHook(fx, { session_id: SID, cwd }, cwd);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
    return calls(fx).length === 0 && !fs.existsSync(path.join(fx.common, 'autopilot-residue-auto.stamp'));
  };
  let fx = fixture({ env: { AUTOPILOT_HOOK_RESIDUE_AUTO_REAP: '0' } });
  assert.ok(skipped(fx, fx.repo), 'env knob');
  fx = fixture({ config: { hooks: { 'residue-auto-reap': false } } });
  assert.ok(skipped(fx, fx.repo), 'hooks config knob');
  fx = fixture({ config: { residue: { auto_reap: false } } });
  assert.ok(skipped(fx, fx.repo), 'residue.auto_reap=false');

  fx = fixture();
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'rar-nogit-'));
  runHook(fx, { session_id: SID, cwd: plain }, plain);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  assert.strictEqual(calls(fx).length, 0, 'not a git repo');

  fx = fixture();
  const wt = path.join(fx.root, 'dispatch-wt');
  sh('git', ['worktree', 'add', '-q', '-b', 'hands/x', wt], fx.repo);
  fs.writeFileSync(path.join(wt, '.autopilot-worktree'), JSON.stringify({ schema: 2 }));
  const sub = path.join(wt, 'sub');
  fs.mkdirSync(sub);
  assert.ok(skipped(fx, sub), 'cwd inside a dispatch worktree (subdirectory)');
});

test('from a linked, marker-less worktree the sweep is pointed at the main worktree', () => {
  const fx = fixture({ sweep: { needs: 0 } });
  const wt = path.join(fx.root, 'linked');
  sh('git', ['worktree', 'add', '-q', '-b', 'feature/y', wt], fx.repo);
  runHook(fx, { session_id: SID, cwd: wt }, wt);
  assert.ok(waitFor(() => calls(fx).length === 1));
  assert.strictEqual(calls(fx)[0][4], fs.realpathSync(fx.repo));
});

test('without a session id the sweep still runs and no advisory is written', () => {
  const fx = fixture();
  runHook(fx, { cwd: fx.repo });
  assert.ok(waitFor(() => calls(fx).length === 1));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  assert.ok(!fs.existsSync(path.join(fx.live, 'advisories')) || fs.readdirSync(path.join(fx.live, 'advisories')).length === 0);
});

test('wiring: hooks.json names the hook under SessionStart, hook-classes lists it', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'));
  const cmds = hooks.hooks.SessionStart.flatMap((b) => b.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => /hooks\/residue-auto-reap\.js$/.test(c)));
  const block = hooks.hooks.SessionStart.find((b) => b.hooks.some((h) => /residue-auto-reap/.test(h.command)));
  assert.strictEqual(block.matcher, 'startup|resume|clear|compact');
  const classes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'profiles', 'hook-classes.json'), 'utf8'));
  assert.ok(classes.hooks.some((h) => h.stem === 'residue-auto-reap'));
});
