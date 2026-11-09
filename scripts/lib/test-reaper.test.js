'use strict';
// test-reaper: a hung or exec-looping child dies on SIGTERM to the test process and on its wall time; without the reaper
// it survives (negative control, RED before the helper existed). Only pids this file recorded are killed.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REAPER = path.join(__dirname, 'test-reaper.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); } catch (_) { return false; } try { return !/^\d+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch (_) { return false; } };
async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return fn(); }

// holder: spawns `sleep 300` as its child, records both pids, optionally installs the reaper / tracks with a 1s wall.
function holder(dir, mode) {
  const pidFile = path.join(dir, `${mode}.pids`);
  const src = [
    "const fs = require('fs'); const { spawn } = require('child_process');",
    `const R = require(${JSON.stringify(REAPER)});`,
    `if (${mode === 'reaper' || mode === 'wall'}) R.installReaper();`,
    "const c = spawn('sleep', ['300'], { stdio: 'ignore' });",
    `if (${mode === 'wall'}) R.track(c, 1000);`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, process.pid + ' ' + c.pid);`,
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const file = path.join(dir, `${mode}.js`);
  fs.writeFileSync(file, src);
  const p = spawn(process.execPath, [file], { stdio: 'ignore' });
  return { p, pids: () => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number) : []) };
}

async function scenario(mode, sig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-'));
  const h = holder(dir, mode);
  let child = 0;
  try {
    assert.ok(await until(() => h.pids().length === 2, 8000), 'holder started');
    child = h.pids()[1];
    if (sig) h.p.kill(sig);
    else await sleep(2500); // the wall time (1s) must have fired while the holder is still running
    const gone = await until(() => !alive(child), 3000);
    return gone;
  } finally {
    try { process.kill(h.p.pid, 'SIGKILL'); } catch (_) { /* gone */ }
    if (child) { try { process.kill(child, 'SIGKILL'); } catch (_) { /* gone */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('negative control: without the reaper a child survives SIGTERM to its parent', async () => {
  assert.strictEqual(await scenario('plain', 'SIGTERM'), false);
});
test('installReaper: SIGTERM to the test process takes the child with it', async () => {
  assert.strictEqual(await scenario('reaper', 'SIGTERM'), true);
});
test('track(child, ms): a hung child is killed at its wall time while the parent keeps running', async () => {
  assert.strictEqual(await scenario('wall', null), true);
});

// in-process: require the helper directly
const R = require('./test-reaper.js');
const startTime = (pid) => { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; };

test('track timeout kills the whole subtree: parent and grandchild are both dead', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-gc-'));
  const pf = path.join(dir, 'gc.pid');
  const p = spawn('sh', ['-c', `sleep 60 & echo $! > ${pf}; wait`], { stdio: 'ignore' });
  let gc = 0;
  try {
    R.track(p, 600);
    assert.ok(await until(() => fs.existsSync(pf) && fs.readFileSync(pf, 'utf8').trim() !== '', 4000), 'grandchild started');
    gc = Number(fs.readFileSync(pf, 'utf8').trim());
    assert.ok(await until(() => !alive(p.pid) && !alive(gc), 4000), 'parent and grandchild gone');
  } finally {
    try { process.kill(p.pid, 'SIGKILL'); } catch (_) { /* gone */ }
    if (gc) { try { process.kill(gc, 'SIGKILL'); } catch (_) { /* gone */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('timer-killed pid leaves tracked; a pid whose start time differs is never signalled', async () => {
  const a = spawn('sleep', ['60'], { stdio: 'ignore' });
  // b is not our descendant (reparented to init), like a tracked pid whose number was recycled by an unrelated process
  const bOut = require('child_process').execFileSync('sh', ['-c', 'setsid sleep 60 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
  const b = { pid: Number(bOut.trim()) };
  try {
    R.track(a, 300);
    assert.ok(R.isTracked(a.pid));
    assert.ok(await until(() => !alive(a.pid), 3000), 'timer killed a');
    assert.strictEqual(R.isTracked(a.pid), false, 'killed pid removed from tracked');
    // b: record its identity, then make the stat reader report a different start time (a recycled pid)
    R.track(b, 0);
    const real = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    R.setStatReader((pid) => {
      const s = real(pid);
      if (pid !== b.pid) return s;
      const i = s.lastIndexOf(')') + 2; const f = s.slice(i).split(' '); f[19] = String(Number(f[19]) + 1);
      return s.slice(0, i) + f.join(' ');
    });
    R.killDescendants();
    await sleep(300);
    assert.ok(alive(b.pid), 'mismatched start time: not signalled');
    assert.strictEqual(R.isTracked(b.pid), false, 'stale identity dropped from tracked');
  } finally {
    R.setStatReader(null);
    for (const c of [a, b]) { try { process.kill(c.pid, 'SIGKILL'); } catch (_) { /* gone */ } }
  }
});

test('a guard timeout leaves another owner\'s tracked child alive and tracked', async () => {
  const mine = spawn('sleep', ['60'], { stdio: 'ignore' });
  const other = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    R.track(other, 0);
    await R.guard(new Promise(() => {}), 300);
    await sleep(300);
    assert.ok(alive(other.pid), 'other child alive');
    assert.ok(R.isTracked(other.pid), 'other child still tracked');
    assert.ok(!alive(mine.pid), 'untracked child killed by the timed-out guard');
    assert.strictEqual(startTime(other.pid).length > 0, true);
  } finally {
    for (const c of [mine, other]) { try { process.kill(c.pid, 'SIGKILL'); } catch (_) { /* gone */ } }
  }
});
