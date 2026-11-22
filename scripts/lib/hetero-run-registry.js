#!/usr/bin/env node
'use strict';

// scripts/lib/hetero-run-registry.js — atomic run registry for external hetero
// engine runs (<state>/hetero-runs/<run_id>.json).
//
// Fields: { run_id, owner_member, engine, pid, proc_start, started_at_ms,
//           status: 'running'|'done'|'failed', result_path }
// owner_member is an empty string when no owner can be resolved.
//
// Liveness rule: a run is inflight iff status === 'running' AND pid exists AND
// field 22 of /proc/<pid>/stat (proc_start) matches the recorded proc_start.

const fs = require('fs');
const path = require('path');
const runtimePaths = require('./runtime-paths');

function heteroRunsDir(env = process.env) {
  if (env.AUTOPILOT_HETERO_RUNS_DIR) return env.AUTOPILOT_HETERO_RUNS_DIR;
  return path.join(path.dirname(runtimePaths.runsDir(env)), 'hetero-runs');
}

function sanitizeRunId(id) {
  return String(id || '').replace(/[^A-Za-z0-9._-]/g, '-');
}

function readProcStart(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
    const rparen = stat.lastIndexOf(')');
    if (rparen === -1) return null;
    const rest = stat.slice(rparen + 1).trim().split(/\s+/);
    // Field 3 (state) is rest[0], so field 22 (starttime) is rest[19].
    const val = rest[19];
    return val && /^\d+$/.test(val) ? val : null;
  } catch {
    return null;
  }
}

function isInflight(entry) {
  if (!entry || entry.status !== 'running') return false;
  const pid = Number(entry.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!entry.proc_start) return false;
  const currentStart = readProcStart(pid);
  return currentStart !== null && currentStart === String(entry.proc_start);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeEntryAtomic(entry, dir = heteroRunsDir()) {
  if (!entry || !entry.run_id) throw new Error('run_id is required');
  ensureDir(dir);
  const safeId = sanitizeRunId(entry.run_id);
  const target = path.join(dir, `${safeId}.json`);
  const tmp = path.join(dir, `.${safeId}.json.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
  return target;
}

function getRun(runId, dir = heteroRunsDir()) {
  if (!runId) return null;
  const safeId = sanitizeRunId(runId);
  const target = path.join(dir, `${safeId}.json`);
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    return { ...entry, inflight: isInflight(entry) };
  } catch {
    return null;
  }
}

function listRuns(ownerMember, dir = heteroRunsDir()) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const entry = JSON.parse(raw);
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (ownerMember !== undefined && ownerMember !== null && entry.owner_member !== ownerMember) {
        continue;
      }
      out.push({ ...entry, inflight: isInflight(entry) });
    } catch {
      // skip unreadable or malformed entries
    }
  }
  return out;
}

function parseArgs(argv) {
  const cmd = argv[0];
  const opts = {};
  for (let i = 1; i < argv.length; i += 1) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = i + 1 < argv.length ? argv[++i] : '';
      opts[key] = val;
    }
  }
  return { cmd, opts };
}

if (require.main === module) {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const dir = opts.dir || heteroRunsDir();
  if (cmd === 'write') {
    const pid = Number(opts.pid);
    const procStart = opts['proc-start'] || (Number.isInteger(pid) && pid > 0 ? readProcStart(pid) : null) || '';
    const startedAtMs = opts['started-at-ms'] ? Number(opts['started-at-ms']) : Date.now();
    const entry = {
      run_id: opts['run-id'] || '',
      owner_member: opts['owner-member'] || '',
      engine: opts.engine || '',
      pid: Number.isInteger(pid) ? pid : 0,
      proc_start: procStart,
      started_at_ms: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      status: opts.status || 'running',
      result_path: opts['result-path'] || '',
    };
    const written = writeEntryAtomic(entry, dir);
    process.stdout.write(JSON.stringify({ path: written, ...entry }) + '\n');
  } else if (cmd === 'update') {
    const existing = getRun(opts['run-id'], dir);
    const base = existing ? { ...existing } : {
      run_id: opts['run-id'] || '',
      owner_member: opts['owner-member'] || '',
      engine: opts.engine || '',
      pid: 0,
      proc_start: '',
      started_at_ms: Date.now(),
      result_path: '',
    };
    delete base.inflight;
    if (opts.status) base.status = opts.status;
    if (opts['result-path'] !== undefined) base.result_path = opts['result-path'];
    const written = writeEntryAtomic(base, dir);
    process.stdout.write(JSON.stringify({ path: written, ...base }) + '\n');
  } else if (cmd === 'get') {
    const run = getRun(opts['run-id'], dir);
    if (!run) process.exit(3);
    process.stdout.write(JSON.stringify(run) + '\n');
  } else if (cmd === 'list') {
    const runs = listRuns(opts['owner-member'], dir);
    process.stdout.write(JSON.stringify(runs) + '\n');
  } else {
    process.stderr.write('Usage: hetero-run-registry.js <write|update|get|list> [options]\n');
    process.exit(2);
  }
}

module.exports = {
  heteroRunsDir,
  readProcStart,
  isInflight,
  writeEntryAtomic,
  getRun,
  listRuns,
};
