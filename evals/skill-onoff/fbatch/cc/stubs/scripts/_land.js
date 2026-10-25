#!/usr/bin/env node
'use strict';
// Landing of the fixture's pending background events (findings-batch eval). Used by wait-dispatch-results.js (a poll, or the
// turn-2 wake) and by the TIMER process the fixture starts (init-repo.sh -> fb_start_timer in _lib/fixture.sh).
// An event lands on the Nth poll of wait-dispatch-results.js OR `after_s` seconds after the fixture was built, whichever
// comes first (amendment 2): a real background run finishes whether or not anybody polls it, and a model that waits for the
// exit FILE (Monitor, until [ -e ... ]) never calls the poll script. `[ -e ]` runs no code, so the timer is a real process.
//   timer: node scripts/_land.js timer --watch-pid <pid>
//     started in the background by init-repo.sh, in the runner's process group (no setsid), stdio closed. It exits as soon as
//     (a) every event with an after_s has landed, or (b) the watched pid (the runner / test shell that built the fixture) is
//     gone, or (c) the fixture's git dir is gone, or (d) <git-dir>/fbatch/timer.pid no longer holds its own pid (the fixture
//     was rebuilt), or (e) max(after_s)+5 s have passed. It never touches HOME and never runs claude.
// Landing is serialised by <git-dir>/fbatch/land.lock, so a poll and the timer never land the same event twice.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ledger = require('./_ledger.js');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function sleepMs(n) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n); }
function withLock(dir, fn) {
  const lock = path.join(dir, 'land.lock');
  const t0 = Date.now();
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch { /* raced */ }
      if (Date.now() - t0 > 15000) throw new Error('land lock timeout');
      sleepMs(5);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* gone */ } }
}
// Land every plan entry the predicate calls due. `root` is where the files are written (relative paths).
function land({ dir, root, due, by, wake }) {
  return withLock(dir, () => {
    const plan = readJson(path.join(dir, 'plan.json'), {});
    const landedF = path.join(dir, 'landed.json');
    const done = readJson(landedF, {});
    for (const [lab, spec] of Object.entries(plan)) {
      if (done[lab] || !due(spec)) continue;
      for (const [rel, text] of Object.entries(spec.files || {})) {
        const abs = path.resolve(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text);
      }
      done[lab] = true;
      ledger.append({ kind: 'landed', label: lab, lane: spec.lane || null, files: Object.keys(spec.files || {}), wake: !!wake, by });
    }
    fs.writeFileSync(landedF, JSON.stringify(done));
    return { plan, done };
  });
}

function timerMain(argv) {
  const wi = argv.indexOf('--watch-pid');
  const watch = wi >= 0 ? Number(argv[wi + 1]) : NaN;
  const root = process.cwd();
  const gitDir = cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  const dir = path.join(gitDir, 'fbatch');
  const plan0 = readJson(path.join(dir, 'plan.json'), {});
  const secs = Object.values(plan0).map((s) => s.after_s).filter((v) => typeof v === 'number' && v > 0);
  if (!Number.isInteger(watch) || watch < 1 || !secs.length) process.exit(2);
  const pidFile = path.join(dir, 'timer.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  const t0 = Date.now();
  const stop = Math.max(...secs) * 1000 + 5000;
  const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (;;) {
    sleepMs(250);
    let mine = false;
    try { mine = fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid); } catch { /* gone */ }
    if (!alive(watch) || !mine || Date.now() - t0 > stop) process.exit(0);
    const el = Date.now() - t0;
    const { plan, done } = land({ dir, root, by: 'timer', due: (s) => typeof s.after_s === 'number' && s.after_s > 0 && el >= s.after_s * 1000 });
    if (Object.entries(plan).every(([lab, s]) => !(typeof s.after_s === 'number' && s.after_s > 0) || done[lab])) process.exit(0);
  }
}

module.exports = { land };
if (require.main === module) {
  if (process.argv[2] === 'timer') timerMain(process.argv.slice(3));
  else { console.error('usage: _land.js timer --watch-pid <pid>'); process.exit(2); }
}
