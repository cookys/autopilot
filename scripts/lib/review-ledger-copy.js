'use strict';

// review-ledger-copy.js — opt-in copy of a hetero-review ledger into layout A.
// Node built-ins only. Throws Error on failure. Never calls process.exit.
// Finalize is wired in. It writes to the archive only when a dir is configured
// (env or config key); unset means nothing is written. The caller (CLI or the
// finalize hook) catches every error. The archive writes only when a dir is configured.
//
// Archive off: AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR unset and review_ledger_archive.dir
// unset or empty. It writes nothing. The config file is still read to learn whether
// the key is set. Env wins over the operator config file
// (scripts/lib/config-path.js). include_diff default false
// (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF). warn_mb default 500
// (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB). rotate_after_months default 2
// (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS). rotate_remove_source
// default false (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE).
// AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS sleeps after each phase copy and
// again between the archived chain.json read and its write, inside the ledger
// lock. The chain gap makes a lockless copy drop one phase. Unset has no effect.
// Test-only, not a user knob. Honoured only when
// AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY is exactly "1". Any other
// value, including unset, ignores the delay (no sleep).
// AUTOPILOT_REVIEW_LEDGER_LOCK_STALE_MS, when a positive number, replaces the
// 30000ms lock stale threshold. AUTOPILOT_REVIEW_LEDGER_REPO_ROOT points a
// temp copy of this file back at the repo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function repoRoot() {
  return process.env.AUTOPILOT_REVIEW_LEDGER_REPO_ROOT || path.resolve(__dirname, '..', '..');
}

const { configPath } = require(path.join(repoRoot(), 'scripts/lib/config-path.js'));
const { repoIdentity } = require(path.join(repoRoot(), 'src/status/task-runtime.js'));

const PHASE_FILES = ['findings.json', 'dispositions.json', 'range.json'];

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function testDelayMs() {
  // Test-only, not a user knob. Same shape as the subagent-budget mutant gate.
  if (process.env.AUTOPILOT_TEST_ALLOW_REVIEW_LEDGER_COPY_DELAY !== '1') return 0;
  const n = Number(process.env.AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toolVersion() {
  try {
    const raw = fs.readFileSync(path.join(repoRoot(), '.claude-plugin/plugin.json'), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' && version ? version : 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

function parseBool(value) {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '' || s === '0' || s === 'false' || s === 'no') return false;
  return null;
}

function parseWarn(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parsePositiveInt(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function dirFrom(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('review_ledger_archive.dir must be a string');
  return value === '' ? null : value;
}

// "~" and "~/" expand against home. Anything still not absolute is a
// configuration error: callers fail open and write nothing.
function expandArchiveDir(value, homeDir) {
  if (value == null) return null;
  let dir = value;
  if (dir === '~') dir = homeDir;
  else if (dir.startsWith('~/')) dir = path.join(homeDir, dir.slice(2));
  if (!dir.startsWith('/')) {
    throw new Error(`archive dir is misconfigured: ${value}`);
  }
  return dir;
}

function resolveArchiveConfig(home) {
  const homeDir = home || os.homedir();
  const env = process.env;
  const envDirSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR');
  const envDiffSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF');
  const envWarnSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB');
  const envRotateSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS');
  const envRemoveSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE');
  let block = {};
  if (!envDirSet || !envDiffSet || !envWarnSet || !envRotateSet || !envRemoveSet) {
    const cp = configPath({ home: homeDir, env });
    if (fs.existsSync(cp)) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(cp, 'utf8'));
      } catch (e) {
        throw new Error(`cannot parse operator config: ${e.message}`);
      }
      if (parsed && parsed.review_ledger_archive != null) {
        if (typeof parsed.review_ledger_archive !== 'object' || Array.isArray(parsed.review_ledger_archive)) {
          throw new Error('review_ledger_archive is not an object');
        }
        block = parsed.review_ledger_archive;
      }
    }
  }
  const dir = expandArchiveDir(envDirSet ? dirFrom(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR) : dirFrom(block.dir), homeDir);
  const includeRaw = envDiffSet ? parseBool(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF) : parseBool(block.include_diff);
  const warnRaw = envWarnSet ? parseWarn(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB) : parseWarn(block.warn_mb);
  const rotateRaw = envRotateSet
    ? parsePositiveInt(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS)
    : parsePositiveInt(block.rotate_after_months);
  const removeRaw = envRemoveSet
    ? parseBool(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE)
    : parseBool(block.rotate_remove_source);
  return {
    dir,
    includeDiff: includeRaw === null ? false : includeRaw,
    warnMb: warnRaw === null ? 500 : warnRaw,
    rotateAfterMonths: rotateRaw === null ? 2 : rotateRaw,
    rotateRemoveSource: removeRaw === null ? false : removeRaw,
  };
}

// Main checkout name from repoIdentity (`git-common-dir:<realpath>`). A common
// dir named .git uses its parent (the working repository). Anything else,
// including a bare repo, uses that directory's basename with one trailing
// .git removed. When identity is missing, repoBucket still throws; a value
// that is not git-common-dir keeps the repoDir basename.
function bucketNameFromIdentity(id, repoDir) {
  if (typeof id === 'string' && id.startsWith('git-common-dir:')) {
    const common = id.slice('git-common-dir:'.length);
    const base = path.basename(common);
    if (base === '.git') return path.basename(path.dirname(common));
    return base.endsWith('.git') ? base.slice(0, -4) : base;
  }
  return path.basename(path.resolve(repoDir));
}

function repoBucket(repoDir) {
  const id = repoIdentity(repoDir);
  if (!id) throw new Error(`repo identity unavailable for ${repoDir}`);
  const prefix = crypto.createHash('sha1').update(id).digest('hex').slice(0, 8);
  return `${bucketNameFromIdentity(id, repoDir)}-${prefix}`;
}

// A phase token from --phase or copyLedger's phases list. Reject before any
// ledger read or archive write. ".." anywhere, a separator, empty, or absolute.
function assertSafePhase(name) {
  const s = String(name);
  if (s === '' || path.isAbsolute(s) || s.includes('/') || s.includes('\\') || s.includes('..')) {
    throw new Error('unsafe phase name');
  }
}

function phaseNames(ledgerDir) {
  let names;
  try {
    names = fs.readdirSync(ledgerDir);
  } catch (e) {
    throw new Error(`cannot read ledger: ${e.message}`);
  }
  return names.filter((n) => {
    if (!n.startsWith('review-')) return false;
    let st;
    try { st = fs.lstatSync(path.join(ledgerDir, n)); } catch (_e) { return false; }
    return st.isDirectory() && !st.isSymbolicLink();
  }).sort();
}

// review-* entries that are symlinks (or unstatable). Not followed.
function symlinkReviewPhases(ledgerDir) {
  let names;
  try {
    names = fs.readdirSync(ledgerDir);
  } catch (e) {
    throw new Error(`cannot read ledger: ${e.message}`);
  }
  const out = [];
  for (const n of names) {
    if (!n.startsWith('review-')) continue;
    let st;
    try { st = fs.lstatSync(path.join(ledgerDir, n)); } catch (_e) { out.push(n); continue; }
    if (st.isSymbolicLink()) out.push(n);
  }
  return out.sort();
}

function readChain(ledgerDir, phaseName) {
  const p = path.join(ledgerDir, phaseName, 'chain.json');
  try {
    const chain = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(chain)) throw new Error('not an array');
    return chain;
  } catch (e) {
    throw new Error(`cannot read ${p}: ${e.message}`);
  }
}

function stampFromChain(g1) {
  const ts = g1.collected_at || g1.at;
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) return ts;
  return null;
}

function generation1Entry(ledgerDir, phaseName) {
  const g1 = readChain(ledgerDir, phaseName).find((e) => e && e.generation === 1);
  if (!g1) throw new Error('chain.json has no generation 1 entry');
  return g1;
}

// sha1 hex of g1/range.json bytes (base and head). Findings bytes are the
// fallback. Missing both throws. The key ignores mtime, path, and copy method,
// and later generations do not rewrite g1/range.json, so the key stays put.
function phaseContentKey(ledgerDir, phaseName) {
  const rangePath = path.join(ledgerDir, phaseName, 'g1', 'range.json');
  const findingsPath = path.join(ledgerDir, phaseName, 'g1', 'findings.json');
  let bytes;
  if (fs.existsSync(rangePath)) bytes = fs.readFileSync(rangePath);
  else if (fs.existsSync(findingsPath)) bytes = fs.readFileSync(findingsPath);
  else throw new Error('phase content missing: no g1/range.json or g1/findings.json');
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

function localCalendarDate(now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Date for a new id: collected_at, then at, from generation 1 of the phases
// being archived (earliest when several have a stamp). When none do, the local
// calendar date of this first archive. Callers store it and look the id up
// afterwards, so the clock is never read again for this ledger.
function dateSource(ledgerDir, phases) {
  let best = null;
  for (const name of phases) {
    const ts = stampFromChain(generation1Entry(ledgerDir, name));
    if (ts && (best === null || ts < best)) best = ts;
  }
  if (best) return best;
  return localCalendarDate(new Date());
}

function phaseKeyMap(ledgerDir, phases) {
  const map = {};
  for (const name of phases) map[name] = phaseContentKey(ledgerDir, name);
  return map;
}

function fileReadable(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    fs.readFileSync(filePath);
    return true;
  } catch (_e) {
    return false;
  }
}

// A phase is copyable when it has chain.json and a readable g1/range.json or
// g1/findings.json. Missing optional files (findings, dispositions, seats)
// stay optional. An empty or aborted directory is not copyable.
function phaseCopyable(ledgerDir, phaseName) {
  const chainPath = path.join(ledgerDir, phaseName, 'chain.json');
  let chainStat;
  try { chainStat = fs.lstatSync(chainPath); } catch (_e) { return false; }
  if (chainStat.isSymbolicLink() || !chainStat.isFile()) return false;
  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
  } catch (_e) {
    return false;
  }
  if (!Array.isArray(chain) || !chain.some((e) => e && e.generation === 1)) return false;
  const rangePath = path.join(ledgerDir, phaseName, 'g1', 'range.json');
  const findingsPath = path.join(ledgerDir, phaseName, 'g1', 'findings.json');
  return fileReadable(rangePath) || fileReadable(findingsPath);
}

// Full-ledger enumeration only. An explicit phase list (the finalize hook)
// does not come through here, so a bad phase still throws from phaseContentKey.
function partitionLedgerPhases(ledgerDir, names) {
  const usable = [];
  const skipped = [];
  for (const name of names) {
    if (phaseCopyable(ledgerDir, name)) usable.push(name);
    else skipped.push(name);
  }
  return { usable, skipped };
}

// A chain reset rewrites g1/range.json, so the phase key changes. The same
// source realpath still reuses this directory (the reset stays with the ledger
// that already lived here). A different path with the new bytes does not match
// phase_keys or source_realpath and gets a new ledger-id. phase_keys is a
// lookup index, not a claim: no hash chain, signature, or attestation.
function metaMatches(meta, sourceRealpath, keys) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.source_realpath === sourceRealpath) return true;
  const stored = meta.phase_keys;
  if (!stored || typeof stored !== 'object') return false;
  for (const name of Object.keys(keys)) {
    if (stored[name] === keys[name]) return true;
  }
  return false;
}

function findReusable(archiveDir, bucket, sourceRealpath, keys) {
  const bucketDir = path.join(archiveDir, bucket);
  let months;
  try { months = fs.readdirSync(bucketDir); } catch (_e) { return null; }
  for (const month of months) {
    if (month.startsWith('.')) continue;
    const monthDir = path.join(bucketDir, month);
    let st;
    try { st = fs.statSync(monthDir); } catch (_e) { continue; }
    if (!st.isDirectory()) continue;
    let ids;
    try { ids = fs.readdirSync(monthDir); } catch (_e) { continue; }
    for (const ledgerId of ids) {
      if (ledgerId.startsWith('.')) continue;
      const metaPath = path.join(monthDir, ledgerId, 'archive.json');
      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_e) { continue; }
      if (!metaMatches(meta, sourceRealpath, keys)) continue;
      return { month, ledgerId, meta };
    }
  }
  return null;
}

function buildLedgerId(ledgerDir, repoDir, archiveDir, phases) {
  const liveRealpath = fs.realpathSync(ledgerDir);
  const names = (phases && phases.length ? phases : phaseNames(liveRealpath)).slice().sort();
  if (names.length === 0) throw new Error('ledger has no review-<phase> directory');
  const keys = phaseKeyMap(liveRealpath, names);
  const bucket = repoBucket(repoDir);
  if (archiveDir) {
    const reused = findReusable(archiveDir, bucket, liveRealpath, keys);
    if (reused) {
      return {
        liveRealpath,
        sourceRealpath: reused.meta.source_realpath,
        firstCollectAt: reused.meta.first_collect_at,
        bucket,
        month: reused.month,
        ledgerId: reused.ledgerId,
        repoIdentity: reused.meta.repo_identity || repoIdentity(repoDir),
        phaseKeys: Object.assign({}, reused.meta.phase_keys || {}, keys),
        callKeys: keys,
      };
    }
  }
  const ts = dateSource(liveRealpath, names);
  const date = ts.slice(0, 10);
  const hash = keys[names[0]].slice(0, 8);
  return {
    liveRealpath,
    sourceRealpath: liveRealpath,
    firstCollectAt: ts,
    bucket,
    month: date.slice(0, 7),
    ledgerId: `${date}-${bucket}-${hash}`,
    repoIdentity: repoIdentity(repoDir),
    phaseKeys: keys,
    callKeys: keys,
  };
}

function archiveMeta(id, importedFrom) {
  return {
    source_realpath: id.sourceRealpath,
    repo_identity: id.repoIdentity,
    first_collect_at: id.firstCollectAt,
    imported_from: importedFrom,
    tool_version: toolVersion(),
    phase_keys: id.phaseKeys,
  };
}

// Create dir and any missing parents. Only directories this call actually
// created are chmod 0700. An existing directory is left untouched.
function mkdirPrivate(dir) {
  const created = [];
  const abs = path.resolve(dir);
  if (fs.existsSync(abs)) return created;
  const parent = path.dirname(abs);
  if (parent !== abs) created.push(...mkdirPrivate(parent));
  try {
    fs.mkdirSync(abs, { mode: 0o700 });
  } catch (e) {
    if (!e || e.code !== 'EEXIST') throw e;
    return created;
  }
  try { fs.chmodSync(abs, 0o700); } catch (_e) { /* raced away */ }
  created.push(abs);
  return created;
}

function writeAtomic(target, content) {
  const dir = path.dirname(target);
  mkdirPrivate(dir);
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o600);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* already gone */ }
    throw err;
  }
}

function copyFilePrivate(src, dest) {
  writeAtomic(dest, fs.readFileSync(src));
}

function enforceModes(root) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      fs.chmodSync(cur, 0o700);
      for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
    } else if (st.isFile()) {
      fs.chmodSync(cur, 0o600);
    }
  }
}

// mkdir lock per ledger-id. Same shape as acquireChainLock: owner token, bounded
// wait, stale tombstone renamed aside. Timeout throws. release() removes the lock
// only while this owner's token is still in the owner file.
function lockStaleMs() {
  const n = Number(process.env.AUTOPILOT_REVIEW_LEDGER_LOCK_STALE_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

// Owner-file mtime is the holder's last refresh. The lock directory mtime is
// used only when the owner file is missing.
function lockAgeMs(lockDir) {
  const ownerFile = path.join(lockDir, 'owner');
  try {
    return Date.now() - fs.statSync(ownerFile).mtimeMs;
  } catch (_e) {
    try { return Date.now() - fs.statSync(lockDir).mtimeMs; } catch (_e2) { return null; }
  }
}

function refreshLockOwner(ownerFile) {
  const now = new Date();
  try {
    fs.utimesSync(ownerFile, now, now);
  } catch (_e) {
    try {
      const token = fs.readFileSync(ownerFile, 'utf8');
      fs.writeFileSync(ownerFile, token, { mode: 0o600 });
    } catch (_e2) { /* holder lost the file */ }
  }
}

function acquireLedgerLock(lockDir) {
  const timeoutMs = 15000;
  const staleMs = lockStaleMs();
  const ownerFile = path.join(lockDir, 'owner');
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  mkdirPrivate(path.dirname(lockDir));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      try { fs.writeFileSync(ownerFile, token, { mode: 0o600 }); } catch (_e) { /* breaker won */ }
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      const ageMs = lockAgeMs(lockDir);
      if (ageMs == null) continue;
      if (ageMs > staleMs) {
        const tomb = `${lockDir}.dead-${token}`;
        try { fs.renameSync(lockDir, tomb); } catch (_e) { continue; }
        const tombAge = lockAgeMs(tomb);
        if (tombAge != null && tombAge <= staleMs) {
          try { fs.renameSync(tomb, lockDir); continue; } catch (_e) { /* discard */ }
        }
        try { fs.rmSync(tomb, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for ledger lock ${lockDir}`);
      }
      sleepMs(25);
    }
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener('exit', release);
    try {
      if (fs.readFileSync(ownerFile, 'utf8') !== token) return;
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (_e) { /* already gone */ }
  };
  process.on('exit', release);
  return release;
}

function withLedgerLock(lockDir, fn) {
  const release = acquireLedgerLock(lockDir);
  try {
    return fn();
  } finally {
    release();
  }
}

function copyRealFile(src, dest, skipped, label) {
  let st;
  try { st = fs.lstatSync(src); } catch (_e) { return; }
  if (st.isSymbolicLink()) {
    skipped.push(label);
    return;
  }
  if (!st.isFile()) return;
  copyFilePrivate(src, dest);
}

function copyPhaseFiles(ledgerDir, phaseName, destPhase, includeDiff) {
  const skipped = [];
  const srcPhase = path.join(ledgerDir, phaseName);
  let phaseSt;
  try { phaseSt = fs.lstatSync(srcPhase); } catch (_e) { return skipped; }
  if (phaseSt.isSymbolicLink()) {
    skipped.push(phaseName);
    return skipped;
  }
  copyRealFile(path.join(srcPhase, 'chain.json'), path.join(destPhase, 'chain.json'), skipped, `${phaseName}/chain.json`);
  const receiptName = `receipt-${phaseName.slice('review-'.length)}.json`;
  const receiptSrc = path.join(ledgerDir, receiptName);
  copyRealFile(receiptSrc, path.join(path.dirname(destPhase), receiptName), skipped, receiptName);
  let children = [];
  try { children = fs.readdirSync(srcPhase); } catch (_e) { return skipped; }
  const gens = children.filter((n) => /^g[0-9]+$/.test(n)).sort();
  for (const g of gens) {
    const srcG = path.join(srcPhase, g);
    let gst;
    try { gst = fs.lstatSync(srcG); } catch (_e) { continue; }
    if (gst.isSymbolicLink()) {
      skipped.push(`${phaseName}/${g}`);
      continue;
    }
    if (!gst.isDirectory()) continue;
    const destG = path.join(destPhase, g);
    mkdirPrivate(destG);
    for (const base of PHASE_FILES) {
      copyRealFile(path.join(srcG, base), path.join(destG, base), skipped, `${phaseName}/${g}/${base}`);
    }
    let seatNames = [];
    try { seatNames = fs.readdirSync(srcG); } catch (_e) { seatNames = []; }
    for (const name of seatNames) {
      if (/^seat-.*\.json$/.test(name)) {
        copyRealFile(path.join(srcG, name), path.join(destG, name), skipped, `${phaseName}/${g}/${name}`);
      }
    }
    if (includeDiff) {
      copyRealFile(path.join(srcG, 'diff.txt'), path.join(destG, 'diff.txt'), skipped, `${phaseName}/${g}/diff.txt`);
    }
  }
  return skipped;
}

function entriesFromPhase(phase, chain) {
  const short = phase.slice('review-'.length);
  return chain.filter((e) => e && typeof e === 'object').map((e) => Object.assign({}, e, { phase: short }));
}

function mergeEntries(existing, incoming) {
  const map = new Map();
  for (const e of existing) {
    if (e && e.phase != null && e.generation != null) map.set(`${e.phase}\0${e.generation}`, e);
  }
  for (const e of incoming) map.set(`${e.phase}\0${e.generation}`, e);
  return [...map.values()].sort((a, b) => {
    if (a.phase === b.phase) return a.generation - b.generation;
    return a.phase < b.phase ? -1 : 1;
  });
}

function copyLedger(opts) {
  const o = opts || {};
  if (Array.isArray(o.phases)) {
    for (const p of o.phases) assertSafePhase(p);
  }
  const cfg = resolveArchiveConfig(o.home);
  if (!cfg.dir) return { copied: false };
  if (!o.ledgerDir) throw new Error('ledgerDir is required');
  if (!o.repoDir) throw new Error('repoDir is required');
  const createdDirs = [];
  createdDirs.push(...mkdirPrivate(cfg.dir));
  const explicit = Array.isArray(o.phases);
  let selected = explicit
    ? o.phases.map((p) => (String(p).startsWith('review-') ? String(p) : `review-${p}`))
    : phaseNames(fs.realpathSync(o.ledgerDir));
  if (selected.length === 0) throw new Error('no phase selected');
  const liveForSelect = fs.realpathSync(o.ledgerDir);
  const known = phaseNames(liveForSelect);
  for (const name of selected) {
    if (!known.includes(name)) throw new Error(`unknown phase ${name}`);
  }
  // Identity (phase_keys, source_realpath lookup) uses only phases that are
  // copied. A skipped directory never enters the ledger-id.
  let skipped = [];
  if (!explicit) {
    const part = partitionLedgerPhases(liveForSelect, selected);
    selected = part.usable;
    skipped = symlinkReviewPhases(liveForSelect).concat(part.skipped);
    if (selected.length === 0) {
      throw new Error('phase content missing: no g1/range.json or g1/findings.json');
    }
  }
  // Id selection cannot use the per-ledger lock: two copies have different
  // realpaths, and two phases can both miss archive.json. One fixed-name lock
  // inside the repo bucket serializes lookup and the archive.json update.
  const bucket = repoBucket(o.repoDir);
  createdDirs.push(...mkdirPrivate(path.join(cfg.dir, bucket)));
  const idLock = path.join(cfg.dir, bucket, '.ledger-id.lock');
  let id;
  withLedgerLock(idLock, () => {
    id = buildLedgerId(o.ledgerDir, o.repoDir, cfg.dir, selected);
    const reserved = path.join(cfg.dir, id.bucket, id.month, id.ledgerId, 'archive.json');
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(reserved, 'utf8')); } catch (_e) { prev = null; }
    if (prev && prev.source_realpath) id.sourceRealpath = prev.source_realpath;
    if (prev && typeof prev.first_collect_at === 'string') id.firstCollectAt = prev.first_collect_at;
    if (prev && prev.repo_identity) id.repoIdentity = prev.repo_identity;
    id.phaseKeys = Object.assign({}, (prev && prev.phase_keys) || {}, id.callKeys);
    const imported = prev && prev.imported_from != null
      ? prev.imported_from
      : (Object.prototype.hasOwnProperty.call(o, 'importedFrom') ? o.importedFrom : null);
    id.importedFrom = imported;
    writeAtomic(reserved, JSON.stringify(archiveMeta(id, imported), null, 2) + '\n');
  });
  const dest = path.join(cfg.dir, id.bucket, id.month, id.ledgerId);
  const destLock = `${dest}.lock`;
  withLedgerLock(destLock, () => {
    const ownerFile = path.join(destLock, 'owner');
    createdDirs.push(...mkdirPrivate(path.dirname(dest)));
    createdDirs.push(...mkdirPrivate(dest));
    let incoming = [];
    for (const name of selected) {
      skipped = skipped.concat(copyPhaseFiles(id.liveRealpath, name, path.join(dest, name), cfg.includeDiff) || []);
      incoming = incoming.concat(entriesFromPhase(name, readChain(id.liveRealpath, name)));
      const delay = testDelayMs();
      if (delay) sleepMs(delay);
      refreshLockOwner(ownerFile);
    }
    const combinedPath = path.join(dest, 'chain.json');
    let existing = [];
    if (fs.existsSync(combinedPath)) {
      existing = JSON.parse(fs.readFileSync(combinedPath, 'utf8'));
      if (!Array.isArray(existing)) throw new Error('archived chain.json is not an array');
    }
    // Test seam: both lockless copiers read before either writes.
    const chainDelay = testDelayMs();
    if (chainDelay) sleepMs(chainDelay);
    const merged = mergeEntries(existing, incoming);
    writeAtomic(combinedPath, JSON.stringify(merged, null, 2) + '\n');
    const metaPath = path.join(dest, 'archive.json');
    let onDisk = null;
    try { onDisk = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_e) { onDisk = null; }
    if (onDisk && onDisk.source_realpath) id.sourceRealpath = onDisk.source_realpath;
    if (onDisk && typeof onDisk.first_collect_at === 'string') id.firstCollectAt = onDisk.first_collect_at;
    if (onDisk && onDisk.repo_identity) id.repoIdentity = onDisk.repo_identity;
    id.phaseKeys = Object.assign({}, (onDisk && onDisk.phase_keys) || {}, id.callKeys);
    const imported = onDisk && onDisk.imported_from != null
      ? onDisk.imported_from
      : (Object.prototype.hasOwnProperty.call(o, 'importedFrom') ? o.importedFrom : null);
    writeAtomic(metaPath, JSON.stringify(archiveMeta(id, imported), null, 2) + '\n');
    enforceModes(dest);
    const seen = new Set();
    for (const d of createdDirs) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (d === dest || d.startsWith(dest + path.sep)) continue;
      try {
        const st = fs.lstatSync(d);
        if (st.isDirectory() && !st.isSymbolicLink()) fs.chmodSync(d, 0o700);
      } catch (_e) { /* already gone */ }
    }
  });
  return { copied: true, dest, skipped };
}

function describeArchive(home) {
  const cfg = resolveArchiveConfig(home);
  if (!cfg.dir) return { off: true };
  let ledgers = 0;
  let bytes = 0;
  const stack = [];
  if (fs.existsSync(cfg.dir)) stack.push(cfg.dir);
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch (_e) { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(cur); } catch (_e) { continue; }
      if (names.includes('archive.json')) ledgers += 1;
      for (const name of names) stack.push(path.join(cur, name));
    } else if (st.isFile()) {
      bytes += st.size;
    }
  }
  const limit = cfg.warnMb * 1024 * 1024;
  return { off: false, dir: cfg.dir, ledgers, bytes, warnMb: cfg.warnMb, warn: bytes > limit };
}

module.exports = {
  resolveArchiveConfig,
  buildLedgerId,
  repoBucket,
  copyLedger,
  describeArchive,
  withLedgerLock,
};
