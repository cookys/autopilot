'use strict';

// src/status/watcher-launch.js -- the launch record protocol that tells a hook (and the live band) WHY a watcher did not
// come up (BL-0336 U1, plan B + F2). Node >= 20.10, built-ins only.
//
// Directory: <autopilot home>/review/<project key>/live/ (where watcher.log lives), made through the private-directory
// rules of scripts/lib/runtime-paths.js. Files in it:
//   watcher-launch.json            { launch_id, pid, pid_start, started_at, result_path, reported: { <reason>: [session ids] } }
//                                  written by the PARENT (atomically) before the spawn, completed with pid/pid_start after it.
//   watcher-start.<launch_id>.json { launch_id, ok, reason, at }
//                                  written by the watcher child (or by the parent when the spawn itself failed), also atomic.
//
// The reader (readLaunchReport) never trusts the log or an old envelope: it asks only about the CURRENT launch id.
//   result file present            -> ok / failed with its reason
//   absent and the launcher is gone (pid dead, or its start time changed) -> failed: "started but exited without reporting"
//   absent and the launcher is alive -> pending (no verdict)
// A new launch deletes every older watcher-start.*.json, so a stale file can never be mistaken for this launch.
//
// Concurrency: two sessions can start at once. The starter holds `watcher-launch.lock` (O_EXCL, stale after 10 s) from beginLaunch to
// recordPid, and does not begin a new launch while the recorded one is still pending, so the loser never overwrites the winner's
// record and is never reported as a failure. A record whose pid is not written yet is pending (until it is older than 30 s: the
// parent died between the two writes). "Told once" memos (claimInFile) are per reason, and updated under their own lock.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LAUNCH_FILE = 'watcher-launch.json';
const RESULT_PREFIX = 'watcher-start.';
const RESULT_SUFFIX = '.json';
const REPORTED_CAP = 50;
const REASON_CAP = 20;
const LOCK_STALE_MS = 10000;
const PID_GAP_MS = 30000;
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Cross-process mutex by exclusive create. -> release() or null (held by someone else for the whole wait). A lock file older than
// LOCK_STALE_MS belongs to a dead holder and is removed.
function lockFile(file, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(file); } catch (_e) { /* gone */ } };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return null;
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(file); continue; }
      } catch (_e) { continue; }
      if (Date.now() >= deadline) return null;
      sleepMs(15);
    }
  }
}

function lockLaunch(dir) {
  return lockFile(path.join(dir, 'watcher-launch.lock'), 0);
}

// Marks (session, reason) as told in `file`'s `reported` map ({ reason: [sessions] }). -> true when this call is the first to
// tell it. Read-modify-write under its own lock (waits up to 1 s; a lock that cannot be had is fail-open: the update goes ahead
// unlocked rather than lose the report). The write is tmp + rename.
function claimInFile(file, sessionId, reason) {
  const release = lockFile(`${file}.lock`, 1000);
  try {
    let obj = readJson(file);
    if (!obj) {
      if (fs.existsSync(file)) return true; // unreadable record: do not clobber, just tell
      obj = {};
    }
    const reported = obj.reported && typeof obj.reported === 'object' && !Array.isArray(obj.reported) ? obj.reported : {};
    const list = Array.isArray(reported[reason]) ? reported[reason] : [];
    if (sessionId && list.includes(sessionId)) return false;
    if (sessionId) list.push(sessionId);
    delete reported[reason];
    reported[reason] = list.slice(-REPORTED_CAP); // most recently told reasons last
    for (const k of Object.keys(reported).slice(0, Math.max(0, Object.keys(reported).length - REASON_CAP))) delete reported[k];
    obj.reported = reported;
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeAtomic(file, `${JSON.stringify(obj)}\n`); } catch (_error) { /* a failed memo only means a repeat */ }
    return true;
  } finally {
    if (release) release();
  }
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
    return result.ok === true ? { state: 'ok', launch: rec } : { state: 'failed', reason: String(result.reason || 'unknown reason'), kind: result.kind || null, launch: rec };
  }
  if (rec.pid === null || rec.pid === undefined) {
    // The parent has not written the pid yet (it is between the two writes): no verdict, unless it died there.
    const age = Date.now() - Date.parse(rec.started_at);
    if (Number.isFinite(age) && age < PID_GAP_MS) return { state: 'pending', launch: rec };
    return { state: 'failed', reason: NO_REPORT_REASON, launch: rec };
  }
  if (launcherAlive(rec)) return { state: 'pending', launch: rec };
  return { state: 'failed', reason: NO_REPORT_REASON, launch: rec };
}

// Parent, BEFORE the spawn (the caller holds lockLaunch). Removes older results, keeps who was already told about which reason.
// The record file is shared with claimInFile, so it is read and written under the same `.lock`.
// -> { launch_id, result_path, record }
function beginLaunch(dir, now = new Date()) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(RESULT_PREFIX) && name.endsWith(RESULT_SUFFIX)) { try { fs.unlinkSync(path.join(dir, name)); } catch (_e) { /* best effort */ } }
    }
  } catch (_error) { /* dir listing is best effort */ }
  const file = path.join(dir, LAUNCH_FILE);
  const release = lockFile(`${file}.lock`, 1000);
  try {
    const prev = readJson(file);
    const launch_id = newLaunchId();
    const record = {
      launch_id,
      pid: null,
      pid_start: null,
      started_at: now.toISOString(),
      result_path: resultPathOf(dir, launch_id),
      reported: prev && prev.reported && typeof prev.reported === 'object' ? prev.reported : {},
    };
    writeAtomic(file, `${JSON.stringify(record)}\n`);
    return { launch_id, result_path: record.result_path, record };
  } finally {
    if (release) release();
  }
}

// Parent, AFTER the spawn. Updates only this launch's pid fields in the CURRENT record (memos written meanwhile are kept); a record
// that is no longer this launch's is left alone.
function recordPid(dir, record, pid) {
  record.pid = Number.isInteger(pid) ? pid : null;
  record.pid_start = Number.isInteger(pid) ? pidStartOf(pid) : null;
  const file = path.join(dir, LAUNCH_FILE);
  const release = lockFile(`${file}.lock`, 1000);
  try {
    const cur = readJson(file);
    if (!cur || cur.launch_id !== record.launch_id) return;
    cur.pid = record.pid;
    cur.pid_start = record.pid_start;
    writeAtomic(file, `${JSON.stringify(cur)}\n`);
  } finally {
    if (release) release();
  }
}

// Either side. file = the launch's result path.
function writeResult(file, launchId, ok, reason, now = new Date(), kind = null) {
  const body = { launch_id: launchId, ok: Boolean(ok), reason: ok ? null : String(reason || 'unknown reason'), at: now.toISOString() };
  if (kind) body.kind = String(kind); // 'live_dir': the failure is the live directory's, so the hook words it that way for every session
  writeAtomic(file, `${JSON.stringify(body)}\n`);
}

// Marks (session, reason) as told in the launch record.
function claimReport(dir, sessionId, reason) {
  return claimInFile(path.join(dir, LAUNCH_FILE), sessionId, reason);
}

module.exports = {
  LAUNCH_FILE, RESULT_PREFIX, RESULT_SUFFIX, REPORTED_CAP, NO_REPORT_REASON,
  resultPathOf, newLaunchId, pidStartOf, readLaunch, readLaunchReport, beginLaunch, recordPid, writeResult, claimReport, claimInFile, lockLaunch, lockFile,
};
