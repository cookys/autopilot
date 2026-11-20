#!/usr/bin/env node
// idle-watch.js — liveness supervisor for dispatch-author runners.
//
// Progress is an increase in watched-file bytes or in utime+stime summed over
// the child process tree (/proc/<pid>/stat, same field split as stuck-hand-check.js).
// A fixed wall clock is not the idle limit: progress at the idle deadline extends
// it. No progress kills the tree. A hard cap kills even when progress continues.
//
//   parse  --idle SPEC --hard SPEC --sample N
//          stdout: "<idleSeconds> <hardSeconds> <sampleSeconds>"  exit 2 if invalid
//   sample --pid N [--watch PATH]... [--proc-root DIR]
//          stdout: "bytes=N cpu=N|null alive=0|1"
//   run    --idle-s N --hard-s N --sample-s N --grace-s N
//          --raw-log PATH --status-file PATH [--watch PATH]... -- cmd...
//          child runs in its own session. Extend line on progress past the idle
//          deadline. Idle/hard: SIGTERM, wait grace, SIGKILL, status file, exit 124.
//          The child's own exit is propagated (signal → 128+n). SIGTERM/INT/HUP → 143.
//
// Node built-ins only. Does not replace scripts/lib/idle-watch.sh (dispatch-review).

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EXTEND_LINE = (signal) =>
  `dispatch-author: extend: progress seen (${signal}), idle reset\n`;

function procRootFrom(argvRoot) {
  return argvRoot || process.env.AUTOPILOT_AUTHOR_PROC_ROOT || '/proc';
}

function parseDuration(spec) {
  const t = String(spec ?? '').trim();
  const m = /^([0-9]+(?:\.[0-9]*)?|\.[0-9]+)([smhd])?$/.exec(t);
  if (!m) return null;
  const num = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's'];
  if (!Number.isFinite(num) || num <= 0 || !mult) return null;
  const c = Math.ceil(num * mult - 1e-9);
  if (!Number.isFinite(c) || c < 1) return null;
  return c;
}

function parseSample(spec) {
  const t = String(spec ?? '').trim();
  if (!t) return null;
  if (/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(t)) {
    const n = Number(t);
    if (!(n > 0) || !Number.isFinite(n)) return null;
    return n;
  }
  return parseDuration(t);
}

function readStat(pid, root) {
  try {
    const s = fs.readFileSync(path.join(root, String(pid), 'stat'), 'utf8');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    const utime = Number(f[11]);
    const stime = Number(f[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return { ppid: Number(f[1]), ticks: utime + stime };
  } catch {
    return null;
  }
}

function treeInfo(pid, root) {
  if (!Number.isInteger(pid) || pid <= 0) return { ticks: null, pids: [], alive: false };
  const self = readStat(pid, root);
  if (!self) return { ticks: null, pids: [], alive: false };
  const kids = new Map();
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => /^\d+$/.test(n)); } catch { /* no procfs */ }
  for (const n of names) {
    const r = readStat(n, root);
    if (!r) continue;
    if (!kids.has(r.ppid)) kids.set(r.ppid, []);
    kids.get(r.ppid).push({ pid: Number(n), ticks: r.ticks });
  }
  let total = self.ticks;
  const pids = [pid];
  const stack = [pid];
  const seen = new Set([pid]);
  while (stack.length) {
    for (const k of kids.get(stack.pop()) || []) {
      if (seen.has(k.pid) || k.pid <= 0) continue;
      seen.add(k.pid);
      total += k.ticks;
      pids.push(k.pid);
      stack.push(k.pid);
    }
  }
  return { ticks: total, pids, alive: true };
}

function fileBytes(paths) {
  let total = 0;
  const seen = new Set();
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try { total += fs.statSync(p).size; } catch { /* missing counts as 0 */ }
  }
  return total;
}

function progressSignal(prev, next) {
  if (!prev || !next) return '';
  let sig = '';
  if (typeof next.bytes === 'number' && typeof prev.bytes === 'number' && next.bytes > prev.bytes) {
    sig = 'bytes';
  }
  if (typeof prev.cpu === 'number' && typeof next.cpu === 'number' && next.cpu > prev.cpu) {
    sig = sig ? 'bytes+cpu' : 'cpu';
  }
  return sig;
}

function sleepMs(ms) {
  if (!(ms > 0)) return;
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

function signalPids(leader, pids, sig) {
  const seen = new Set();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
  if (Number.isInteger(leader) && leader > 0) {
    try { process.kill(-leader, sig); } catch { /* not a group, or already gone */ }
  }
}

function livePids(leader, known, root) {
  const out = new Set();
  const seeds = [];
  if (Number.isInteger(leader) && leader > 0) seeds.push(leader);
  for (const pid of known) seeds.push(pid);
  for (const pid of seeds) {
    const info = treeInfo(pid, root);
    if (info.alive) {
      for (const p of info.pids) out.add(p);
    } else {
      try { process.kill(pid, 0); out.add(pid); } catch { /* gone */ }
    }
  }
  return [...out];
}

function takeOpt(argv, i, name) {
  const v = argv[i + 1];
  if (v == null || v === '--') {
    process.stderr.write(`idle-watch: ${name} requires a value\n`);
    process.exit(2);
  }
  return v;
}

function cmdParse(argv) {
  let idle = '';
  let hard = '';
  let sample = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--idle') { idle = takeOpt(argv, i, a); i += 1; continue; }
    if (a === '--hard') { hard = takeOpt(argv, i, a); i += 1; continue; }
    if (a === '--sample') { sample = takeOpt(argv, i, a); i += 1; continue; }
    process.stderr.write(`idle-watch: unknown parse arg: ${a}\n`);
    process.exit(2);
  }
  const idleS = parseDuration(idle);
  const hardS = parseDuration(hard);
  const sampleS = parseSample(sample);
  if (idleS == null) {
    process.stderr.write(`idle-watch: invalid --idle: ${idle}\n`);
    process.exit(2);
  }
  if (hardS == null) {
    process.stderr.write(`idle-watch: invalid --hard: ${hard}\n`);
    process.exit(2);
  }
  if (sampleS == null) {
    process.stderr.write(`idle-watch: invalid --sample: ${sample}\n`);
    process.exit(2);
  }
  process.stdout.write(`${idleS} ${hardS} ${sampleS}\n`);
}

function cmdSample(argv) {
  let pid = 0;
  let root = '';
  const watches = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pid') { pid = Number(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--proc-root') { root = takeOpt(argv, i, a); i += 1; continue; }
    if (a === '--watch') { watches.push(takeOpt(argv, i, a)); i += 1; continue; }
    process.stderr.write(`idle-watch: unknown sample arg: ${a}\n`);
    process.exit(2);
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    process.stderr.write('idle-watch: sample requires --pid\n');
    process.exit(2);
  }
  const info = treeInfo(pid, procRootFrom(root));
  const bytes = fileBytes(watches);
  const cpu = typeof info.ticks === 'number' ? String(info.ticks) : 'null';
  process.stdout.write(`bytes=${bytes} cpu=${cpu} alive=${info.alive ? 1 : 0}\n`);
}

function writeExtend(rawLog, signal) {
  const line = EXTEND_LINE(signal);
  let same = false;
  try {
    const st = fs.fstatSync(1);
    const rst = fs.statSync(rawLog);
    same = st.dev === rst.dev && st.ino === rst.ino && st.isFile();
  } catch { /* stdout is not the raw log */ }
  if (same) fs.writeSync(1, line);
  else fs.appendFileSync(rawLog, line);
}

function cmdRun(argv) {
  const opt = {
    idleS: 0, hardS: 0, sampleS: 0, graceS: 0, rawLog: '', statusFile: '',
  };
  const watches = [];
  let root = '';
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i += 1; break; }
    if (a === '--idle-s') { opt.idleS = Number(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--hard-s') { opt.hardS = Number(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--sample-s') { opt.sampleS = Number(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--grace-s') { opt.graceS = Number(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--raw-log') { opt.rawLog = takeOpt(argv, i, a); i += 1; continue; }
    if (a === '--status-file') { opt.statusFile = takeOpt(argv, i, a); i += 1; continue; }
    if (a === '--watch') { watches.push(takeOpt(argv, i, a)); i += 1; continue; }
    if (a === '--proc-root') { root = takeOpt(argv, i, a); i += 1; continue; }
    process.stderr.write(`idle-watch: unknown run arg: ${a}\n`);
    process.exit(2);
  }
  const cmd = argv.slice(i);
  if (!(opt.idleS > 0) || !(opt.hardS > 0) || !(opt.sampleS > 0) || !(opt.graceS >= 0)
      || !opt.rawLog || !opt.statusFile || cmd.length === 0 || !cmd[0]) {
    process.stderr.write('idle-watch: run requires --idle-s --hard-s --sample-s --grace-s --raw-log --status-file -- cmd\n');
    process.exit(2);
  }
  const proc = procRootFrom(root);
  const paths = [opt.rawLog, ...watches];
  let child;
  try {
    child = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'inherit' });
  } catch (err) {
    process.stderr.write(`idle-watch: could not spawn: ${err.message}\n`);
    process.exit(127);
  }
  let childDone = null;
  let killing = false;
  const known = [];
  child.on('error', (err) => {
    if (killing) return;
    process.stderr.write(`idle-watch: could not spawn: ${err.message}\n`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => {
    childDone = { code, signal };
    setImmediate(() => { if (!killing) finishChild(childDone); });
  });

  function finishChild(done) {
    if (killing) return;
    killing = true;
    if (done && done.signal) {
      const sigNum = require('os').constants.signals[done.signal];
      process.exit(128 + (typeof sigNum === 'number' ? sigNum : 0));
    }
    process.exit(done && done.code != null ? done.code : 1);
  }

  function killFor(kind) {
    if (killing) return;
    killing = true;
    try { fs.writeFileSync(opt.statusFile, `${kind}\n`); } catch { /* parent maps a bare 124 */ }
    const leader = child.pid;
    const first = livePids(leader, known, proc);
    for (const pid of first) known.push(pid);
    signalPids(leader, first.length ? first : (leader ? [leader] : []), 'SIGTERM');
    const graceMs = opt.graceS * 1000;
    const end = Date.now() + graceMs;
    while (Date.now() < end) {
      const still = livePids(leader, known, proc);
      if (still.length === 0) break;
      sleepMs(Math.min(50, end - Date.now()));
    }
    const again = livePids(leader, known, proc);
    signalPids(leader, again, 'SIGKILL');
    sleepMs(30);
    process.exit(124);
  }

  function onStop() {
    if (killing) return;
    killing = true;
    const leader = child && child.pid;
    signalPids(leader, livePids(leader, known, proc), 'SIGTERM');
    process.exit(143);
  }
  process.on('SIGTERM', onStop);
  process.on('SIGINT', onStop);
  process.on('SIGHUP', onStop);

  const start = Date.now();
  const idleMs = opt.idleS * 1000;
  const hardMs = opt.hardS * 1000;
  const sampleMs = opt.sampleS * 1000;
  let idleDeadline = start + idleMs;
  const hardDeadline = start + hardMs;
  let baseline = null;
  let failedMeasure = false;
  let goneWaits = 0;

  function measure() {
    const info = treeInfo(child.pid, proc);
    return { bytes: fileBytes(paths), cpu: info.ticks, alive: info.alive, pids: info.pids };
  }

  function tick() {
    if (killing) return;
    if (childDone) { finishChild(childDone); return; }
    const now = Date.now();
    if (now >= hardDeadline) { killFor('hard_timeout'); return; }
    const due = baseline == null || now >= idleDeadline || (baseline && now >= baseline.nextSample);
    if (due) {
      let m = null;
      try { m = measure(); } catch { m = null; }
      if (m && m.pids) for (const pid of m.pids) known.push(pid);
      if (!m) {
        failedMeasure = true;
        if (now >= idleDeadline) { killFor('idle_timeout'); return; }
      } else if (!m.alive) {
        goneWaits += 1;
        if (childDone) { finishChild(childDone); return; }
        if (goneWaits > 25) { finishChild(childDone || { code: 1, signal: null }); return; }
        setTimeout(tick, 20);
        return;
      } else if (baseline == null || failedMeasure) {
        // A failed sample never counts as progress. Before the deadline, the next
        // good sample is only a new baseline; at the deadline, fail closed.
        if (failedMeasure && now >= idleDeadline) { killFor('idle_timeout'); return; }
        baseline = { bytes: m.bytes, cpu: m.cpu, nextSample: now + sampleMs };
        failedMeasure = false;
        goneWaits = 0;
      } else {
        goneWaits = 0;
        const sig = progressSignal(baseline, m);
        if (now >= idleDeadline) {
          if (sig) {
            let after = m.bytes;
            try {
              writeExtend(opt.rawLog, sig);
              after = fileBytes(paths);
            } catch { /* still extend; a failed note must not look like new output */ }
            idleDeadline = now + idleMs;
            baseline = { bytes: after, cpu: m.cpu, nextSample: now + sampleMs };
          } else {
            killFor('idle_timeout');
            return;
          }
        } else {
          baseline = { bytes: m.bytes, cpu: m.cpu, nextSample: now + sampleMs };
        }
      }
      if (baseline) baseline.nextSample = Date.now() + sampleMs;
    }
    if (childDone) { finishChild(childDone); return; }
    const nextAt = Math.min(
      baseline ? baseline.nextSample : Date.now() + sampleMs,
      idleDeadline,
      hardDeadline,
    );
    const wait = Math.max(5, nextAt - Date.now());
    setTimeout(tick, Math.min(wait, 1000));
  }

  const arm = Math.min(50, sampleMs);
  setTimeout(() => {
    if (killing) return;
    if (childDone) { finishChild(childDone); return; }
    tick();
  }, arm);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === 'parse') cmdParse(argv.slice(1));
  else if (cmd === 'sample') cmdSample(argv.slice(1));
  else if (cmd === 'run') cmdRun(argv.slice(1));
  else {
    process.stderr.write('idle-watch: usage: parse | sample | run\n');
    process.exit(2);
  }
}

main();
