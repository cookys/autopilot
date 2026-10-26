#!/usr/bin/env node
'use strict';
// findings-batch-v2 (fbatch/cc-v2): a landed REPAIR also advances the lane branch(es) it repairs. A repair dispatch registers
//   repair: {lanes, ids}; when it lands, land() adds ONE new commit on top of refs/heads/lane/<lane> for each of those lanes (git
//   plumbing on a private index: HEAD, the work tree and the real index are not touched) and puts the new tip(s) into the run's
//   result file as `repaired_sha: <sha> (lane/<lane>)` lines, so a blind re-review and a later merge have the right target.
//   The original candidate tip (<git-dir>/fbatch/lane-shas) stays an ancestor of the new tip, so the merge markers of fbatch/cell.js
//   (candidate tip is an ancestor of develop) read a merge of the repaired lane exactly as they read a merge of the old tip.
// Landing of the fixture's pending background events (findings-batch eval). Used by wait-dispatch-results.js (a poll, or the
// turn-2 wake) and by the TIMER process the fixture starts (init-repo.sh -> fb_start_timer in _lib/fixture.sh).
// An event lands on the Nth poll of wait-dispatch-results.js OR `after_s` seconds after the fixture was built, whichever
// comes first (amendment 2): a real background run finishes whether or not anybody polls it, and a model that waits for the
// exit FILE (Monitor, until [ -e ... ]) never calls the poll script. `[ -e ]` runs no code, so the timer is a real process.
//   timer: node scripts/_land.js timer --watch-pid <pid> --gen <token>
//     started in the background by init-repo.sh, in the runner's process group (no setsid), stdio closed. There is no pid
//     file and no single-owner rule: any number of timers may exist at once and none coordinates with another; the lock and
//     the generation token (below) alone make that correct. A timer exits as soon as (a) land() says the token is stale,
//     or (b) every event it is responsible for (the plan's after_s events) has landed or is no longer in the plan, or
//     (c) the fixture's fbatch state dir (inside the git dir) is gone, or (d) the watched pid (the runner / test shell that
//     built the fixture) is gone, or (e) max(after_s)+5 s have passed. It never touches HOME and never runs claude.
// Landing is serialised by <git-dir>/fbatch/land.lock, so a poll and the timer never land the same event twice.
// Dispatched work (amendment 3): every stub that DISPATCHES something (repair, review, re-review, acceptance) registers a plan
// entry for it with `register` (below) and starts a one-shot timer for it. Its exit file lands on the `dispatch.json`
// after_polls-th poll of wait-dispatch-results.js AFTER the dispatch, or after_s seconds after the dispatch, whichever
// comes first; a file watch therefore sees the file even if nobody polls. Those ledger entries carry dispatch:true: they
// are not part of the marker evidence (fbatch/cell.js buildTrace skips them).
//   reset --gen <token> --task <id> --watch-pid <pid> [--dispatch-after-s <n>]   fixture build: swap the hidden state under land.lock
//   register --kind <repair|review|re-review|acceptance> --detail <text> [--sha <sha>]   prints the label (= run name)
//   timer --watch-pid <pid> --gen <token>                                              the land_after_s timer (started by fb_start_timer)
//   after --watch-pid <pid> --label <label> --due-ts <ms> --gen <token>                              one-shot timer, started by register
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
// Generation handoff (one check for BOTH timers; every hand-over point below is why no timer can write into another fixture):
//   1. The token is made by the party that BUILDS the fixture (fixture.sh fb_state) and is stored by `reset` (below), which swaps
//      the whole hidden state (gen, plan, landed, waits, ledger, dispatch.json, watch.pid) and deletes the files the old plan
//      landed, all inside land.lock.
//   2. A timer never reads the token itself: the builder hands it over (`timer --gen`, fb_start_timer; `after --gen`, from
//      `register`, which reads it inside land.lock when it stamps the plan entry). So a timer paused before it starts, or before
//      its first read of anything, still carries the token of the fixture it was started for.
//   3. land() compares the timer's token with the stored one INSIDE land.lock and writes inside the same lock hold. `reset`
//      takes the same lock, so either land() finished first (its files are then deleted by reset) or reset finished first (the
//      stored token no longer matches: nothing is written and the timer ends). There is no point between check and write at
//      which a reset can run. Polls pass no token (they act on the fixture they run in).
function readGen(dir) { try { return fs.readFileSync(path.join(dir, 'gen'), 'utf8').trim(); } catch { return ''; } }
function isStale(dir, gen, spec) { return gen !== undefined && (readGen(dir) !== gen || (spec && spec.gen !== undefined && spec.gen !== gen)); }
// test-only pause point (inside the lock, after the check, before the write): FBATCH_LAND_PAUSE_FILE = a path; while it exists land() waits.
function pausePoint() { const f = process.env.FBATCH_LAND_PAUSE_FILE; if (f) for (let i = 0; i < 160 && fs.existsSync(f); i++) sleepMs(50); }
// Rebuild of the hidden state for a new fixture on this path (called by fixture.sh fb_state). Everything under one lock hold.
function reset({ dir, gen, task, watch, dispatchAfterS, root }) {
  fs.mkdirSync(dir, { recursive: true });
  return withLock(dir, () => { // reset
    const plan = readJson(path.join(dir, 'plan.json'), {});
    for (const spec of Object.values(plan)) for (const rel of Object.keys(spec.files || {})) { try { fs.unlinkSync(path.resolve(spec.root || root, rel)); } catch { /* not landed */ } }
    fs.writeFileSync(path.join(dir, 'plan.json'), '{}');
    try { fs.unlinkSync(path.join(dir, 'landed.json')); } catch { /* none */ }
    fs.writeFileSync(path.join(dir, 'waits'), '0\n');
    fs.writeFileSync(path.join(dir, 'ledger.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'watch.pid'), `${watch}\n`);
    fs.writeFileSync(path.join(dir, 'dispatch.json'), `${JSON.stringify({ after_polls: 2, ...(dispatchAfterS > 0 ? { after_s: dispatchAfterS } : {}) })}\n`);
    fs.writeFileSync(path.join(dir, 'gen'), `${gen}\n`); // last: from here every timer of an earlier fixture is stale
  });
}
// Land every plan entry the predicate calls due. `root` is where the files are written (relative paths).
// v2: one commit on lane/<lane> per repaired lane; returns [{lane, sha}] (a lane with no branch is skipped).
function commitRepairs(root, lanes, label, ids) {
  const out = [];
  const git = (args, o = {}) => cp.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', input: o.input, env: { ...process.env, GIT_AUTHOR_NAME: 'fbatch-fixture', GIT_AUTHOR_EMAIL: 'fbatch@example.invalid', GIT_COMMITTER_NAME: 'fbatch-fixture', GIT_COMMITTER_EMAIL: 'fbatch@example.invalid', ...(o.env || {}) } });
  const gitDir = git(['rev-parse', '--absolute-git-dir']).stdout.trim();
  for (const lane of lanes) {
    const ref = `refs/heads/lane/${lane}`;
    const tip = git(['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
    if (tip.status !== 0) continue;
    const old = tip.stdout.trim();
    const idx = path.join(gitDir, 'fbatch', `repair-index-${label}-${lane}`);
    const env = { GIT_INDEX_FILE: idx };
    try {
      const blob = git(['hash-object', '-w', '--stdin'], { input: `repair of ${ids || 'findings'} (${label})\n` }).stdout.trim();
      git(['read-tree', old], { env });
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},impl/${lane}.${label}.txt`], { env });
      const tree = git(['write-tree'], { env }).stdout.trim();
      const sha = git(['commit-tree', tree, '-p', old, '-m', `lane ${lane} ${label}: repair ${ids || ''}`.trim()]).stdout.trim();
      if (/^[0-9a-f]{40}$/.test(sha) && git(['update-ref', ref, sha, old]).status === 0) out.push({ lane, sha });
    } finally { try { fs.unlinkSync(idx); } catch { /* none */ } }
  }
  return out;
}
function land({ dir, root, due, by, wake, gen }) {
  return withLock(dir, () => {
    if (isStale(dir, gen)) return { plan: {}, done: {}, stale: true };
    const plan = readJson(path.join(dir, 'plan.json'), {});
    const landedF = path.join(dir, 'landed.json');
    const done = readJson(landedF, {});
    for (const [lab, spec] of Object.entries(plan)) {
      if (isStale(dir, gen, spec)) return { plan: {}, done: {}, stale: true };
      if (done[lab] || !due(spec, lab)) continue;
      pausePoint();
      const repaired = spec.repair ? commitRepairs(spec.root || root, spec.repair.lanes || [], lab, spec.repair.ids) : [];
      const shaLines = repaired.map((r) => `repaired_sha: ${r.sha} (lane/${r.lane})`).join('\n');
      for (const [rel, text] of Object.entries(spec.files || {})) {
        const abs = path.resolve(spec.root || root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text.replace('@REPAIRED_SHAS@\n', shaLines ? `${shaLines}\n` : ''));
      }
      done[lab] = true;
      ledger.append({ kind: 'landed', label: lab, lane: spec.lane || null, files: Object.keys(spec.files || {}), wake: !!wake, by, ...(spec.dispatch ? { dispatch: true } : {}), ...(repaired.length ? { repaired } : {}) });
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
  const gen = argv.includes('--gen') ? argv[argv.indexOf('--gen') + 1] : undefined; // handed over by the builder, never read here
  if (!gen) process.exit(2);
  const t0 = Date.now();
  const stop = Math.max(...secs) * 1000 + 5000;
  const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (;;) {
    sleepMs(250);
    if (!alive(watch) || !fs.existsSync(dir) || Date.now() - t0 > stop) process.exit(0); // (d) (c) (e)
    const el = Date.now() - t0;
    const { plan, done, stale } = land({ dir, root, by: 'timer', gen, due: (s) => typeof s.after_s === 'number' && s.after_s > 0 && el >= s.after_s * 1000 });
    if (stale) process.exit(0); // (a)
    if (Object.entries(plan).every(([lab, s]) => !(typeof s.after_s === 'number' && s.after_s > 0) || done[lab])) process.exit(0);
  }
}

const aliveP = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function fbDir() { return path.join(cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'fbatch'); }
function resultText(kind, detail, sha) {
  const head = kind === 'repair' ? `# Repair run\n\ntarget and ids: ${detail}` : `# ${kind} run\n\nsha: ${sha}`;
  return `${head}\nstatus: complete\nvalidator: passed\n${kind === 'repair' ? '@REPAIRED_SHAS@\n' : ''}`;
}
// Register a dispatched run and start its timer. Returns the label; the exit file is runs/<label>.exit.
function register({ kind, detail, sha }) {
  const dir = fbDir();
  const cfg = readJson(path.join(dir, 'dispatch.json'), {});
  const afterPolls = Number.isInteger(cfg.after_polls) && cfg.after_polls > 0 ? cfg.after_polls : 2;
  const afterS = Number.isInteger(cfg.after_s) && cfg.after_s > 0 ? cfg.after_s : 0;
  const cwd = process.cwd();
  let label;
  let gen;
  let dueTs = 0;
  withLock(dir, () => {
    const planF = path.join(dir, 'plan.json');
    const plan = readJson(planF, {});
    label = kind === 'repair' ? `repair-${Object.values(plan).filter((s) => s.kind === 'repair').length + 1}` : `${kind}-${sha}`;
    if (plan[label]) return; // the same run dispatched again: the first registration stands
    let polls = 0;
    try { polls = parseInt(fs.readFileSync(path.join(dir, 'waits'), 'utf8'), 10) || 0; } catch { /* no poll yet */ }
    dueTs = afterS ? Date.now() + afterS * 1000 : 0;
    gen = readGen(dir);
    // v2: a repair names the lanes it repairs: its target lane, or for `pool` the lane letters of its finding ids (A-F1 -> A)
    const [target, ids] = String(detail).trim().split(/\s+/);
    const repairLanes = kind !== 'repair' ? null : (target === 'pool' ? [...new Set((String(ids || '').match(/[A-Z](?=-F\d)/g) || []))] : (/^[A-Z]$/.test(target || '') ? [target] : []));
    plan[label] = { dispatch: true, kind, gen, root: cwd, ...(repairLanes ? { repair: { lanes: repairLanes, ids: ids || '' } } : {}), after: polls + afterPolls, ...(dueTs ? { due_ts: dueTs } : {}),
      files: { [`runs/${label}.exit`]: '0\n', [`runs/${label}.result.md`]: resultText(kind, detail, sha) } };
    fs.writeFileSync(planF, JSON.stringify(plan));
  });
  let watch = NaN;
  try { watch = parseInt(fs.readFileSync(path.join(dir, 'watch.pid'), 'utf8'), 10); } catch { /* none recorded */ }
  if (dueTs && Number.isInteger(watch) && watch > 0) {
    // own session: it must outlive the shell command that dispatched; it ends at due+5 s, with the watched runner, or with the git dir
    const child = cp.spawn(process.execPath, [__filename, 'after', '--watch-pid', String(watch), '--label', label, '--due-ts', String(dueTs), '--gen', gen], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
  }
  return label;
}
function afterMain(argv) {
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const watch = Number(val('--watch-pid')); const label = val('--label'); const dueTs = Number(val('--due-ts')); const gen = val('--gen');
  if (!Number.isInteger(watch) || watch < 1 || !label || !Number.isFinite(dueTs) || gen === undefined) process.exit(2);
  const root = process.cwd();
  let dir;
  try { dir = fbDir(); } catch { process.exit(0); }
  for (;;) {
    sleepMs(250);
    if (!aliveP(watch) || !fs.existsSync(dir) || Date.now() > dueTs + 5000) process.exit(0);
    if (Date.now() >= dueTs) { land({ dir, root, by: 'timer', gen, due: (s, lab) => lab === label }); process.exit(0); }
  }
}

module.exports = { land, register, reset };
if (require.main === module) {
  const cmd = process.argv[2];
  const a = process.argv.slice(3);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  if (cmd === 'reset') {
    const gen = val('--gen');
    if (!gen) { console.error('usage: _land.js reset --gen <token> --task <id> --watch-pid <pid> [--dispatch-after-s <n>]'); process.exit(2); }
    reset({ dir: fbDir(), gen, task: val('--task'), watch: val('--watch-pid') || '', dispatchAfterS: Number(val('--dispatch-after-s')) || 0, root: process.cwd() });
  } else if (cmd === 'timer') timerMain(a);
  else if (cmd === 'after') afterMain(a);
  else if (cmd === 'register') {
    const kind = val('--kind');
    if (!['repair', 'review', 're-review', 'acceptance'].includes(kind)) { console.error('usage: _land.js register --kind <repair|review|re-review|acceptance> --detail <text> [--sha <sha>]'); process.exit(2); }
    process.stdout.write(`${register({ kind, detail: val('--detail') || '', sha: val('--sha') || '' })}\n`);
  } else { console.error('usage: _land.js timer|after|register ...'); process.exit(2); }
}
