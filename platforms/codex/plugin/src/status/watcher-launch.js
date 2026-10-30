'use strict';

// src/status/watcher-launch.js -- the launch record protocol that tells a hook (and the live band) WHY a watcher did not
// come up (BL-0336 U1, plan B + F2). Node >= 20.10, built-ins only.
//
// Directory: <autopilot home>/review/<project key>/live/ (where watcher.log lives), made through the private-directory
// rules of scripts/lib/runtime-paths.js. Files in it:
//   watcher-launch.json            { launch_id, pid, pid_start, started_at, result_path, reported_sessions, reported_reason }
//                                  written by the PARENT (atomically) before the spawn, completed with pid/pid_start after it.
//   watcher-start.<launch_id>.json { launch_id, ok, reason, at }
//                                  written by the watcher child (or by the parent when the spawn itself failed), also atomic.
//
// The reader (readLaunchReport) never trusts the log or an old envelope: it asks only about the CURRENT launch id.
//   result file present            -> ok / failed with its reason
//   absent and the launcher is gone (pid dead, or its start time changed) -> failed: "started but exited without reporting"
//   absent and the launcher is alive -> pending (no verdict)
// A new launch deletes every older watcher-start.*.json, so a stale file can never be mistaken for this launch.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LAUNCH_FILE = 'watcher-launch.json';
const RESULT_PREFIX = 'watcher-start.';
const RESULT_SUFFIX = '.json';
const REPORTED_CAP = 50;
const NO_REPORT_REASON = 'the watcher process started but exited without reporting a result (see watcher.log)';

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_cleanup) { /* best effort */ }
    throw error;
  }
}

function resultPathOf(dir, launchId) {
  return path.join(dir, `${RESULT_PREFIX}${launchId}${RESULT_SUFFIX}`);
}

function newLaunchId() {
  return crypto.randomBytes(8).toString('hex');
}

// Linux: field 22 of /proc/<pid>/stat (clock ticks since boot). Other platforms: null.
function pidStartOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const v = Number(rest[19]);
    return Number.isFinite(v) ? v : null;
  } catch (_error) { return null; }
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch (_error) { return null; }
}

function readLaunch(dir) {
  return readJson(path.join(dir, LAUNCH_FILE));
}

function launcherAlive(rec) {
  if (!Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  if (rec.pid_start !== null && rec.pid_start !== undefined) {
    const now = pidStartOf(rec.pid);
    return now !== null && now === rec.pid_start;
  }
  try { process.kill(rec.pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// -> { state: 'none'|'pending'|'ok'|'failed', reason?, launch? }. Reads at most: one small record, one small result.
function readLaunchReport(dir) {
  const rec = readLaunch(dir);
  if (!rec || typeof rec.launch_id !== 'string') return { state: 'none' };
  const result = readJson(resultPathOf(dir, rec.launch_id));
  if (result && result.launch_id === rec.launch_id) {
    return result.ok === true ? { state: 'ok', launch: rec } : { state: 'failed', reason: String(result.reason || 'unknown reason'), launch: rec };
  }
  if (launcherAlive(rec)) return { state: 'pending', launch: rec };
  return { state: 'failed', reason: NO_REPORT_REASON, launch: rec };
}

// Parent, BEFORE the spawn. Removes older results, keeps who was already told about which reason.
// -> { launch_id, result_path, record }
function beginLaunch(dir, now = new Date()) {
  const prev = readLaunch(dir);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(RESULT_PREFIX) && name.endsWith(RESULT_SUFFIX)) { try { fs.unlinkSync(path.join(dir, name)); } catch (_e) { /* best effort */ } }
    }
  } catch (_error) { /* dir listing is best effort */ }
  const launch_id = newLaunchId();
  const record = {
    launch_id,
    pid: null,
    pid_start: null,
    started_at: now.toISOString(),
    result_path: resultPathOf(dir, launch_id),
    reported_sessions: prev && Array.isArray(prev.reported_sessions) ? prev.reported_sessions.slice(-REPORTED_CAP) : [],
    reported_reason: prev && typeof prev.reported_reason === 'string' ? prev.reported_reason : null,
  };
  writeAtomic(path.join(dir, LAUNCH_FILE), `${JSON.stringify(record)}\n`);
  return { launch_id, result_path: record.result_path, record };
}

// Parent, AFTER the spawn.
function recordPid(dir, record, pid) {
  record.pid = Number.isInteger(pid) ? pid : null;
  record.pid_start = Number.isInteger(pid) ? pidStartOf(pid) : null;
  writeAtomic(path.join(dir, LAUNCH_FILE), `${JSON.stringify(record)}\n`);
}

// Either side. file = the launch's result path.
function writeResult(file, launchId, ok, reason, now = new Date()) {
  writeAtomic(file, `${JSON.stringify({ launch_id: launchId, ok: Boolean(ok), reason: ok ? null : String(reason || 'unknown reason'), at: now.toISOString() })}\n`);
}

// Marks (session, reason) as told. -> true when this call is the first to tell it (the caller should show it).
function claimReport(dir, sessionId, reason) {
  const rec = readLaunch(dir);
  if (!rec) return true; // nothing to remember it in: show it
  let sessions = Array.isArray(rec.reported_sessions) ? rec.reported_sessions : [];
  if (rec.reported_reason !== reason) sessions = [];
  if (sessionId && sessions.includes(sessionId)) return false;
  if (sessionId) sessions.push(sessionId);
  rec.reported_sessions = sessions.slice(-REPORTED_CAP);
  rec.reported_reason = reason;
  try { writeAtomic(path.join(dir, LAUNCH_FILE), `${JSON.stringify(rec)}\n`); } catch (_error) { /* a failed memo only means a repeat */ }
  return true;
}

module.exports = {
  LAUNCH_FILE, RESULT_PREFIX, RESULT_SUFFIX, REPORTED_CAP, NO_REPORT_REASON,
  resultPathOf, newLaunchId, pidStartOf, readLaunch, readLaunchReport, beginLaunch, recordPid, writeResult, claimReport,
};
