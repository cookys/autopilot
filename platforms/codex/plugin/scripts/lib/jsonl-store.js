'use strict';

// Shared JSONL-store concurrency primitives for autopilot's Node append-only stores.
//
// Consolidates the flock + PID-stale-breaker + atomic-append + monotonic-event_id logic
// that was copied byte-for-byte across engine-scorecard.js, engine-capability-state.js,
// and adjudicate-findings.js (2026-07-16 health audit, architecture lens — concurrency-
// correctness code copied N times is a lock bug in N places).
//
// CARVE-OUT: scripts/tree.js is deliberately NOT a consumer. Its lock design is genuinely
// different (JSON lock content with an ownership token, token-checked release, cross-host
// time-TTL staleness, a two-phase recovery-mutex steal, TREE_LOCK_TIMEOUT_MS override, and
// process.exit-on-failure). Forcing it through this bare-PID contract would change behavior
// its own suite observes. See the carve-out note at tree.js's acquireLock.
//
// Node built-ins only (Node >= 20.10).

const fs = require('fs');
const os = require('os');
const path = require('path');

function expandTilde(raw) {
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith(`~${path.sep}`)) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

// Pure-Node synchronous sleep (no child process — keeps the dependency-minimal premise).
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

// Liveness probe for a lock-file content string (a pid). An EMPTY / non-numeric /
// out-of-range value is a DEAD holder so a crashed-mid-write lock stays stealable.
function pidStringAlive(content) {
  const pid = Number(content);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence probe, sends nothing
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true; // exists but owned by another user → assume live
    return false; // ESRCH etc → dead → stale
  }
}

function lockHolderAlive(lockFile) {
  let content;
  try {
    content = fs.readFileSync(lockFile, 'utf8').trim();
  } catch {
    return false; // vanished/unreadable → not a live holder
  }
  return pidStringAlive(content);
}

// Prewrite the PID in a private same-directory candidate, then publish the canonical
// lock path with an atomic hard link. A competing process can therefore never observe
// the live holder's lock between O_EXCL creation and the PID write and misclassify that
// transient empty file as stale.
function createPidLock(lockFile) {
  const candidate = `${lockFile}.pending.${process.pid}.${process.hrtime.bigint()}`;
  try {
    fs.writeFileSync(candidate, String(process.pid), { flag: 'wx', mode: 0o600 });
    fs.linkSync(candidate, lockFile);
  } finally {
    try { fs.unlinkSync(candidate); } catch { }
  }
}

// Exclusive lock file holding the writer's PID, with a PID-liveness
// STALE-LOCK BREAKER (identity-checked atomic rename-steal) so a crashed writer cannot
// permanently wedge appends. Preserves the gpt-5.5 P6 F1 r3 steal semantics: a dead
// holder is broken with an IDENTITY-CHECKED atomic steal (renameSync to a unique name;
// only the recoverer whose stolen inode still matches the exact dead holder removes it;
// anything else is restored via linkSync and retried) so two writers never enter the
// critical section, while a genuinely live holder is waited on under exponential backoff
// bounded by the deadline.
function acquireLock(opts) {
  const {
    storeDir,
    lockFile,
    name = 'store',
    timeoutMs = 8000,
    initialDelayMs = 5,
    maxDelayMs = 50,
  } = opts;
  ensureDir(storeDir);
  const deadline = Date.now() + timeoutMs;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      createPidLock(lockFile);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder;
      try { holder = fs.readFileSync(lockFile, 'utf8').trim(); } catch { continue; }
      if (!pidStringAlive(holder)) {
        const stolen = `${lockFile}.stale.${process.pid}.${process.hrtime.bigint()}`;
        try {
          fs.renameSync(lockFile, stolen);
          let stolenContent = '';
          try { stolenContent = fs.readFileSync(stolen, 'utf8').trim(); } catch { }
          if (stolenContent === holder && !pidStringAlive(stolenContent)) {
            fs.unlinkSync(stolen);
          } else {
            try { fs.linkSync(stolen, lockFile); } catch { }
            try { fs.unlinkSync(stolen); } catch { }
          }
        } catch { /* lost the steal race (ENOENT) — retry from the top */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${name} lock (held by a live process)`);
      }
      sleepMs(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}

function releaseLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Ignore stale lock cleanup failures.
  }
}

function withWriteLock(opts, callback) {
  acquireLock(opts);
  try {
    return callback();
  } finally {
    releaseLock(opts.lockFile);
  }
}

function appendRow(storeFile, row) {
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(storeFile, line, { mode: 0o600 });
}

function toEventId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function maxEventId(rows) {
  let max = 0;
  for (const row of rows) {
    const id = toEventId(row.event_id);
    if (id !== null && id > max) max = id;
  }
  return max;
}

module.exports = {
  expandTilde,
  ensureDir,
  sleepMs,
  pidStringAlive,
  lockHolderAlive,
  acquireLock,
  releaseLock,
  withWriteLock,
  appendRow,
  toEventId,
  maxEventId,
};
