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
