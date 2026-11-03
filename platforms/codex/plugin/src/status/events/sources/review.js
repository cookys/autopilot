'use strict';

// src/status/events/sources/review.js - review.collected / review.finalized events (autopilot.events/1).
//
//   read(ctx, window) -> { events, warnings, stats }      never throws, read-only with respect to every source
//   ctx    = { project: { project_key, repo_identity, repo_name, root, common_dir }, env, home, now, reviewLedgers? }
//            reviewLedgers: the repeated `--review-ledger <dir>` values (configured roots)
//   window = { sinceTs, slackMs, hints }                  sinceTs: epoch ms | ISO string | null/0 (= from the beginning)
//
// Ledger roots (first seen wins, de-duplicated by realpath, so a copy of a live ledger collapses by id):
//   1. <git-common-dir>/autopilot/review-ledgers.txt   written by hetero-review-loop.js collect; optional candidates
//   2. ctx.reviewLedgers                               configured: a missing dir is one aggregated source_absent
//   3. env AUTOPILOT_EVENTS_REVIEW_LEDGERS             configured, ':'-separated path list
//   4. a dispatch manifest's `ledger` field that is a directory holding review-* dirs   optional candidates
//   5. the archive dir (review_ledger_archive.dir / AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR): <archive>/<bucket>/<YYYY-MM>/<ledger-id>/
//      is a ledger root (layout recorded in docs/dev/events-contract.md)
//
// Project filter: an entry is kept only if its `base` commit exists in the project repo; all distinct bases of one
// call go through ONE `git cat-file --batch-check` process. Entries of other repos are counted in rows_filtered.
// findings.json is read lazily, only for entries whose event falls inside the window.
//
// No reader imports another reader. Node built-ins only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseInstant, parseInstantMs } = require('../instant');
const { cleanGitEnv } = require('../../git-env');

const SOURCE = 'review';
const MAX_JSON_BYTES = 8 * 1024 * 1024;

const sha256hex = (text) => crypto.createHash('sha256').update(text).digest('hex');

function createState() {
  const warnings = new Map();
  const stats = { name: SOURCE, state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 };
  const warn = (code, detail) => {
    const key = `${code}\0${detail}`;
    const hit = warnings.get(key);
    if (hit) hit.count += 1;
    else warnings.set(key, { source: SOURCE, code, detail, count: 1 });
  };
  return { warnings, stats, warn };
}

function windowFloor(window) {
  if (!window) return null;
  let since = window.sinceTs;
  if (typeof since === 'string') since = parseInstantMs(since);
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null;
  const slack = Number.isFinite(window.slackMs) && window.slackMs > 0 ? window.slackMs : 0;
  return since - slack;
}

function readJsonFile(file, st) {
  // -> { value } | { error: 'file_unreadable'|'line_unparseable'|'absent' }
  let text;
  try {
    if (fs.statSync(file).size > MAX_JSON_BYTES) return { error: 'line_unparseable' };
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { error: 'absent' };
    return { error: 'file_unreadable' };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (_error) {
    return { error: 'line_unparseable' };
  }
}

function isDir(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_error) { return false; }
}

function realOrSelf(dir) {
  try { return fs.realpathSync(dir); } catch (_error) { return path.resolve(dir); }
}

function commonDirOf(project) {
  const dir = project && project.common_dir;
  return typeof dir === 'string' && dir !== '' ? dir : null;
}

// ---- ledger roots ------------------------------------------------------------------------------------------------

function archiveDirOf(ctx, state) {
  const env = ctx.env || {};
  const home = ctx.home || '';
  let dir = null;
  if (Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR')) {
    dir = env.AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR || null;
  } else {
    const configFile = env.AUTOPILOT_CONFIG_FILE || (home ? path.join(home, '.autopilot', 'config.json') : null);
    if (configFile) {
      const res = readJsonFile(configFile, {});
      if (res.value && res.value.review_ledger_archive && typeof res.value.review_ledger_archive.dir === 'string') {
        dir = res.value.review_ledger_archive.dir || null;
      } else if (res.error === 'line_unparseable' || res.error === 'file_unreadable') {
        state.warn(res.error, path.basename(configFile));
        state.stats.state = 'degraded';
      }
    }
  }
  if (!dir) return null;
  if (dir === '~') dir = home;
  else if (dir.startsWith('~/')) dir = path.join(home, dir.slice(2));
  return dir.startsWith('/') ? dir : null;
}

function listPointerRoots(commonDir, state) {
  if (!commonDir) return [];
  const file = path.join(commonDir, 'autopilot', 'review-ledgers.txt');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    state.warn('file_unreadable', 'review-ledgers.txt');
    state.stats.state = 'degraded';
    return [];
  }
  const seen = new Set();
  const roots = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    if (path.isAbsolute(line)) roots.push(line);
  }
  return roots;
}

function listManifestRoots(ctx, state) {
  const env = ctx.env || {};
  const runsDir = env.AUTOPILOT_DISPATCH_RUNS_DIR;
  if (!runsDir) return [];
  let names;
  try { names = fs.readdirSync(runsDir); } catch (_error) { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.manifest.json') || name.startsWith('panel-')) continue;
    const res = readJsonFile(path.join(runsDir, name), {});
    if (!res.value || typeof res.value !== 'object') continue;
    const manifest = res.value;
    if (manifest.repo_identity !== ctx.project.repo_identity) continue;
    if (typeof manifest.ledger === 'string' && path.isAbsolute(manifest.ledger) && isDir(manifest.ledger)) out.push(manifest.ledger);
  }
  return out;
}

function reviewPhaseDirs(ledgerDir) {
  let names;
  try { names = fs.readdirSync(ledgerDir); } catch (_error) { return null; }
  return names.filter((name) => {
    if (!name.startsWith('review-')) return false;
    try {
      const st = fs.lstatSync(path.join(ledgerDir, name));
      return st.isDirectory() && !st.isSymbolicLink();
    } catch (_error) { return false; }
  }).sort();
}

function listArchiveRoots(archiveDir, ctx, state) {
  const out = [];
  const sub = (dir) => {
    try {
      return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort().map((n) => path.join(dir, n)).filter(isDir);
    } catch (_error) { return []; }
  };
  for (const bucket of sub(archiveDir)) {
    for (const month of sub(bucket)) {
      for (const ledger of sub(month)) {
        // archive.json carries the repo_identity the copy was made for: a host-wide archive holds other repos' ledgers
        const meta = readJsonFile(path.join(ledger, 'archive.json'), {});
        if (meta.value && typeof meta.value.repo_identity === 'string' && meta.value.repo_identity !== ctx.project.repo_identity) {
          state.stats.rows_filtered += 1;
          continue;
        }
        out.push(ledger);
      }
    }
  }
  return out;
}

// ---- entries -----------------------------------------------------------------------------------------------------

function mtimeIso(...files) {
  for (const file of files) {
    try { return new Date(fs.statSync(file).mtimeMs).toISOString(); } catch (_error) { /* next */ }
  }
  return null;
}

function normaliseSeats(seats) {
  if (!Array.isArray(seats)) return [];
  const out = [];
  for (const seat of seats) {
    if (typeof seat === 'string') out.push({ id: seat, status: 'reviewed' }); // pre-v2.36 chains listed bare seat ids
    else if (seat && typeof seat === 'object' && typeof seat.id === 'string') {
      out.push({ id: seat.id, status: typeof seat.status === 'string' ? seat.status : 'unknown' });
    }
  }
  return out;
}

const count = (value, fallback) => (Number.isInteger(value) && value >= 0 ? value : fallback);

// -> { ts, ts_basis } | { invalid: true } for one chain entry stamp.
function stampOf(value, mtimeFiles) {
  if (value !== undefined && value !== null) {
    const ts = parseInstant(value);
    return ts === null ? { invalid: true } : { ts, ts_basis: 'source' };
  }
  const ts = mtimeIso(...mtimeFiles);
  return ts === null ? { invalid: true, missing: true } : { ts, ts_basis: 'mtime' };
}

function readFindings(file) {
  const res = readJsonFile(file, {});
  if (!res.value || typeof res.value !== 'object' || !Array.isArray(res.value.findings)) return null;
  const bySeverity = {};
  for (const finding of res.value.findings) {
    const severity = finding && typeof finding.severity === 'string' ? finding.severity : 'unknown';
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }
  return { total: res.value.findings.length, bySeverity };
}

function receiptFor(ledgerDir, phase, generation) {
  // The receipt belongs to the last finalized generation of the phase; an earlier generation gets no verdict from it.
  const res = readJsonFile(path.join(ledgerDir, `receipt-${phase}.json`), {});
  const receipt = res.value;
  if (!receipt || typeof receipt !== 'object') return null;
  if (Array.isArray(receipt.chain)) {
    const finalized = receipt.chain.filter((e) => e && e.status === 'finalized' && Number.isInteger(e.generation));
    const last = finalized.length ? Math.max(...finalized.map((e) => e.generation)) : null;
    if (last !== generation) return null;
  }
  const out = {};
  if (typeof receipt.verdict === 'string') out.verdict = receipt.verdict;
  if (Array.isArray(receipt.open_findings)) out.open_findings = receipt.open_findings.length;
  return out;
}

function withinLedger(ledgerDir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const full = path.resolve(ledgerDir, rel);
  return full.startsWith(ledgerDir + path.sep) ? full : null;
}

function collectEntries(ledgerDir, state, floor, candidates) {
  const phases = reviewPhaseDirs(ledgerDir);
  if (phases === null) return false;
  for (const phaseDirName of phases) {
    const phase = phaseDirName.slice('review-'.length);
    const chainFile = path.join(ledgerDir, phaseDirName, 'chain.json');
    const res = readJsonFile(chainFile, state);
    if (res.error === 'absent') { state.stats.rows_filtered += 1; continue; }
    if (res.error) { state.warn(res.error, `${phaseDirName}/chain.json`); state.stats.state = 'degraded'; state.stats.rows_skipped += 1; continue; }
    if (!Array.isArray(res.value)) {
      state.warn('schema_mismatch', `${phaseDirName}/chain.json`);
      state.stats.state = 'degraded';
      state.stats.rows_skipped += 1;
      continue;
    }
    const valid = res.value.filter((e) => e && typeof e === 'object' && Number.isInteger(e.generation) && e.generation >= 0);
    state.stats.rows_skipped += res.value.length - valid.length;
    state.stats.rows_read += valid.length;
    // phase_base12 comes from the lowest-generation entry: the phase base, constant across generations
    const lowest = valid.filter((e) => typeof e.base === 'string' && e.base).sort((a, b) => a.generation - b.generation)[0];
    for (const entry of valid) {
      // an aborted generation never produced a review (no head, no seats): nothing to report
      if (typeof entry.base !== 'string' || !entry.base || typeof entry.head !== 'string' || !entry.head) {
        state.stats.rows_filtered += 1;
        continue;
      }
      const phaseBase = lowest ? lowest.base : entry.base;
      const gDir = path.join(ledgerDir, phaseDirName, `g${entry.generation}`);
      const findingsFile = path.join(gDir, 'findings.json');
      const collected = stampOf(entry.collected_at, [findingsFile, chainFile]);
      const wantFinal = entry.status === 'finalized';
      let finalStamp = null;
      if (wantFinal) {
        const snapshot = withinLedger(ledgerDir, entry.dispositions_path) || path.join(gDir, 'dispositions.json');
        finalStamp = stampOf(entry.finalized_at, [snapshot, chainFile]);
      }
      const inWindow = (stamp) => !stamp.invalid && (floor === null || Date.parse(stamp.ts) >= floor);
      const wantCollected = collected.invalid || inWindow(collected);
      const wantFinalized = wantFinal && (finalStamp.invalid || inWindow(finalStamp));
      if (!wantCollected && !wantFinalized) continue;
      candidates.push({
        ledgerDir, phase, entry, phaseBase12: sha256hex(phaseBase).slice(0, 12), gDir, findingsFile,
        collected: wantCollected ? collected : null, finalized: wantFinalized ? finalStamp : null,
      });
    }
  }
  return true;
}

// ---- project filter ----------------------------------------------------------------------------------------------

// -> Set of bases that exist as commits, or null when git could not answer.
function existingCommits(ctx, commonDir, bases) {
  const found = new Set();
  const usable = bases.filter((base) => /^[0-9a-fA-F]{7,64}$/.test(base));
  if (usable.length === 0) return found;
  const env = cleanGitEnv(ctx.env || process.env);
  const res = spawnSync('git', ['--git-dir', commonDir, 'cat-file', '--batch-check'], {
    input: `${usable.join('\n')}\n`, encoding: 'utf8', env, timeout: 20000, maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return null;
  const lines = res.stdout.split('\n');
  usable.forEach((base, index) => {
    const parts = (lines[index] || '').split(' ');
    if (parts[1] === 'commit') found.add(base);
  });
  return found;
}

// ---- events ------------------------------------------------------------------------------------------------------

function buildEvents(candidate, projectKey, events, state) {
  const { entry, phase, phaseBase12 } = candidate;
  const idKey = `${phaseBase12}:${phase}:g${entry.generation}`;
  const seats = normaliseSeats(entry.seats);
  const reviewed = count(entry.reviewed_seats, count(entry.reviewed_seats_count, seats.filter((s) => s.status === 'reviewed').length));
  const total = count(entry.total_seats, count(entry.total_seats_count, seats.length));
  const event = (kind, stamp, data) => ({
    id: `${kind}:${idKey}`, kind, ts: stamp.ts, ts_basis: stamp.ts_basis, source: 'review_ledger',
    project_key: projectKey, root_run_id: null, run_id: null, data,
  });
  if (candidate.collected) {
    if (candidate.collected.invalid) {
      if (!candidate.collected.missing) state.warn('ts_invalid', `${path.basename(candidate.ledgerDir)}/review-${phase}`);
      state.stats.rows_skipped += 1;
    } else {
      const data = {
        phase, phase_base12: phaseBase12, generation: entry.generation, base: entry.base, head: entry.head,
        seats, reviewed_seats: reviewed, total_seats: total,
      };
      const findings = readFindings(candidate.findingsFile);
      if (findings) { data.findings_total = findings.total; data.findings_by_severity = findings.bySeverity; }
      events.push(event('review.collected', candidate.collected, data));
    }
  }
  if (candidate.finalized) {
    if (candidate.finalized.invalid) {
      if (!candidate.finalized.missing) state.warn('ts_invalid', `${path.basename(candidate.ledgerDir)}/review-${phase}`);
      state.stats.rows_skipped += 1;
    } else {
      const data = { phase, phase_base12: phaseBase12, generation: entry.generation };
      const receipt = receiptFor(candidate.ledgerDir, phase, entry.generation);
      if (receipt && receipt.verdict !== undefined) data.verdict = receipt.verdict;
      if (receipt && receipt.open_findings !== undefined) data.open_findings = receipt.open_findings;
      data.reviewed_seats = reviewed;
      data.total_seats = total;
      if (typeof entry.dispositions_sha256 === 'string') data.dispositions_sha256 = entry.dispositions_sha256;
      events.push(event('review.finalized', candidate.finalized, data));
    }
  }
}

function read(ctx, window) {
  const state = createState();
  const events = [];
  try {
    const project = ctx && ctx.project;
    const commonDir = commonDirOf(project);
    if (!commonDir) {
      state.warn('git_unavailable', 'project');
      state.stats.state = 'degraded';
      return { events, warnings: [...state.warnings.values()], stats: state.stats };
    }
    const floor = windowFloor(window);

    // roots: [{ dir, configured }]
    const roots = [];
    const seenRoots = new Map();
    const addRoot = (dir, configured) => {
      const key = realOrSelf(dir);
      const seen = seenRoots.get(key);
      if (seen) { seen.configured = seen.configured || configured; return; } // any configured source makes it configured
      const root = { dir: key, given: dir, configured };
      seenRoots.set(key, root);
      roots.push(root);
    };
    for (const dir of listPointerRoots(commonDir, state)) addRoot(dir, false);
    for (const dir of (ctx.reviewLedgers || [])) if (typeof dir === 'string' && dir) addRoot(path.resolve(dir), true);
    const envList = (ctx.env || {}).AUTOPILOT_EVENTS_REVIEW_LEDGERS;
    if (typeof envList === 'string') for (const dir of envList.split(':')) if (dir) addRoot(path.resolve(dir), true);
    for (const dir of listManifestRoots(ctx, state)) addRoot(dir, false);
    const archiveDir = archiveDirOf(ctx, state);
    if (archiveDir) {
      if (isDir(archiveDir)) for (const dir of listArchiveRoots(archiveDir, ctx, state)) addRoot(dir, false);
      else { state.warn('source_absent', path.basename(archiveDir)); }
    }

    const candidates = [];
    let absentConfigured = 0;
    for (const root of roots) {
      const ok = collectEntries(root.dir, state, floor, candidates);
      if (!ok) {
        if (root.configured) absentConfigured += 1;
        else state.stats.rows_filtered += 1; // optional candidate that is gone: silent
      }
    }
    if (absentConfigured > 0) {
      state.warn('source_absent', 'review-ledger');
      state.warnings.get('source_absent\0review-ledger').count = absentConfigured;
    }

    // project filter: one git process for every distinct base of the call
    let kept = candidates;
    if (candidates.length > 0) {
      const present = existingCommits(ctx, commonDir, [...new Set(candidates.map((c) => c.entry.base))]);
      if (present === null) {
        state.warn('git_unavailable', 'cat-file');
        state.stats.state = 'degraded';
        kept = [];
      } else {
        kept = candidates.filter((c) => present.has(c.entry.base));
        state.stats.rows_filtered += candidates.length - kept.length;
      }
    }

    const byId = new Map();
    for (const candidate of kept) {
      const local = [];
      buildEvents(candidate, project.project_key, local, state);
      for (const event of local) if (!byId.has(event.id)) byId.set(event.id, event); // live ledger first, archive copy collapses
    }
    events.push(...byId.values());
    events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  } catch (error) {
    state.warn('source_failed', error && error.name ? String(error.name) : 'Error');
    state.stats.state = 'degraded';
  }
  return { events, warnings: [...state.warnings.values()], stats: state.stats };
}

module.exports = { read, SOURCE };
