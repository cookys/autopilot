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
    // a new launch keeps who was told about the same reason (a failing watcher retried on every prompt must not nag)
    wl.beginLaunch(dir);
    assert.strictEqual(wl.claimReport(dir, 's1', 'other reason'), false);
  },
  reportedCap(wl) {
    const dir = tmp();
    wl.beginLaunch(dir);
    for (let i = 0; i < 80; i += 1) wl.claimReport(dir, `s${i}`, 'r');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, wl.LAUNCH_FILE), 'utf8'));
    assert.ok(rec.reported_sessions.length <= 50);
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

const REAL = load(SRC);
test('launch id: the report is about this launch, never an older result or the log', () => { checks.launchId(REAL); checks.launchIdPending(REAL); });
test('exit without reporting: a dead launcher (or a recycled pid) is a failure, a live one is undecided', () => checks.exitWithoutReport(REAL));
test('reported once: a session hears a reason once; others and new reasons are told', () => { checks.reportedOnce(REAL); checks.reportedCap(REAL); });
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
  { name: 'no reported_sessions memory', row: 'reportedOnce', from: 'if (sessionId && sessions.includes(sessionId)) return false;', to: '' },
];
for (const c of NEG) {
  test(`negative control: ${c.name} turns the "${c.row}" row red`, () => {
    const wl = load(mutated(c.from, c.to));
    assert.throws(() => (c.row === 'launchId' ? (checks.launchId(wl), checks.launchIdPending(wl)) : checks[c.row](wl)), assert.AssertionError);
  });
}
