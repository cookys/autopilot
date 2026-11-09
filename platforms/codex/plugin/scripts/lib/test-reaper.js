'use strict';
// Test helper: a test must not leave a child running after it ends (pass, fail, exception, SIGINT/SIGTERM/SIGHUP).
//   installReaper()        once at the top of a test file: on exit (which an uncaught exception also reaches) and on TERM/INT/HUP, SIGKILL every
//                          process that descends from this one (found by walking /proc ppid links) plus every pid
//                          passed to track(). Only this process's own descendants and tracked pids are ever signalled.
//   track(child, ms, {group}) remember a spawned child (ChildProcess or pid) and SIGKILL it (and its process group when it
//                          was spawned detached: {group:true}) after ms, so a hanging child cannot outlive the test by wall time.
//   killDescendants()      the reaper's body, callable by a test between cases.
//   guard(promise, ms)     await a promise that drives in-process children (no handle on the pid): after ms the
//                          descendants are killed so the promise settles instead of hanging.
// Node built-ins only; Linux /proc (elsewhere the descendant walk finds nothing and tracked pids still work).
const fs = require('fs');

const tracked = new Set();
let installed = false;

function ppidOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch (_) { return null; }
}

function descendants(root = process.pid) {
  let names = [];
  try { names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch (_) { return []; }
  const kids = new Map();
  for (const n of names) {
    const pp = ppidOf(n);
    if (pp !== null) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(Number(n)); }
  }
  const out = [];
  const stack = [root];
  while (stack.length) for (const k of kids.get(stack.pop()) || []) { out.push(k); stack.push(k); }
  return out;
}

function kill(pid, group) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (group) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* gone */ } }
  try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ }
}

function killDescendants() {
  for (let round = 0; round < 5; round += 1) {
    const pids = descendants();
    for (const pid of tracked) if (!pids.includes(pid)) pids.push(pid);
    if (!pids.length) return;
    for (const pid of pids) kill(pid, false);
    tracked.clear(); // signalled once; a recycled pid must not be hit again
  }
}

function track(child, ms, opts = {}) {
  const pid = typeof child === 'number' ? child : child && child.pid;
  if (!Number.isInteger(pid)) return child;
  tracked.add(pid);
  if (ms) {
    const t = setTimeout(() => kill(pid, !!opts.group), ms); // opts.group: the child was spawned detached (own process group)
    t.unref();
    if (child && child.once) child.once('exit', () => { clearTimeout(t); tracked.delete(pid); });
  }
  return child;
}

function guard(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { killDescendants(); resolve(); }, ms); timer.unref(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function installReaper() {
  if (installed) return;
  installed = true;
  process.on('exit', killDescendants);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => { killDescendants(); process.exit(code); });
  }
}

module.exports = { installReaper, track, guard, killDescendants, descendants };
