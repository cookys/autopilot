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
// Dispatched work (amendment 3): every stub that DISPATCHES something (repair, review, re-review, acceptance) registers a plan
// entry for it with `register` (below) and starts a one-shot timer for it. Its exit file lands on the `dispatch.json`
// after_polls-th poll of wait-dispatch-results.js AFTER the dispatch, or after_s seconds after the dispatch, whichever
// comes first; a file watch therefore sees the file even if nobody polls. Those ledger entries carry dispatch:true: they
// are not part of the marker evidence (fbatch/cell.js buildTrace skips them).
//   register --kind <repair|review|re-review|acceptance> --detail <text> [--sha <sha>]   prints the label (= run name)
//   after --watch-pid <pid> --label <label> --due-ts <ms>                              one-shot timer, started by register
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
      if (done[lab] || !due(spec, lab)) continue;
      for (const [rel, text] of Object.entries(spec.files || {})) {
        const abs = path.resolve(spec.root || root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text);
      }
      done[lab] = true;
      ledger.append({ kind: 'landed', label: lab, lane: spec.lane || null, files: Object.keys(spec.files || {}), wake: !!wake, by, ...(spec.dispatch ? { dispatch: true } : {}) });
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

const aliveP = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function fbDir() { return path.join(cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'fbatch'); }
function resultText(kind, detail, sha) {
  const head = kind === 'repair' ? `# Repair run\n\ntarget and ids: ${detail}` : `# ${kind} run\n\nsha: ${sha}`;
  return `${head}\nstatus: complete\nvalidator: passed\n`;
}
// Register a dispatched run and start its timer. Returns the label; the exit file is runs/<label>.exit.
function register({ kind, detail, sha }) {
  const dir = fbDir();
  const cfg = readJson(path.join(dir, 'dispatch.json'), {});
  const afterPolls = Number.isInteger(cfg.after_polls) && cfg.after_polls > 0 ? cfg.after_polls : 2;
  const afterS = Number.isInteger(cfg.after_s) && cfg.after_s > 0 ? cfg.after_s : 0;
  const cwd = process.cwd();
  let label;
  let dueTs = 0;
  withLock(dir, () => {
    const planF = path.join(dir, 'plan.json');
    const plan = readJson(planF, {});
    label = kind === 'repair' ? `repair-${Object.values(plan).filter((s) => s.kind === 'repair').length + 1}` : `${kind}-${sha}`;
    if (plan[label]) return; // the same run dispatched again: the first registration stands
    let polls = 0;
    try { polls = parseInt(fs.readFileSync(path.join(dir, 'waits'), 'utf8'), 10) || 0; } catch { /* no poll yet */ }
    dueTs = afterS ? Date.now() + afterS * 1000 : 0;
    plan[label] = { dispatch: true, kind, root: cwd, after: polls + afterPolls, ...(dueTs ? { due_ts: dueTs } : {}),
      files: { [`runs/${label}.exit`]: '0\n', [`runs/${label}.result.md`]: resultText(kind, detail, sha) } };
    fs.writeFileSync(planF, JSON.stringify(plan));
  });
  let watch = NaN;
  try { watch = parseInt(fs.readFileSync(path.join(dir, 'watch.pid'), 'utf8'), 10); } catch { /* none recorded */ }
  if (dueTs && Number.isInteger(watch) && watch > 0) {
    // own session: it must outlive the shell command that dispatched; it ends at due+5 s, with the watched runner, or with the git dir
    const child = cp.spawn(process.execPath, [__filename, 'after', '--watch-pid', String(watch), '--label', label, '--due-ts', String(dueTs)], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
  }
  return label;
}
function afterMain(argv) {
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const watch = Number(val('--watch-pid')); const label = val('--label'); const dueTs = Number(val('--due-ts'));
  if (!Number.isInteger(watch) || watch < 1 || !label || !Number.isFinite(dueTs)) process.exit(2);
  const root = process.cwd();
  let dir;
  try { dir = fbDir(); } catch { process.exit(0); }
  for (;;) {
    sleepMs(250);
    if (!aliveP(watch) || !fs.existsSync(dir) || Date.now() > dueTs + 5000) process.exit(0);
    if (Date.now() >= dueTs) { land({ dir, root, by: 'timer', due: (s, lab) => lab === label }); process.exit(0); }
  }
}

module.exports = { land, register };
if (require.main === module) {
  const cmd = process.argv[2];
  const a = process.argv.slice(3);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  if (cmd === 'timer') timerMain(a);
  else if (cmd === 'after') afterMain(a);
  else if (cmd === 'register') {
    const kind = val('--kind');
    if (!['repair', 'review', 're-review', 'acceptance'].includes(kind)) { console.error('usage: _land.js register --kind <repair|review|re-review|acceptance> --detail <text> [--sha <sha>]'); process.exit(2); }
    process.stdout.write(`${register({ kind, detail: val('--detail') || '', sha: val('--sha') || '' })}\n`);
  } else { console.error('usage: _land.js timer|after|register ...'); process.exit(2); }
}
