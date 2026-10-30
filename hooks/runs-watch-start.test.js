'use strict';
// runs-watch-start.test.js -- startWatcherDetached and the launch record (BL-0336 U1, review round 1, points 3, 6, 7):
//   * every failure of the PARENT process after the record directory exists is written to the launch result (flock missing, the log
//     cannot be opened, an explicit live dir refused), so the next hook and the band read the same reason;
//   * two sessions starting at once: the loser never overwrites the winner's record and is never reported as a failure.
// Each row has a negative control: a copy of the plugin with that one line broken must fail the same checks.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { copyPlugin, mutate } = require('./tests/lib/plugin-copy');

const REPO = path.resolve(__dirname, '..');
const KEY = '0123456789abcdef';

function sandbox() {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rws-')));
  fs.chmodSync(sb, 0o700);
  const home = path.join(sb, 'home');
  fs.mkdirSync(home);
  const live = fs.mkdtempSync(path.join('/dev/shm', 'rws-live-'));
  fs.chmodSync(live, 0o700);
  const bin = path.join(sb, 'bin');
  fs.mkdirSync(bin);
  return { sb, home, live, bin, ldir: path.join(home, '.autopilot', 'review', KEY, 'live') };
}
const drop = (w) => { fs.rmSync(w.sb, { recursive: true, force: true }); fs.rmSync(w.live, { recursive: true, force: true }); };
function link(w, names) {
  for (const n of names) {
    const r = spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' });
    const found = r.stdout.trim();
    const target = found.startsWith('/') ? found : `/usr/bin/${n}`; // `command -v true` prints the builtin's name
    if (found && fs.existsSync(target)) fs.symlinkSync(target, path.join(w.bin, n));
  }
}
const baseEnv = (w, extra = {}) => ({
  PATH: w.bin, HOME: w.home, CLAUDE_CONFIG_DIR: path.join(w.home, '.claude'), AUTOPILOT_LIVE_DIR: w.live, TMPDIR: w.sb,
  AUTOPILOT_RUNS_WATCH_AUTOSTART: '1', AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0', ...extra,
});

// calls startWatcherDetached in a child; prints the result and the launch report
const DRIVER = `
const root = process.argv[1];
const fakeBin = process.argv[2];
const barrier = process.argv[3];
const rw = require(root + '/src/status/runs-watch');
const wl = require(root + '/src/status/watcher-launch');
const path = require('path');
const fs = require('fs');
if (barrier) { const end = Date.now() + 5000; while (!fs.existsSync(barrier) && Date.now() < end) { /* spin to start together */ } }
const r = rw.startWatcherDetached({ key: '${KEY}', cwd: process.cwd(), env: process.env, binPath: fakeBin || undefined });
const dir = path.join(process.env.HOME, '.autopilot', 'review', '${KEY}', 'live');
process.stdout.write(JSON.stringify({ r, report: wl.readLaunchReport(dir), record: wl.readLaunch(dir) }));
process.exit(0);
`;
function drive(root, w, env, extraArgs = []) {
  const r = spawnSync(process.execPath, ['-e', DRIVER, root, ...extraArgs], { encoding: 'utf8', cwd: w.sb, env, timeout: 30000 });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function checkParentFailures(root) {
  // 1. no flock(1): a record with a failed result is left, naming flock
  let w = sandbox();
  link(w, ['node', 'sh', 'nohup']); // everything but flock
  let out = drive(root, w, baseEnv(w));
  assert.strictEqual(out.r.status, 'flock_unavailable');
  assert.ok(out.r.launch_id, 'a host without flock(1) still leaves a launch record');
  assert.strictEqual(out.report.state, 'failed');
  assert.match(out.report.reason, /flock/);
  drop(w);
  // 2. watcher.log cannot be opened: the failure is the launch's result, not an "exited without reporting"
  w = sandbox();
  link(w, ['node', 'sh', 'nohup', 'flock', 'true']);
  fs.mkdirSync(path.join(w.ldir, 'watcher.log'), { recursive: true, mode: 0o700 });
  out = drive(root, w, baseEnv(w));
  assert.strictEqual(out.r.status, 'error');
  assert.strictEqual(out.report.state, 'failed');
  assert.match(out.report.reason, /cannot open .*watcher\.log/);
  drop(w);
  // 3. an explicit AUTOPILOT_LIVE_DIR that is refused (a symlink): launch result carries the reason, and the status says so
  w = sandbox();
  link(w, ['node', 'sh', 'nohup', 'flock', 'true']);
  const linked = path.join(w.sb, 'live-link');
  fs.symlinkSync(w.live, linked);
  out = drive(root, w, baseEnv(w, { AUTOPILOT_LIVE_DIR: linked }));
  assert.strictEqual(out.r.status, 'live_dir_unusable');
  assert.ok(out.r.launch_id);
  assert.strictEqual(out.report.state, 'failed');
  assert.match(out.report.reason, /symlink/);
  drop(w);
}

const FAKE_BIN = `
// stands in for bin/autopilot.js: reports ok under the launch id and holds the project lock (inherited fd 9) for a while
const wl = require(process.env.WL);
wl.writeResult(process.env.AUTOPILOT_WATCHER_RESULT_PATH, process.env.AUTOPILOT_WATCHER_LAUNCH_ID, true, null);
setTimeout(() => {}, 4000);
`;

async function checkConcurrent(root) {
  for (let round = 0; round < 4; round += 1) {
    const w = sandbox();
    link(w, ['node', 'sh', 'nohup', 'flock', 'true']);
    const fake = path.join(w.sb, 'fake-bin.js');
    fs.writeFileSync(fake, FAKE_BIN);
    const barrier = path.join(w.sb, 'go');
    const env = baseEnv(w, { WL: path.join(root, 'src/status/watcher-launch.js') });
    const runs = [0, 1].map(() => new Promise((resolve) => {
      const p = spawn(process.execPath, ['-e', DRIVER, root, fake, barrier], { cwd: w.sb, env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', () => resolve(JSON.parse(out)));
    }));
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(barrier, '');
    const results = await Promise.all(runs);
    const started = results.filter((x) => x.r.status === 'started');
    assert.strictEqual(started.length, 1, `round ${round}: exactly one start, got ${JSON.stringify(results.map((x) => x.r.status))}`);
    const loser = results.find((x) => x.r.status !== 'started');
    assert.strictEqual(loser.r.status, 'busy', `round ${round}: the loser is busy, not a failure (${JSON.stringify(loser.r)})`);
    // give the fake child time to report, then read the record from outside
    await new Promise((r) => setTimeout(r, 1200));
    const wl = require(path.join(root, 'src/status/watcher-launch.js'));
    const rec = wl.readLaunch(w.ldir);
    assert.strictEqual(rec.launch_id, started[0].r.launch_id, `round ${round}: the record is the winner's, not overwritten by the loser`);
    assert.strictEqual(wl.readLaunchReport(w.ldir).state, 'ok', `round ${round}: the winner's launch reads ok`);
    try { for (const f of fs.readdirSync(path.join(w.live, 'runs'))) void f; } catch (_e) { /* none */ }
    await new Promise((r) => setTimeout(r, 3200)); // let the fake watcher exit before its sandbox goes
    drop(w);
  }
}

test('parent-side failures (no flock, log cannot be opened, live dir refused) are written to the launch result', () => checkParentFailures(REPO));

test('two sessions starting at once: one start, the loser is busy and does not overwrite the record', { timeout: 120000 }, () => checkConcurrent(REPO));

test('negative controls: each broken copy fails its row', { timeout: 240000 }, async () => {
  const cases = [
    ['flock failure returns before any record', 'src/status/runs-watch.js', "if (probe.error) return failed('flock_unavailable', `flock(1) cannot be run: ${probe.error.message}`);", "if (probe.error) return { status: 'flock_unavailable', message: probe.error.message };", 'parent'],
    ['log open failure leaves no result', 'src/status/runs-watch.js', 'const reason = `cannot open ${logFile}: ${error.message}`;\n      launchProto.writeResult(launch.result_path, launch.launch_id, false, reason);', 'const reason = `cannot open ${logFile}: ${error.message}`;', 'parent'],
    ['live dir refusal leaves no record', 'src/status/runs-watch.js', "return failed('live_dir_unusable', error.message);", "return { status: 'live_dir_unusable', message: error.message };", 'parent'],
    ['no start lock and no pending check', 'src/status/runs-watch.js', "if (!release) return { status: 'busy', holder: holderFromEnvelope(env, key), launching: true };", '', 'concurrent', "if (launchProto.readLaunchReport(launchDirPath).state === 'pending') return { status: 'busy', holder: holderFromEnvelope(env, key), launching: true };"],
  ];
  for (const [name, rel, from, to, kind, extra] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-copy-'));
    copyPlugin(REPO, root);
    mutate(root, rel, from, to);
    if (extra) mutate(root, rel, extra, '');
    let caught = false;
    try {
      if (kind === 'parent') checkParentFailures(root); else await checkConcurrent(root);
    } catch (e) { caught = e instanceof assert.AssertionError; }
    assert.ok(caught, `negative control "${name}" was not caught`);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
