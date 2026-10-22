'use strict';

// review-ledger-copy.js — opt-in copy of a hetero-review ledger into layout A.
// Node built-ins only. Throws Error on failure. Never calls process.exit.
// The caller (CLI or, later, the finalize hook) catches every error.
//
// Archive off: AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR unset and review_ledger_archive.dir
// unset or empty. Nothing is copied. Env wins over the operator config file
// (scripts/lib/config-path.js). include_diff default false
// (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF). warn_mb default 500
// (AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB).
// AUTOPILOT_REVIEW_LEDGER_COPY_TEST_DELAY_MS sleeps inside the ledger lock so a
// lockless copy loses a phase entry. AUTOPILOT_REVIEW_LEDGER_REPO_ROOT points a
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

function dirFrom(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('review_ledger_archive.dir must be a string');
  return value === '' ? null : value;
}

function resolveArchiveConfig(home) {
  const homeDir = home || os.homedir();
  const env = process.env;
  const envDirSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR');
  const envDiffSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF');
  const envWarnSet = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB');
  let block = {};
  if (!envDirSet || !envDiffSet || !envWarnSet) {
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
  const dir = envDirSet ? dirFrom(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR) : dirFrom(block.dir);
  const includeRaw = envDiffSet ? parseBool(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF) : parseBool(block.include_diff);
  const warnRaw = envWarnSet ? parseWarn(env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB) : parseWarn(block.warn_mb);
  return {
    dir,
    includeDiff: includeRaw === null ? false : includeRaw,
    warnMb: warnRaw === null ? 500 : warnRaw,
  };
}

function repoBucket(repoDir) {
  const id = repoIdentity(repoDir);
  if (!id) throw new Error(`repo identity unavailable for ${repoDir}`);
  const prefix = crypto.createHash('sha1').update(id).digest('hex').slice(0, 8);
  return `${path.basename(path.resolve(repoDir))}-${prefix}`;
}

function phaseNames(ledgerDir) {
  let names;
  try {
    names = fs.readdirSync(ledgerDir);
  } catch (e) {
    throw new Error(`cannot read ledger: ${e.message}`);
  }
  return names.filter((n) => n.startsWith('review-') && fs.statSync(path.join(ledgerDir, n)).isDirectory()).sort();
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

function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
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
function acquireLedgerLock(lockDir) {
  const timeoutMs = 15000;
  const staleMs = 30000;
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
      let ageMs;
      try { ageMs = Date.now() - fs.statSync(lockDir).mtimeMs; } catch (_e) { continue; }
      if (ageMs > staleMs) {
        const tomb = `${lockDir}.dead-${token}`;
        try { fs.renameSync(lockDir, tomb); } catch (_e) { continue; }
        let tombAge = Infinity;
        try { tombAge = Date.now() - fs.statSync(tomb).mtimeMs; } catch (_e) { /* gone */ }
        if (tombAge <= staleMs) {
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

function copyPhaseFiles(ledgerDir, phaseName, destPhase, includeDiff) {
  const srcPhase = path.join(ledgerDir, phaseName);
  copyFilePrivate(path.join(srcPhase, 'chain.json'), path.join(destPhase, 'chain.json'));
  const receiptName = `receipt-${phaseName.slice('review-'.length)}.json`;
  const receiptSrc = path.join(ledgerDir, receiptName);
  if (fs.existsSync(receiptSrc)) {
    copyFilePrivate(receiptSrc, path.join(path.dirname(destPhase), receiptName));
  }
  const gens = fs.readdirSync(srcPhase).filter((n) => /^g[0-9]+$/.test(n)).sort();
  for (const g of gens) {
    const srcG = path.join(srcPhase, g);
    if (!fs.statSync(srcG).isDirectory()) continue;
    const destG = path.join(destPhase, g);
    mkdirPrivate(destG);
    for (const base of PHASE_FILES) {
      const src = path.join(srcG, base);
      if (fs.existsSync(src)) copyFilePrivate(src, path.join(destG, base));
    }
    for (const name of fs.readdirSync(srcG)) {
      if (/^seat-.*\.json$/.test(name)) copyFilePrivate(path.join(srcG, name), path.join(destG, name));
    }
    if (includeDiff) {
      const diff = path.join(srcG, 'diff.txt');
      if (fs.existsSync(diff)) copyFilePrivate(diff, path.join(destG, 'diff.txt'));
    }
  }
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
  const cfg = resolveArchiveConfig(o.home);
  if (!cfg.dir) return { copied: false };
  if (!o.ledgerDir) throw new Error('ledgerDir is required');
  if (!o.repoDir) throw new Error('repoDir is required');
  mkdirPrivate(cfg.dir);
  const selected = o.phases
    ? o.phases.map((p) => (String(p).startsWith('review-') ? String(p) : `review-${p}`))
    : phaseNames(fs.realpathSync(o.ledgerDir));
  if (selected.length === 0) throw new Error('no phase selected');
  const known = phaseNames(fs.realpathSync(o.ledgerDir));
  for (const name of selected) {
    if (!known.includes(name)) throw new Error(`unknown phase ${name}`);
  }
  // Id selection cannot use the per-ledger lock: two copies have different
  // realpaths, and two phases can both miss archive.json. One fixed-name lock
  // inside the repo bucket serializes lookup and the archive.json update.
  const bucket = repoBucket(o.repoDir);
  mkdirPrivate(path.join(cfg.dir, bucket));
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
  withLedgerLock(`${dest}.lock`, () => {
    mkdirPrivate(dest);
    let incoming = [];
    for (const name of selected) {
      copyPhaseFiles(id.liveRealpath, name, path.join(dest, name), cfg.includeDiff);
      incoming = incoming.concat(entriesFromPhase(name, readChain(id.liveRealpath, name)));
    }
    const combinedPath = path.join(dest, 'chain.json');
    let existing = [];
    if (fs.existsSync(combinedPath)) {
      existing = JSON.parse(fs.readFileSync(combinedPath, 'utf8'));
      if (!Array.isArray(existing)) throw new Error('archived chain.json is not an array');
    }
    const delay = testDelayMs();
    if (delay) sleepMs(delay);
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
    enforceModes(cfg.dir);
  });
  return { copied: true, dest };
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
};
