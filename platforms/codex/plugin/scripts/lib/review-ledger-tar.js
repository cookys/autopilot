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
        const finalName = path.join(bucketDir, `${month}.tar.gz`);
        const tmp = path.join(bucketDir, `${month}.tar.gz.tmp-${process.pid}`);
        try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
        const created = runTar(['-czf', tmp, '-C', bucketDir, month]);
        if (created.missing) {
          tarMissing = true;
          warnings.push('review-ledger-archive: warning: tar is not available');
          try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
          lines.push(`warned ${label}`);
          warned += 1;
          continue;
        }
        if (!created.ok) {
          try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
          warnings.push(`review-ledger-archive: warning: tar failed for ${label}`);
          lines.push(`warned ${label}`);
          warned += 1;
          continue;
        }
        const listedRun = runTar(['-tzf', tmp]);
        const sourceCount = countRegularFiles(monthDir);
        const listed = listedRun.ok ? countTarRegular(listedRun.stdout) : -1;
        if (listed !== sourceCount) {
          try { fs.unlinkSync(tmp); } catch (_e) { /* absent */ }
          warnings.push(`review-ledger-archive: warning: tar list count mismatch for ${label}`);
          lines.push(`warned ${label}`);
          warned += 1;
          continue;
        }
        fs.renameSync(tmp, finalName);
        if (remove) fs.rmSync(monthDir, { recursive: true, force: true });
        lines.push(`rotated ${label}`);
        rotated += 1;
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
};
