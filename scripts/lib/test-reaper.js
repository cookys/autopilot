'use strict';
// Test helper: a test must not leave a child running after it ends (pass, fail, exception, SIGINT/SIGTERM/SIGHUP).
//   installReaper()        once at the top of a test file: on exit (which an uncaught exception also reaches) and on TERM/INT/HUP, SIGKILL every
//                          process that descends from this one (found by walking /proc ppid links) plus every pid
//                          passed to track(). Only this process's own descendants and tracked pids are ever signalled.
//   track(child, ms, {group}) remember a spawned child (ChildProcess or pid) and SIGKILL it (and its process group when it
//                          was spawned detached: {group:true}) after ms (with its whole subtree), so a hanging child cannot outlive the test by wall time.
//   killDescendants()      the reaper's body, callable by a test between cases.
//   guard(promise, ms)     await a promise that drives in-process children (no handle on the pid): after ms the
//                          untracked descendants are killed so the promise settles instead of hanging; pids held by
//                          track() (and their subtrees) are left alone.
// A signal is sent only after the pid's start time (/proc stat field 22) matches the one recorded at track/discovery.
// Node built-ins only; Linux /proc (elsewhere the descendant walk finds nothing and tracked pids still work).
const fs = require('fs');

const tracked = new Map(); // pid -> process start time recorded when tracked (identity against pid reuse)
let installed = false;
let readStat = (pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); // replaceable by a test: setStatReader()

function statFields(pid) { // fields 3.. of /proc/<pid>/stat as an array (index 1 = ppid, index 19 = starttime), null when gone
  try {
    const stat = readStat(pid);
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  } catch (_) { return null; }
}

function ppidOf(pid) {
  const f = statFields(pid);
  return f ? Number(f[1]) : null;
}

function startOf(pid) { // process start time (field 22), null when the process is gone
  const f = statFields(pid);
  return f ? f[19] : null;
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

// descendants of root as Map pid -> start time, taken at discovery
function descendantStarts(root) {
  const m = new Map();
  for (const pid of descendants(root)) { const st = startOf(pid); if (st !== null) m.set(pid, st); }
  return m;
}

// SIGKILL pid only when it is still the process recorded (same start time); a recycled or vanished pid is skipped.
function kill(pid, start, group) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (start == null || startOf(pid) !== start) return;
  if (group) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* gone */ } }
  try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ }
}

// kill a subtree: descendants first (deepest discovered last, so reverse order), then the roots themselves
function killTree(rootPid, rootStart, group) {
  const subtree = descendantStarts(rootPid);
  for (const pid of [...subtree.keys()].reverse()) { kill(pid, subtree.get(pid), false); tracked.delete(pid); }
  kill(rootPid, rootStart, group);
  tracked.delete(rootPid);
}

function killDescendants() {
  for (let round = 0; round < 5; round += 1) {
    const found = descendantStarts(process.pid);
    for (const [pid, start] of tracked) found.set(pid, start); // the identity recorded at track() wins over the one seen now
    if (!found.size) return;
    for (const [pid, start] of found) kill(pid, start, false);
    tracked.clear(); // signalled once; a recycled pid must not be hit again
  }
}

function track(child, ms, opts = {}) {
  const pid = typeof child === 'number' ? child : child && child.pid;
  if (!Number.isInteger(pid)) return child;
  const start = startOf(pid);
  if (start === null) return child; // already gone: nothing to reap, and nothing to signal later
  tracked.set(pid, start);
  if (ms) {
    // opts.group: the child was spawned detached (own process group). The whole subtree dies, not only the pid:
    // its grandchildren would otherwise be reparented to init and escape the reaper's walk.
    const t = setTimeout(() => killTree(pid, start, !!opts.group), ms);
    t.unref();
    if (child && child.once) child.once('exit', () => { clearTimeout(t); tracked.delete(pid); });
  }
  return child;
}

// guard's timeout kills only descendants that no track() owner holds (a tracked pid and its subtree belong to another
// caller and stay running and tracked), so concurrent tests do not kill each other's children.
function guard(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      const others = new Set();
      for (const pid of tracked.keys()) { others.add(pid); for (const d of descendants(pid)) others.add(d); }
      const mine = descendantStarts(process.pid);
      for (const pid of [...mine.keys()].reverse()) if (!others.has(pid)) kill(pid, mine.get(pid), false);
      resolve();
    }, ms);
    timer.unref();
  });
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

function setStatReader(fn) { readStat = fn || ((pid) => fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); }
function isTracked(pid) { return tracked.has(pid); }

module.exports = { installReaper, track, guard, killDescendants, descendants, setStatReader, isTracked };
