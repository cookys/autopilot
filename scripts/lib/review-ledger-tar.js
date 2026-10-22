'use strict';

// review-ledger-tar.js — manual rotate for the review-ledger archive.
// Compresses complete month directories of layout A into <bucket>/<YYYY-MM>.tar.gz.
// Never called from a hook or from finalize. The caller catches errors.
// Month age uses the local calendar. `now` is injectable. The CLI honours
// AUTOPILOT_TEST_NOW only when AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_ARCHIVE_NOW=1.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { withLedgerLock } = require('./review-ledger-copy');

function monthNameOk(name) {
  const m = /^(\d{4})-(\d{2})$/.exec(name);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

// Strictly older than n calendar months, and not the current month
// (the current month has a difference of 0).
function monthPastAge(name, now, n) {
  if (!monthNameOk(name)) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(name);
  const diff = (now.getFullYear() * 12 + now.getMonth()) - (Number(m[1]) * 12 + (Number(m[2]) - 1));
  return diff > n;
}

function isRealDir(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (_e) { return false; }
  return st.isDirectory() && !st.isSymbolicLink();
}

function tarExists(bucketDir, month) {
  try {
    const st = fs.lstatSync(path.join(bucketDir, `${month}.tar.gz`));
    return st.isFile() || st.isSymbolicLink();
  } catch (_e) {
    return false;
  }
}

function eachBucket(archiveDir, fn) {
  if (!isRealDir(archiveDir)) return;
  let names = [];
  try { names = fs.readdirSync(archiveDir); } catch (_e) { return; }
  names.sort();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const bucketDir = path.join(archiveDir, name);
    if (!isRealDir(bucketDir)) continue;
    fn(name, bucketDir);
  }
}

function monthDirs(bucketDir) {
  let names = [];
  try { names = fs.readdirSync(bucketDir); } catch (_e) { return []; }
  return names.filter((name) => monthNameOk(name) && isRealDir(path.join(bucketDir, name))).sort();
}

function listRotatableMonths(archiveDir, now, rotateAfterMonths) {
  const out = [];
  eachBucket(archiveDir, (bucket, bucketDir) => {
    for (const month of monthDirs(bucketDir)) {
      if (!monthPastAge(month, now, rotateAfterMonths)) continue;
      if (tarExists(bucketDir, month)) continue;
      out.push({ bucket, month, bucketDir, monthDir: path.join(bucketDir, month) });
    }
  });
  return out;
}

function countRegularFiles(root) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch (_e) { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      // Lock directories are not archive payload. Skip the whole tree so the
      // source count matches a tar built with --exclude=*.lock.
      if (path.basename(cur).endsWith('.lock')) continue;
      let names = [];
      try { names = fs.readdirSync(cur); } catch (_e) { continue; }
      for (const name of names) stack.push(path.join(cur, name));
    } else if (st.isFile()) {
      n += 1;
    }
  }
  return n;
}

function countTarRegular(stdout) {
  let n = 0;
  for (const line of String(stdout || '').split('\n')) {
    if (!line || line.endsWith('/')) continue;
    n += 1;
  }
  return n;
}

function runTar(args) {
  const r = spawnSync('tar', args, { encoding: 'utf8' });
  if (r.error) {
    if (r.error.code === 'ENOENT') return { missing: true };
    return { fail: true, stderr: r.error.message };
  }
  if (r.status !== 0) return { fail: true, stderr: r.stderr || '' };
  return { ok: true, stdout: r.stdout || '' };
}

// True only when targetPath is not a symlink and its realpath sits strictly
// inside the archive root (a path-separator boundary, so <archive>-evil fails,
// and the archive root itself fails). Tests replace pruneTargetAllowed.
function pruneTargetAllowed(archiveDir, targetPath) {
  return pruneTargetAllowedChecked(archiveDir, targetPath);
}

function pruneTargetAllowedChecked(archiveDir, targetPath) {
  let st;
  try { st = fs.lstatSync(targetPath); } catch (_e) { return false; }
  if (st.isSymbolicLink()) return false;
  let rootReal;
  try { rootReal = fs.realpathSync(archiveDir); } catch (_e) { return false; }
  let targetReal;
  try { targetReal = fs.realpathSync(targetPath); } catch (_e) { return false; }
  if (targetReal === rootReal) return false;
  const boundary = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return targetReal.startsWith(boundary);
}

function pruneTargetRefusal(archiveDir, targetPath) {
  if (pruneTargetAllowed(archiveDir, targetPath)) return null;
  let st;
  try { st = fs.lstatSync(targetPath); } catch (_e) { return 'not under archive'; }
  if (st.isSymbolicLink()) return 'symlink';
  return 'not under archive';
}

function listPruneCandidates(archiveDir, now, n) {
  const out = [];
  eachBucket(archiveDir, (_bucket, bucketDir) => {
    for (const month of monthDirs(bucketDir)) {
      if (!monthPastAge(month, now, n)) continue;
      out.push(path.join(bucketDir, month));
    }
    let names = [];
    try { names = fs.readdirSync(bucketDir); } catch (_e) { names = []; }
    for (const name of names) {
      const m = /^(\d{4}-\d{2})\.tar\.gz$/.exec(name);
      if (!m || !monthPastAge(m[1], now, n)) continue;
      out.push(path.join(bucketDir, name));
    }
  });
  return out;
}

// Per-ledger locks live beside the ledger-id directory: <ledgerId>.lock.
// Derive one from every real ledger directory, and include a lock directory
// that is already present. Sorted full paths, so nested withLedgerLock calls
// always take the same order.
function ledgerLockPaths(monthDir) {
  let names = [];
  try { names = fs.readdirSync(monthDir); } catch (_e) { return []; }
  const locks = new Set();
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const child = path.join(monthDir, name);
    if (!isRealDir(child)) continue;
    if (name.endsWith('.lock')) locks.add(child);
    else locks.add(path.join(monthDir, `${name}.lock`));
  }
  return Array.from(locks).sort();
}

function withLedgerLocks(lockDirs, fn) {
  const sorted = lockDirs.slice().sort();
  const step = (i) => {
    if (i >= sorted.length) return fn();
    return withLedgerLock(sorted[i], () => step(i + 1));
  };
  return step(0);
}

function clearStaleTmpTars(bucketDir, month) {
  let names = [];
  try { names = fs.readdirSync(bucketDir); } catch (_e) { return; }
  const prefix = `${month}.tar.gz.tmp-`;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const p = path.join(bucketDir, name);
    let st;
    try { st = fs.lstatSync(p); } catch (_e) { continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    try { fs.unlinkSync(p); } catch (_e) { /* absent */ }
  }
}

function bucketDirForPrune(archiveDir, targetPath) {
  let rootReal;
  try { rootReal = fs.realpathSync(archiveDir); } catch (_e) { return null; }
  let targetReal;
  try { targetReal = fs.realpathSync(targetPath); } catch (_e) { return null; }
  const rel = path.relative(rootReal, targetReal);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 2) return null;
  return path.join(rootReal, parts[0]);
}

// Dry-run unless opts.execute. Refusals are decided for every target before
// any deletion. extra opts.targets are included (the CLI test seam).
function pruneArchive(opts) {
  const o = opts || {};
  const now = o.now instanceof Date && !Number.isNaN(o.now.getTime()) ? o.now : new Date();
  const extra = Array.isArray(o.targets) ? o.targets : [];
  const seen = new Set();
  const targets = [];
  for (const t of listPruneCandidates(o.dir, now, o.olderThanMonths).concat(extra)) {
    if (seen.has(t)) continue;
    seen.add(t);
    targets.push(t);
  }
  const refusals = [];
  const accepted = [];
  for (const t of targets) {
    const reason = pruneTargetRefusal(o.dir, t);
    if (reason) refusals.push(`review-ledger-archive: refused ${t} (${reason})`);
    else accepted.push(t);
  }
  if (refusals.length) return { refusals, lines: [] };
  accepted.sort();
  if (o.execute !== true) return { refusals: [], lines: accepted };
  const groups = new Map();
  const loose = [];
  for (const t of accepted) {
    const bucketDir = bucketDirForPrune(o.dir, t);
    if (!bucketDir) loose.push(t);
    else {
      if (!groups.has(bucketDir)) groups.set(bucketDir, []);
      groups.get(bucketDir).push(t);
    }
  }
  // Re-check immediately before each delete. A target that became a symlink
  // or left the archive after the up-front pass is a refusal: stop, delete
  // nothing further. Month directories also hold every per-ledger lock for
  // that month until the delete finishes. Tar files take no extra lock.
  const removeChecked = (t) => {
    const locks = monthNameOk(path.basename(t)) && isRealDir(t) ? ledgerLockPaths(t) : [];
    let refusal = null;
    withLedgerLocks(locks, () => {
      if (!pruneTargetAllowed(o.dir, t)) {
        refusal = `review-ledger-archive: refused ${t} (${pruneTargetRefusal(o.dir, t) || 'not under archive'})`;
        return;
      }
      fs.rmSync(t, { recursive: true });
    });
    return refusal;
  };
  let refusal = null;
  for (const bucketDir of Array.from(groups.keys()).sort()) {
    if (refusal) break;
    withLedgerLock(path.join(bucketDir, '.ledger-id.lock'), () => {
      for (const t of groups.get(bucketDir)) {
        if (refusal) return;
        refusal = removeChecked(t);
      }
    });
  }
  if (!refusal) {
    for (const t of loose) {
      refusal = removeChecked(t);
      if (refusal) break;
    }
  }
  if (refusal) return { refusals: [refusal], lines: [] };
  return { refusals: [], lines: accepted };
}

function rotateArchive(opts) {
  const o = opts || {};
  const now = o.now instanceof Date && !Number.isNaN(o.now.getTime()) ? o.now : new Date();
  const n = o.rotateAfterMonths;
  const remove = o.rotateRemoveSource === true;
  const lines = [];
  const warnings = [];
  let rotated = 0;
  let skipped = 0;
  let warned = 0;
  let tarMissing = false;

  eachBucket(o.dir, (bucket, bucketDir) => {
    withLedgerLock(path.join(bucketDir, '.ledger-id.lock'), () => {
      for (const month of monthDirs(bucketDir)) {
        const label = `${bucket}/${month}`;
        if (!monthPastAge(month, now, n)) continue;
        if (tarExists(bucketDir, month)) {
          lines.push(`skipped ${label}`);
          skipped += 1;
          continue;
        }
        if (tarMissing) {
          lines.push(`warned ${label}`);
          warned += 1;
          continue;
        }
        const monthDir = path.join(bucketDir, month);
        withLedgerLocks(ledgerLockPaths(monthDir), () => {
          clearStaleTmpTars(bucketDir, month);
          const finalName = path.join(bucketDir, `${month}.tar.gz`);
          const tmp = path.join(bucketDir, `${month}.tar.gz.tmp-${process.pid}`);
          try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
          const created = runTar(['--exclude=*.lock', '-czf', tmp, '-C', bucketDir, month]);
          if (created.missing) {
            tarMissing = true;
            warnings.push('review-ledger-archive: warning: tar is not available');
            try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
            lines.push(`warned ${label}`);
            warned += 1;
            return;
          }
          if (!created.ok) {
            try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
            warnings.push(`review-ledger-archive: warning: tar failed for ${label}`);
            lines.push(`warned ${label}`);
            warned += 1;
            return;
          }
          const listedRun = runTar(['-tzf', tmp]);
          const sourceCount = countRegularFiles(monthDir);
          const listed = listedRun.ok ? countTarRegular(listedRun.stdout) : -1;
          if (listed !== sourceCount) {
            try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
            warnings.push(`review-ledger-archive: warning: tar list count mismatch for ${label}`);
            lines.push(`warned ${label}`);
            warned += 1;
            return;
          }
          fs.renameSync(tmp, finalName);
          if (remove) fs.rmSync(monthDir, { recursive: true, force: true });
          lines.push(`rotated ${label}`);
          rotated += 1;
        });
      }
    });
  });
  lines.push(`summary: rotated=${rotated} skipped=${skipped} warned=${warned}`);
  return { lines, warnings, rotated, skipped, warned };
}

module.exports = {
  listRotatableMonths,
  rotateArchive,
  monthPastAge,
  pruneTargetAllowed,
  pruneTargetAllowedChecked,
  pruneArchive,
};
