#!/usr/bin/env node
'use strict';

/**
 * stuck-hand-check.js — tell a lane when a dispatched hand has silently stalled.
 *
 * A "hand" is a dispatch-hetero / dispatch-author / dispatch-review run whose manifest (the dispatch-runs
 * directory, same discovery as dispatch-status.js) has no ended_at. It is STUCK when, for N minutes (default 30),
 * ALL of these held between this tool's own observations:
 *   output  — the raw log (manifest log_path / aux_log) did not change size or mtime, and nothing under the
 *             run's worktree changed mtime (newestMtime from lib/worktree-activity.js, the shared primitive)
 *   commit  — the worktree's HEAD sha did not move
 *   cpu     — utime+stime of the manifest pid and its descendants (/proc/<pid>/stat) did not grow;
 *             a process that is gone counts as no CPU
 * Observations live in a state file under the live runtime base (tmpfs, scripts/lib/live-state-dir.js), so
 * "quiet since" is measured from the first scan that saw nothing move. Each run is reported ONCE:
 * `reported_at` is stamped into state and the run never appears in `newly_reported` again.
 *
 * It states facts, it does not kill anything. The hook hooks/stuck-hand-lib.js delivers the notice to the
 * session recorded in the manifest (`session_id`).
 *
 * USAGE:   scripts/stuck-hand-check.js [--minutes N] [--dir <runs-dir>] [--json]
 *   --minutes N   quiet threshold (default env AUTOPILOT_STUCK_HAND_MINUTES, else 30)
 * ENV (tests): AUTOPILOT_STUCK_HAND_PROC_ROOT (default /proc), AUTOPILOT_STUCK_HAND_NOW (epoch ms),
 *              AUTOPILOT_STUCK_HAND_STATE (state file path, else <live base>/stuck-hand/state.json)
 * OUTPUT:  { schema_version, stuck:[{run_id, lane, role, engine, session_id, quiet_minutes,
 *            evidence:{output, commit, cpu}}], newly_reported:[run_id...] }
 * EXIT:    0 always for a completed scan; 2 usage error.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { newestMtime } = require('./lib/worktree-activity.js');
const runtimePaths = require('./lib/runtime-paths.js');

const SCHEMA_VERSION = 1;
const DEFAULT_MINUTES = 30;

function minutesFromEnv(env) {
  const n = Number(env.AUTOPILOT_STUCK_HAND_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MINUTES;
}

function statePath(env) {
  if (env.AUTOPILOT_STUCK_HAND_STATE) return env.AUTOPILOT_STUCK_HAND_STATE;
  const { resolveLiveDir } = require('./lib/live-state-dir.js');
  return path.join(resolveLiveDir({ env }).base, 'stuck-hand', 'state.json');
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object' && s.runs && typeof s.runs === 'object') return s;
  } catch (_e) { /* absent or corrupt: start fresh */ }
  return { runs: {} };
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// utime+stime ticks of `pid` and every descendant. null = pid gone / unreadable.
function cpuTicks(pid, procRoot) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const read = (p) => {
    try {
      const s = fs.readFileSync(path.join(procRoot, String(p), 'stat'), 'utf8');
      // comm may contain spaces/parens: fields start after the LAST ')'.
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      return { ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) };
    } catch (_e) { return null; }
  };
  const self = read(pid);
  if (!self) return null;
  const kids = new Map();
  let names = [];
  try { names = fs.readdirSync(procRoot).filter((n) => /^\d+$/.test(n)); } catch (_e) { /* no procfs */ }
  for (const n of names) {
    const r = read(n);
    if (r) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push({ pid: Number(n), ticks: r.ticks }); }
  }
  let total = self.ticks;
  const stack = [pid];
  const seen = new Set([pid]);
  while (stack.length) {
    for (const k of kids.get(stack.pop()) || []) {
      if (seen.has(k.pid)) continue;
      seen.add(k.pid);
      total += k.ticks;
      stack.push(k.pid);
    }
  }
  return total;
}

function headSha(worktree) {
  if (!worktree) return null;
  const r = spawnSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function observe(m, procRoot) {
  let size = null; let mtime = null;
  for (const f of [m.log_path, m.aux_log]) {
    if (!f || typeof f !== 'string') continue;
    try { const st = fs.statSync(f); size = (size || 0) + st.size; mtime = Math.max(mtime || 0, st.mtimeMs); } catch (_e) { /* log not there yet */ }
  }
  let wt = null;
  if (m.worktree && typeof m.worktree === 'string') {
    try { if (fs.statSync(m.worktree).isDirectory()) wt = newestMtime(m.worktree).mtime; } catch (_e) { /* worktree gone */ }
  }
  return { size, mtime, wt, head: headSha(m.worktree), cpu: cpuTicks(Number(m.pid), procRoot) };
}

// What moved since the previous observation.
function moved(prev, cur) {
  return {
    output: prev.size !== cur.size || prev.mtime !== cur.mtime || prev.wt !== cur.wt,
    commit: prev.head !== cur.head,
    cpu: typeof prev.cpu === 'number' && typeof cur.cpu === 'number' && cur.cpu > prev.cpu,
  };
}

function readRuns(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.manifest.json')); } catch (_e) { return []; }
  const out = [];
  for (const f of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!m || typeof m !== 'object' || m.artifact_type === 'plan_review_panel_manifest') continue;
      if (typeof m.run_id !== 'string' || !m.run_id || m.ended_at) continue;
      out.push(m);
    } catch (_e) { /* unreadable manifest skipped */ }
  }
  return out;
}

/**
 * One scan. opts: { dir, minutes, now (ms), procRoot, stateFile, markReported (default true) }.
 * Returns { schema_version, stuck, newly_reported }. Mutates and saves the state file.
 */
function scan(opts = {}) {
  const env = opts.env || process.env;
  const minutes = opts.minutes || minutesFromEnv(env);
  const now = opts.now || (env.AUTOPILOT_STUCK_HAND_NOW ? Number(env.AUTOPILOT_STUCK_HAND_NOW) : Date.now());
  const procRoot = opts.procRoot || env.AUTOPILOT_STUCK_HAND_PROC_ROOT || '/proc';
  const file = opts.stateFile || statePath(env);
  const state = loadState(file);
  const next = { runs: {} };
  const stuck = [];
  const newly = [];
  for (const m of readRuns(opts.dir || runtimePaths.runsDir(env))) {
    const cur = observe(m, procRoot);
    const old = state.runs[m.run_id];
    const rec = old || { quiet_since: now };
    const mv = old ? moved(old.obs, cur) : { output: true, commit: true, cpu: true };
    const keepCpu = typeof cur.cpu === 'number' ? cur.cpu : (old ? old.obs.cpu : null);
    if (mv.output || mv.commit || mv.cpu) rec.quiet_since = now;
    rec.obs = { ...cur, cpu: keepCpu };
    next.runs[m.run_id] = rec;
    const quiet = (now - rec.quiet_since) / 60000;
    if (quiet >= minutes) {
      if (!rec.reported_at) { rec.reported_at = now; newly.push(m.run_id); }
      stuck.push({
        run_id: m.run_id,
        lane: m.lane || null,
        role: m.role || null,
        engine: [m.runner, m.model].filter(Boolean).join(':') || null,
        session_id: typeof m.session_id === 'string' && m.session_id ? m.session_id : null,
        quiet_minutes: Math.floor(quiet),
        evidence: { output: 'no log/worktree change', commit: 'no new commit', cpu: 'no CPU growth' },
        notified_at: rec.notified_at || null,
      });
    }
  }
  try { saveState(file, next); } catch (_e) { /* state is best effort */ }
  return { schema_version: SCHEMA_VERSION, stuck, newly_reported: newly };
}

// The hook's delivery step: stamp notified_at for the runs it is about to announce.
function markNotified(runIds, file, now) {
  const state = loadState(file);
  for (const id of runIds) if (state.runs[id]) state.runs[id].notified_at = now;
  try { saveState(file, state); } catch (_e) { /* best effort */ }
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') continue;
    if (a === '--minutes' || a === '--dir') {
      const v = argv[i + 1];
      if (v === undefined) { process.stderr.write(`${a} needs a value\n`); return 2; }
      i += 1;
      if (a === '--dir') opts.dir = v;
      else { opts.minutes = Number(v); if (!(opts.minutes > 0)) { process.stderr.write('--minutes must be > 0\n'); return 2; } }
    } else { process.stderr.write(`unknown argument: ${a}\n`); return 2; }
  }
  const res = scan(opts);
  const out = { schema_version: res.schema_version, stuck: res.stuck.map(({ notified_at, session_id, ...r }) => r), newly_reported: res.newly_reported };
  fs.writeSync(1, `${JSON.stringify(out)}\n`);
  return 0;
}

module.exports = { scan, markNotified, statePath, minutesFromEnv, cpuTicks, DEFAULT_MINUTES };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
