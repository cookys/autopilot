'use strict';
// runs-watch-launch.test.js -- the launch record protocol of src/status/watcher-launch.js (BL-0336 U1, plan F2/F6 rows:
// "launch id", "exit without reporting", "reported once"). Every row has a negative control: the same checks run against a
// copy of the module with ONE line broken and must fail (the broken copy is single-file: the module has no local requires).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'src/status/watcher-launch.js');

function load(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
}
function mutated(from, to) {
  const dir = tmp();
  const file = path.join(dir, 'watcher-launch.js');
  const text = fs.readFileSync(SRC, 'utf8');
  const out = text.replace(from, () => to);
  assert.notStrictEqual(out, text, 'mutation no longer matches watcher-launch.js');
  fs.writeFileSync(file, out);
  return file;
}
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

// ---- the checks, parameterised by the module under test ----
const checks = {
  launchId(wl) {
    const dir = tmp();
    // an OLD launch failed with a different reason, left its result file and a log whose last line says so
    const old = wl.beginLaunch(dir);
    wl.writeResult(old.result_path, old.launch_id, false, 'old reason');
    fs.writeFileSync(path.join(dir, 'watcher.log'), 'watcher startup failed: old reason\n');
    // the CURRENT launch fails for a new reason
    const cur = wl.beginLaunch(dir);
    wl.recordPid(dir, cur.record, process.pid);
    wl.writeResult(cur.result_path, cur.launch_id, false, 'new reason');
    const r = wl.readLaunchReport(dir);
    assert.strictEqual(r.state, 'failed');
    assert.strictEqual(r.reason, 'new reason', 'the report is about THIS launch id, not the log or an older result');
    assert.ok(!fs.existsSync(old.result_path), 'a new launch removes the older result files');
  },
  launchIdPending(wl) {
    const dir = tmp();
    const old = wl.beginLaunch(dir);
    wl.writeResult(old.result_path, old.launch_id, false, 'old reason');
    fs.writeFileSync(path.join(dir, 'watcher.log'), 'watcher startup failed: old reason\n');
    const cur = wl.beginLaunch(dir);
    wl.recordPid(dir, cur.record, process.pid); // alive, has not reported yet
    const r = wl.readLaunchReport(dir);
    assert.strictEqual(r.state, 'pending', 'an old failure must not be reported for a launch that is still starting');
  },
  exitWithoutReport(wl) {
    const dir = tmp();
    const cur = wl.beginLaunch(dir);
    wl.recordPid(dir, cur.record, deadPid());
    const r = wl.readLaunchReport(dir);
    assert.strictEqual(r.state, 'failed');
    assert.strictEqual(r.reason, wl.NO_REPORT_REASON);
    // alive launcher, no result: no verdict
    const dir2 = tmp();
    const cur2 = wl.beginLaunch(dir2);
    wl.recordPid(dir2, cur2.record, process.pid);
    assert.strictEqual(wl.readLaunchReport(dir2).state, 'pending');
    // a recycled pid (same number, different start time) counts as gone
    const dir3 = tmp();
    const cur3 = wl.beginLaunch(dir3);
    wl.recordPid(dir3, cur3.record, process.pid);
    const rec = JSON.parse(fs.readFileSync(path.join(dir3, wl.LAUNCH_FILE), 'utf8'));
    rec.pid_start = (rec.pid_start || 0) + 12345;
    fs.writeFileSync(path.join(dir3, wl.LAUNCH_FILE), JSON.stringify(rec));
    assert.strictEqual(wl.readLaunchReport(dir3).state, 'failed');
  },
  reportedOnce(wl) {
    const dir = tmp();
    const cur = wl.beginLaunch(dir);
    wl.recordPid(dir, cur.record, process.pid);
    assert.strictEqual(wl.claimReport(dir, 's1', 'r'), true, 'first time for this session');
    assert.strictEqual(wl.claimReport(dir, 's1', 'r'), false, 'second time for the same session and reason');
    assert.strictEqual(wl.claimReport(dir, 's2', 'r'), true, 'another session is told');
    assert.strictEqual(wl.claimReport(dir, 's1', 'other reason'), true, 'a different reason is new');
    assert.strictEqual(wl.claimReport(dir, 's1', 'r'), false, 'A -> B -> A: the first reason is not told again');
    assert.strictEqual(wl.claimReport(dir, 's2', 'r'), false);
    // a new launch keeps who was told about which reason (a failing watcher retried on every prompt must not nag)
    wl.beginLaunch(dir);
    assert.strictEqual(wl.claimReport(dir, 's1', 'other reason'), false);
    assert.strictEqual(wl.claimReport(dir, 's1', 'r'), false);
  },
  reportedCap(wl) {
    const dir = tmp();
    wl.beginLaunch(dir);
    for (let i = 0; i < 80; i += 1) wl.claimReport(dir, `s${i}`, 'r');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, wl.LAUNCH_FILE), 'utf8'));
    assert.ok(rec.reported.r.length <= 50);
  },
  spawnFailureResult(wl) {
    const dir = tmp();
    const cur = wl.beginLaunch(dir);
    wl.writeResult(cur.result_path, cur.launch_id, false, 'the watcher process could not be spawned: boom');
    wl.recordPid(dir, cur.record, null);
    const r = wl.readLaunchReport(dir);
    assert.strictEqual(r.state, 'failed');
    assert.match(r.reason, /could not be spawned/);
  },
  okResult(wl) {
    const dir = tmp();
    const cur = wl.beginLaunch(dir);
    wl.recordPid(dir, cur.record, process.pid);
    wl.writeResult(cur.result_path, cur.launch_id, true, null);
    assert.strictEqual(wl.readLaunchReport(dir).state, 'ok');
  },
};

checks.claimConcurrent = (wl, file) => {
  // 12 processes tell 12 different sessions the same reason at once: none may be lost (read-modify-write under a lock)
  const dir = tmp();
  wl.beginLaunch(dir);
  const code = `const wl = require(${JSON.stringify(file)}); const ok = wl.claimReport(process.argv[1], process.argv[2], 'r'); process.stdout.write(String(ok));`;
  const procs = [];
  for (let i = 0; i < 12; i += 1) procs.push(require('child_process').spawn(process.execPath, ['-e', code, dir, `sess-${i}`], { stdio: ['ignore', 'pipe', 'inherit'] }));
  return Promise.all(procs.map((p) => new Promise((res) => p.on('close', res)))).then(() => {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, wl.LAUNCH_FILE), 'utf8'));
    assert.strictEqual(rec.reported.r.length, 12, `sessions lost: ${JSON.stringify(rec.reported.r)}`);
  });
};

checks.claimLockHeld = (wl) => {
  // another process holds the record's lock (fresh mtime): the claim neither reads nor writes the record, and still tells the user
  const dir = tmp();
  wl.beginLaunch(dir);
  const file = path.join(dir, wl.LAUNCH_FILE);
  fs.writeFileSync(`${file}.lock`, '');
  const before = fs.readFileSync(file);
  const r = wl.claimReport(dir, 'sess-x', 'some reason');
  assert.strictEqual(r, true, 'a claim that cannot get the lock still tells the user');
  assert.ok(before.equals(fs.readFileSync(file)), 'a claim without the lock must not rewrite the record');
};
checks.beginLaunchOrder = (wl) => {
  // the old launch's result file must still be there for as long as the record still names the old launch
  const dir = tmp();
  const old = wl.beginLaunch(dir);
  wl.writeResult(old.result_path, old.launch_id, true, null);
  wl.recordPid(dir, old.record, deadPid());
  assert.strictEqual(wl.readLaunchReport(dir).state, 'ok');
  const real = fs.unlinkSync;
  const seen = [];
  fs.unlinkSync = function patched(f, ...rest) {
    const out = real.call(this, f, ...rest);
    if (path.basename(String(f)).startsWith(wl.RESULT_PREFIX)) seen.push(wl.readLaunchReport(dir));
    return out;
  };
  try { wl.beginLaunch(dir); } finally { fs.unlinkSync = real; }
  assert.ok(seen.length >= 1, 'the old result file was removed');
  for (const r of seen) assert.notStrictEqual(r.reason, wl.NO_REPORT_REASON, `a reader between the two steps saw ${JSON.stringify(r.state)}/exited-without-reporting`);
};
checks.pidGap = (wl) => {
  // the parent has not written the pid yet: no verdict; the same record 5 minutes later (the parent died there) is a failure
  const dir = tmp();
  const cur = wl.beginLaunch(dir);
  assert.strictEqual(wl.readLaunchReport(dir).state, 'pending', 'pid not written yet: pending');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, wl.LAUNCH_FILE), 'utf8'));
  rec.started_at = new Date(Date.now() - 300000).toISOString();
  fs.writeFileSync(path.join(dir, wl.LAUNCH_FILE), JSON.stringify(rec));
  assert.strictEqual(wl.readLaunchReport(dir).state, 'failed');
  assert.ok(cur);
};

const REAL = load(SRC);
test('launch id: the report is about this launch, never an older result or the log', () => { checks.launchId(REAL); checks.launchIdPending(REAL); });
test('exit without reporting: a dead launcher (or a recycled pid) is a failure, a live one is undecided', () => checks.exitWithoutReport(REAL));
test('reported once: a session hears a reason once; others and new reasons are told', () => { checks.reportedOnce(REAL); checks.reportedCap(REAL); });
test('reported once, in parallel: no session is lost to a concurrent read-modify-write', () => checks.claimConcurrent(REAL, SRC));
test('a claim that cannot get the record lock leaves the record untouched and still tells', () => checks.claimLockHeld(REAL));
test('beginLaunch writes the new record before it removes older results (no reader sees a false exit-without-report)', () => checks.beginLaunchOrder(REAL));
test('a launch whose pid is not written yet is undecided (and a failure once the parent is long gone)', () => checks.pidGap(REAL));
test('a spawn that failed in the parent leaves a failed result; an ok result reads ok', () => { checks.spawnFailureResult(REAL); checks.okResult(REAL); });

// ---- negative controls: each broken copy must fail its row ----
const NEG = [
  { name: 'read the log last line instead of the launch id result', row: 'launchId',
    from: /function readLaunchReport\(dir\) \{[\s\S]*?\n\}\n/,
    to: `function readLaunchReport(dir) {
  const rec = readLaunch(dir);
  if (!rec) return { state: 'none' };
  let last = '';
  try { last = fs.readFileSync(path.join(dir, 'watcher.log'), 'utf8').trim().split('\\n').pop(); } catch (_e) { /* none */ }
  const m = /^watcher startup failed: (.*)$/.exec(last);
  if (m) return { state: 'failed', reason: m[1], launch: rec };
  return { state: 'pending', launch: rec };
}\n` },
  { name: 'no pid liveness judgement', row: 'exitWithoutReport', from: 'if (launcherAlive(rec)) return', to: 'if (true) return' },
  { name: 'no reported memory', row: 'reportedOnce', from: 'if (sessionId && list.includes(sessionId)) return false;', to: '' },
  { name: 'one reason slot (a new reason resets the sessions)', row: 'reportedOnce', from: 'const list = Array.isArray(reported[reason]) ? reported[reason] : [];', to: 'const list = Array.isArray(reported[reason]) ? reported[reason] : []; for (const k of Object.keys(reported)) if (k !== reason) delete reported[k];' },
  { name: 'claim writes without the lock', row: 'claimLockHeld', from: '  if (!release) return true;\n  try {\n    let obj = readJson(file);', to: '  try {\n    let obj = readJson(file);' },
  { name: 'pid-less launch judged at once', row: 'pidGap', from: 'if (Number.isFinite(age) && age < PID_GAP_MS) return', to: 'if (false) return' },
];
for (const c of NEG) {
  test(`negative control: ${c.name} turns the "${c.row}" row red`, () => {
    const wl = load(mutated(c.from, c.to));
    assert.throws(() => (c.row === 'launchId' ? (checks.launchId(wl), checks.launchIdPending(wl)) : checks[c.row](wl)), assert.AssertionError);
  });
}

test('negative control: an unlocked read-modify-write loses sessions in parallel', async () => {
  const file = mutated('const release = lockFile(`${file}.lock`, 1000);\n  if (!release) return true;\n  try {\n    let obj = readJson(file);', 'const release = null;\n  try {\n    let obj = readJson(file);');
  const wl = load(file);
  // The lost update is a race, so one round may not hit it: the broken copy must lose a session within a few rounds.
  let caught = false;
  for (let round = 0; round < 8 && !caught; round += 1) {
    try { await checks.claimConcurrent(wl, file); } catch (e) { caught = e instanceof assert.AssertionError; }
  }
  assert.ok(caught, 'the unlocked read-modify-write was never seen to lose a session in 8 rounds');
});
