#!/usr/bin/env node
'use strict';

/**
 * rule-effect-check.js — deterministic fleet rule-rollout checker.
 *
 * Checks whether each local seat in a fleet inventory actually runs a pushed rule commit:
 *   1. remote: `git -C <repo> merge-base --is-ancestor <sha> <remote_ref>`
 *   2. head:   `git -C <repo> merge-base --is-ancestor <sha> HEAD`
 *   3. loaded: `loaded_at` (latest of `session_started_at`, `last_compact_at`, and newest
 *              `compact_boundary` timestamp from `--transcript` for `--seat`) is strictly
 *              after `present_since` (oldest consecutive `HEAD` reflog entry from newest
 *              backwards containing `<sha>`, or commit `%ct` fallback)
 *   4. probe:  if `probe` is present on the seat, `probe.ok === true`
 *
 * Host matching: a seat is local when `seat.host` equals the local hostname (or `--host`),
 * equals the hostname with a leading `<prefix>-` removed (hostname ends with `-<seat.host>`),
 * or equals the first DNS label of the hostname.
 *
 * Read-only by default: never fetches unless `--fetch` is given, never mutates any repo,
 * and never searches for transcripts itself.
 *
 * Usage:
 *   node scripts/rule-effect-check.js --inventory <file.json> --commit <sha>
 *       [--commit <repo>=<sha> ...] [--host <name>] [--all-hosts]
 *       [--transcript <jsonl> --seat <address>] [--fetch] [--json]
 *
 * Inventory schema: "autopilot.rule-effect-inventory/1"
 * Output:
 *   Default (JSONL): one JSON line per seat
 *     {seat, host, repo, verdict, failed, reason, head, commit_time, session_started_at,
 *      loaded_at, present_since, present_since_source}
 *   then one summary line
 *     {summary: {effective, stale, unknown, total}}
 *   --json: single JSON document
 *     {schema: "autopilot.rule-effect/1", seats: [...], summary: {effective, stale, unknown, total}}
 *
 * Exit codes:
 *   0 = every seat is effective
 *   1 = any seat is stale
 *   2 = no seat is stale, some seat is unknown
 *   3 = CLI usage or unreadable/invalid inventory
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

const INVENTORY_SCHEMA = 'autopilot.rule-effect-inventory/1';
const OUTPUT_SCHEMA = 'autopilot.rule-effect/1';
const DEFAULT_REMOTE_REF = 'origin/main';
const HEX_OID_RE = /^[0-9a-fA-F]{4,64}$/;
const SAFE_REMOTE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const ISO_8601_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/i;

const REPO_SELECTING_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
];

class UsageError extends Error {}

function usageText() {
  return (
    'Usage: node scripts/rule-effect-check.js --inventory <file.json> --commit <sha> '
    + '[--commit <repo>=<sha> ...] [--host <name>] [--all-hosts] '
    + '[--transcript <jsonl> --seat <address>] [--fetch] [--json]\n'
    + '\n'
    + 'Options:\n'
    + '  --inventory <file.json>  Seat inventory (schema autopilot.rule-effect-inventory/1)\n'
    + '  --commit <sha|repo=sha>  Rule commit SHA, or per-repo mapping (repeatable)\n'
    + '  --host <name>            Override detected local hostname for seat matching\n'
    + '  --all-hosts              Check repo paths locally even when seat.host does not match local host\n'
    + '  --transcript <jsonl>     Claude Code JSONL transcript to read compact_boundary timestamps from\n'
    + '  --seat <address>         Seat address to apply --transcript to (required with --transcript)\n'
    + '  --fetch                  Run git fetch on each seat remote before checking\n'
    + '  --json                   Emit single autopilot.rule-effect/1 JSON document\n'
    + '  --help, -h               Print this help and exit 0\n'
    + '\n'
    + 'Exit: 0 all effective | 1 any stale | 2 none stale, some unknown | 3 usage/input error\n'
  );
}

function normalizeCommitKey(rawKey) {
  if (rawKey.includes('/') || rawKey.includes(path.sep) || path.isAbsolute(rawKey)) {
    return `path:${path.resolve(rawKey)}`;
  }
  return `name:${rawKey}`;
}

function parseCommitSpec(raw, commits) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UsageError('--commit requires a non-empty <sha> or <repo>=<sha>');
  }
  const eq = raw.lastIndexOf('=');
  if (eq !== -1) {
    const rawKey = raw.slice(0, eq);
    const sha = raw.slice(eq + 1);
    if (!rawKey || !sha || sha.startsWith('-') || /\s/.test(sha)) {
      throw new UsageError(`invalid --commit mapping: ${raw}`);
    }
    const normKey = normalizeCommitKey(rawKey);
    if (commits.seenKeys.has(normKey)) {
      throw new UsageError(`duplicate --commit mapping for ${rawKey}`);
    }
    commits.seenKeys.add(normKey);
    commits.byRepo.push({ rawKey, sha });
    return;
  }
  if (raw.startsWith('-') || /\s/.test(raw)) {
    throw new UsageError(`invalid --commit value: ${raw}`);
  }
  if (commits.defaultCommit !== null) {
    throw new UsageError('multiple unkeyed --commit flags given; use --commit <repo>=<sha>');
  }
  commits.defaultCommit = raw;
}

function parseArgs(argv) {
  const opts = {
    help: false,
    inventory: null,
    host: null,
    transcript: null,
    seat: null,
    allHosts: false,
    fetch: false,
    json: false,
    commits: {
      defaultCommit: null,
      byRepo: [],
      seenKeys: new Set(),
    },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--all-hosts') {
      opts.allHosts = true;
      continue;
    }
    if (arg === '--fetch') {
      opts.fetch = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--inventory' || arg.startsWith('--inventory=')) {
      const val = arg === '--inventory' ? argv[++i] : arg.slice('--inventory='.length);
      if (val === undefined || val === '' || (arg === '--inventory' && val.startsWith('--'))) {
        throw new UsageError('--inventory requires a file path');
      }
      if (opts.inventory !== null) {
        throw new UsageError('--inventory may only be specified once');
      }
      opts.inventory = val;
      continue;
    }
    if (arg === '--host' || arg.startsWith('--host=')) {
      const val = arg === '--host' ? argv[++i] : arg.slice('--host='.length);
      if (val === undefined || val.trim() === '' || /\s/.test(val) || (arg === '--host' && val.startsWith('--'))) {
        throw new UsageError('--host requires a non-empty hostname');
      }
      if (opts.host !== null) {
        throw new UsageError('--host may only be specified once');
      }
      opts.host = val;
      continue;
    }
    if (arg === '--transcript' || arg.startsWith('--transcript=')) {
      const val = arg === '--transcript' ? argv[++i] : arg.slice('--transcript='.length);
      if (val === undefined || val === '' || (arg === '--transcript' && val.startsWith('--'))) {
        throw new UsageError('--transcript requires a file path');
      }
      if (opts.transcript !== null) {
        throw new UsageError('--transcript may only be specified once');
      }
      opts.transcript = val;
      continue;
    }
    if (arg === '--seat' || arg.startsWith('--seat=')) {
      const val = arg === '--seat' ? argv[++i] : arg.slice('--seat='.length);
      if (val === undefined || val.trim() === '' || (arg === '--seat' && val.startsWith('--'))) {
        throw new UsageError('--seat requires a seat address');
      }
      if (opts.seat !== null) {
        throw new UsageError('--seat may only be specified once');
      }
      opts.seat = val;
      continue;
    }
    if (arg === '--commit' || arg.startsWith('--commit=')) {
      const val = arg === '--commit' ? argv[++i] : arg.slice('--commit='.length);
      if (val === undefined || val === '' || (arg === '--commit' && val.startsWith('--'))) {
        throw new UsageError('--commit requires <sha> or <repo>=<sha>');
      }
      parseCommitSpec(val, opts.commits);
      continue;
    }
    throw new UsageError(`unknown option or argument: ${arg}`);
  }

  if (!opts.help) {
    if (!opts.inventory) {
      throw new UsageError('--inventory is required');
    }
    if (opts.commits.defaultCommit === null && opts.commits.byRepo.length === 0) {
      throw new UsageError('at least one --commit <sha> or --commit <repo>=<sha> is required');
    }
    if (opts.transcript !== null && !opts.seat) {
      throw new UsageError('--seat <address> is required with --transcript');
    }
  }
  return opts;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadInventory(inventoryPath) {
  let raw;
  try {
    raw = fs.readFileSync(inventoryPath, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read inventory ${inventoryPath}: ${err.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`invalid JSON in inventory ${inventoryPath}: ${err.message}`);
  }
  if (!isPlainObject(doc)) {
    throw new UsageError('inventory root must be a JSON object');
  }
  if (doc.schema !== undefined && doc.schema !== INVENTORY_SCHEMA) {
    throw new UsageError(`unsupported inventory schema ${JSON.stringify(doc.schema)} (expected "${INVENTORY_SCHEMA}")`);
  }
  if (!Array.isArray(doc.seats) || doc.seats.length === 0) {
    throw new UsageError('inventory "seats" must be a non-empty array');
  }

  for (let i = 0; i < doc.seats.length; i += 1) {
    const s = doc.seats[i];
    if (!isPlainObject(s)) {
      throw new UsageError(`seats[${i}] must be an object`);
    }
    if (typeof s.seat !== 'string' || s.seat.trim() === '') {
      throw new UsageError(`seats[${i}].seat must be a non-empty string`);
    }
    if (typeof s.host !== 'string' || s.host.trim() === '') {
      throw new UsageError(`seats[${i}].host must be a non-empty string`);
    }
    if (s.repo !== undefined && s.repo !== null && typeof s.repo !== 'string') {
      throw new UsageError(`seats[${i}].repo must be a string or null`);
    }
    if (s.remote_ref !== undefined && s.remote_ref !== null && s.remote_ref !== '') {
      if (typeof s.remote_ref !== 'string' || s.remote_ref.startsWith('-') || /\s/.test(s.remote_ref)) {
        throw new UsageError(`seats[${i}].remote_ref is invalid`);
      }
    }
    if (
      s.session_started_at !== undefined
      && s.session_started_at !== null
      && typeof s.session_started_at !== 'string'
      && typeof s.session_started_at !== 'number'
    ) {
      throw new UsageError(`seats[${i}].session_started_at must be an ISO 8601 string, epoch ms number, or null`);
    }
    if (
      s.last_compact_at !== undefined
      && s.last_compact_at !== null
      && typeof s.last_compact_at !== 'string'
      && typeof s.last_compact_at !== 'number'
    ) {
      throw new UsageError(`seats[${i}].last_compact_at must be an ISO 8601 string, epoch ms number, or null`);
    }
    if (s.probe !== undefined && s.probe !== null) {
      if (!isPlainObject(s.probe) || typeof s.probe.ok !== 'boolean') {
        throw new UsageError(`seats[${i}].probe must be an object with boolean "ok"`);
      }
      if (s.probe.evidence !== undefined && s.probe.evidence !== null && typeof s.probe.evidence !== 'string') {
        throw new UsageError(`seats[${i}].probe.evidence must be a string when present`);
      }
    }
  }

  return doc;
}

function parseTimestampMs(raw) {
  if (raw === null || raw === undefined) return { state: 'null', ms: null };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return { state: 'invalid', ms: null };
    return { state: 'ok', ms: raw };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return { state: 'null', ms: null };
    if (/^\d{11,15}$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0) return { state: 'ok', ms: n };
    }
    const m = ISO_8601_RE.exec(trimmed);
    if (!m) return { state: 'invalid', ms: null };
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
      return { state: 'invalid', ms: null };
    }
    const checkDate = new Date(0);
    checkDate.setUTCFullYear(year, month - 1, day);
    if (
      checkDate.getUTCFullYear() !== year
      || checkDate.getUTCMonth() + 1 !== month
      || checkDate.getUTCDate() !== day
    ) {
      return { state: 'invalid', ms: null };
    }
    let offsetMs = 0;
    if (m[8].toUpperCase() !== 'Z') {
      const tzHour = Number(m[10]);
      const tzMin = Number(m[11]);
      if (tzHour > 23 || tzMin > 59) return { state: 'invalid', ms: null };
      const sign = m[9] === '+' ? 1 : -1;
      offsetMs = sign * (tzHour * 60 + tzMin) * 60 * 1000;
    }
    const fracMs = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
    const stamp = new Date(0);
    stamp.setUTCFullYear(year, month - 1, day);
    stamp.setUTCHours(hour, minute, second, 0);
    const ms = stamp.getTime() + fracMs - offsetMs;
    if (!Number.isFinite(ms) || ms <= 0) return { state: 'invalid', ms: null };
    return { state: 'ok', ms };
  }
  return { state: 'invalid', ms: null };
}

function buildGitEnv(allowWrite) {
  const env = { ...process.env };
  for (const key of REPO_SELECTING_ENV) delete env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  if (!allowWrite) env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

function runGit(repoDir, args, options = {}) {
  const allowWrite = Boolean(options.allowWrite);
  return spawnSync(
    'git',
    ['-C', repoDir, '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=0', ...args],
    {
      env: buildGitEnv(allowWrite),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch (_e) {
    return null;
  }
}

function extractRemoteName(remoteRef) {
  if (remoteRef.startsWith('refs/remotes/')) {
    const rest = remoteRef.slice('refs/remotes/'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? rest : rest.slice(0, slash);
  }
  const slash = remoteRef.indexOf('/');
  return slash === -1 ? 'origin' : remoteRef.slice(0, slash);
}

function extractRepoNameFromUrl(remoteUrl) {
  const cleaned = String(remoteUrl || '').trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  if (!cleaned) return '';
  const parts = cleaned.split(/[/:\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function resolveExpectedCommit(realRepo, seatRepo, remoteRef, commits) {
  if (commits.byRepo.length > 0) {
    const resolvedSeatPath = path.resolve(seatRepo);
    for (const entry of commits.byRepo) {
      if (entry.rawKey.includes('/') || entry.rawKey.includes(path.sep) || path.isAbsolute(entry.rawKey)) {
        if (path.resolve(entry.rawKey) === resolvedSeatPath) {
          return { sha: entry.sha, reason: null };
        }
      }
    }
    for (const entry of commits.byRepo) {
      if (entry.rawKey.includes('/') || entry.rawKey.includes(path.sep) || path.isAbsolute(entry.rawKey)) {
        const entryReal = safeRealpath(entry.rawKey);
        if (entryReal !== null && entryReal === realRepo) {
          return { sha: entry.sha, reason: null };
        }
      }
    }

    const bareEntries = commits.byRepo.filter(
      (entry) => !entry.rawKey.includes('/') && !entry.rawKey.includes(path.sep) && !path.isAbsolute(entry.rawKey),
    );
    if (bareEntries.length > 0) {
      const seatBase = path.basename(resolvedSeatPath);
      const realBase = path.basename(realRepo);
      const byBase = bareEntries.filter((entry) => entry.rawKey === seatBase || entry.rawKey === realBase);
      if (byBase.length === 1) return { sha: byBase[0].sha, reason: null };
      if (byBase.length > 1) return { sha: null, reason: 'ambiguous_commit_mapping' };

      const remoteName = extractRemoteName(remoteRef);
      if (SAFE_REMOTE_NAME_RE.test(remoteName)) {
        const urlRes = runGit(realRepo, ['config', '--get', `remote.${remoteName}.url`]);
        if (!urlRes.error && urlRes.status === 0) {
          const remoteRepoName = extractRepoNameFromUrl(urlRes.stdout);
          if (remoteRepoName) {
            const byRemote = bareEntries.filter((entry) => entry.rawKey === remoteRepoName);
            if (byRemote.length === 1) return { sha: byRemote[0].sha, reason: null };
            if (byRemote.length > 1) return { sha: null, reason: 'ambiguous_commit_mapping' };
          }
        }
      }
    }
  }

  if (commits.defaultCommit !== null) {
    return { sha: commits.defaultCommit, reason: null };
  }
  return { sha: null, reason: 'unmapped_commit' };
}

function isLocalHost(seatHost, localHostname) {
  if (typeof seatHost !== 'string' || typeof localHostname !== 'string') return false;
  if (seatHost === '' || localHostname === '') return false;
  if (seatHost === localHostname) return true;
  if (localHostname.endsWith(`-${seatHost}`)) return true;
  const firstLabel = localHostname.split('.')[0];
  return firstLabel !== '' && seatHost === firstLabel;
}

function parseCompactBoundaryLineMs(rawLine) {
  const line = rawLine.trim();
  if (!line || !line.includes('compact_boundary')) return null;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (_e) {
    return null;
  }
  if (!isPlainObject(rec) || rec.subtype !== 'compact_boundary') return null;
  const parsed = parseTimestampMs(rec.timestamp);
  return parsed.state === 'ok' ? parsed.ms : null;
}

function readTranscriptCompactMs(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch (err) {
    throw new UsageError(`cannot read transcript ${transcriptPath}: ${err.message}`);
  }
  let newestMs = null;
  const CHUNK_SIZE = 64 * 1024;
  const buf = Buffer.alloc(CHUNK_SIZE);
  const decoder = new StringDecoder('utf8');
  let leftover = '';
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) break;
      const text = leftover + decoder.write(buf.subarray(0, bytesRead));
      const lines = text.split('\n');
      leftover = lines.pop();
      for (const line of lines) {
        const ms = parseCompactBoundaryLineMs(line);
        if (ms !== null && (newestMs === null || ms > newestMs)) {
          newestMs = ms;
        }
      }
    }
    const tail = leftover + decoder.end();
    if (tail) {
      const ms = parseCompactBoundaryLineMs(tail);
      if (ms !== null && (newestMs === null || ms > newestMs)) {
        newestMs = ms;
      }
    }
  } catch (err) {
    throw new UsageError(`cannot read transcript ${transcriptPath}: ${err.message}`);
  } finally {
    try { fs.closeSync(fd); } catch (_e) { /* ignore */ }
  }
  return newestMs;
}

function resolvePresentSince(realRepo, resolvedSha, commitTimeSec) {
  const reflogRes = runGit(realRepo, ['reflog', 'show', '--date=unix', '--format=%H %gd', 'HEAD']);
  if (reflogRes.error) {
    return { error: 'git_error', timeSec: null, source: null };
  }
  if (reflogRes.status !== 0 || !reflogRes.stdout) {
    return { error: null, timeSec: commitTimeSec, source: 'commit_time' };
  }

  let oldestSec = null;
  const lines = reflogRes.stdout.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([0-9a-fA-F]{40,64})\s+.*@\{(\d+)\}$/.exec(line);
    if (!m) continue;
    const entrySha = m[1];
    const entrySec = Number(m[2]);
    if (!Number.isFinite(entrySec)) continue;

    const ancRes = runGit(realRepo, ['merge-base', '--is-ancestor', resolvedSha, entrySha]);
    if (ancRes.error) {
      return { error: 'git_error', timeSec: null, source: null };
    }
    if (ancRes.status !== 0) {
      break;
    }
    oldestSec = entrySec;
  }

  if (oldestSec !== null) {
    return { error: null, timeSec: oldestSec, source: 'reflog' };
  }
  return { error: null, timeSec: commitTimeSec, source: 'commit_time' };
}

function unknownResult(seat, reason, head, commitTime, extra = {}) {
  return {
    seat: seat.seat,
    host: seat.host,
    repo: seat.repo === undefined ? null : seat.repo,
    verdict: 'unknown',
    failed: [],
    reason,
    head,
    commit_time: commitTime,
    session_started_at: seat.session_started_at === undefined ? null : seat.session_started_at,
    loaded_at: extra.loadedAt !== undefined ? extra.loadedAt : null,
    present_since: extra.presentSince !== undefined ? extra.presentSince : null,
    present_since_source: extra.presentSinceSource !== undefined ? extra.presentSinceSource : null,
  };
}

function readHeadSha(realRepo) {
  const headRes = runGit(realRepo, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (headRes.error || headRes.status !== 0) return null;
  const sha = headRes.stdout.trim();
  return sha || null;
}

function checkSeat(seat, opts, localHostname, fetchCache, transcriptCompactMs = null) {
  const repo = seat.repo === undefined ? null : seat.repo;
  const sessionStartedRaw = seat.session_started_at === undefined ? null : seat.session_started_at;
  const lastCompactRaw = seat.last_compact_at === undefined ? null : seat.last_compact_at;
  const remoteRef = (typeof seat.remote_ref === 'string' && seat.remote_ref !== '')
    ? seat.remote_ref
    : DEFAULT_REMOTE_REF;

  if (!opts.allHosts && !isLocalHost(seat.host, localHostname)) {
    return unknownResult(seat, 'other_host', null, null);
  }

  if (typeof repo !== 'string' || repo.trim() === '') {
    return unknownResult(seat, 'missing_repo', null, null);
  }
  if (!path.isAbsolute(repo)) {
    return unknownResult(seat, 'invalid_repo_path', null, null);
  }

  let stat;
  try {
    stat = fs.statSync(repo);
  } catch (_e) {
    return unknownResult(seat, 'missing_repo', null, null);
  }
  if (!stat.isDirectory()) {
    return unknownResult(seat, 'missing_repo', null, null);
  }

  const realRepo = safeRealpath(repo);
  if (realRepo === null) {
    return unknownResult(seat, 'missing_repo', null, null);
  }

  const wtCheck = runGit(realRepo, ['rev-parse', '--is-inside-work-tree']);
  if (wtCheck.error) {
    return unknownResult(seat, 'git_error', null, null);
  }
  if (wtCheck.status !== 0 || wtCheck.stdout.trim() !== 'true') {
    return unknownResult(seat, 'not_git_repo', null, null);
  }

  if (opts.fetch) {
    const remoteName = extractRemoteName(remoteRef);
    if (!SAFE_REMOTE_NAME_RE.test(remoteName)) {
      return unknownResult(seat, 'fetch_failed', readHeadSha(realRepo), null);
    }
    const cacheKey = `${realRepo}\0${remoteName}`;
    if (!fetchCache.has(cacheKey)) {
      const fetchRes = runGit(realRepo, ['fetch', '--quiet', remoteName], { allowWrite: true });
      fetchCache.set(cacheKey, !fetchRes.error && fetchRes.status === 0);
    }
    if (!fetchCache.get(cacheKey)) {
      return unknownResult(seat, 'fetch_failed', readHeadSha(realRepo), null);
    }
  }

  const head = readHeadSha(realRepo);
  const mapped = resolveExpectedCommit(realRepo, repo, remoteRef, opts.commits);
  if (!mapped.sha) {
    return unknownResult(seat, mapped.reason || 'unmapped_commit', head, null);
  }
  if (!HEX_OID_RE.test(mapped.sha)) {
    return unknownResult(seat, 'unresolved_commit', head, null);
  }

  const revRes = runGit(realRepo, ['rev-parse', '--verify', '--quiet', `${mapped.sha}^{commit}`]);
  if (revRes.error) {
    return unknownResult(seat, 'git_error', head, null);
  }
  const resolvedSha = revRes.status === 0 ? revRes.stdout.trim() : '';
  if (!resolvedSha || !resolvedSha.toLowerCase().startsWith(mapped.sha.toLowerCase())) {
    return unknownResult(seat, 'unresolved_commit', head, null);
  }

  const logRes = runGit(realRepo, ['log', '-1', '--format=%ct', resolvedSha]);
  if (logRes.error || logRes.status !== 0) {
    return unknownResult(seat, 'git_error', head, null);
  }
  const ctRaw = logRes.stdout.trim();
  if (!/^\d+$/.test(ctRaw)) {
    return unknownResult(seat, 'git_error', head, null);
  }
  const commitTimeSec = Number(ctRaw);

  const failed = [];

  // 1. remote contains commit
  const remoteRefRes = runGit(realRepo, ['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]);
  if (remoteRefRes.error) {
    return unknownResult(seat, 'git_error', head, commitTimeSec);
  }
  if (remoteRefRes.status !== 0) {
    failed.push('remote');
  } else {
    const remoteAnc = runGit(realRepo, ['merge-base', '--is-ancestor', resolvedSha, remoteRef]);
    if (remoteAnc.error || (remoteAnc.status !== 0 && remoteAnc.status !== 1)) {
      return unknownResult(seat, 'git_error', head, commitTimeSec);
    }
    if (remoteAnc.status !== 0) {
      failed.push('remote');
    }
  }

  // 2. worktree HEAD contains commit
  if (head === null) {
    failed.push('head');
  } else {
    const headAnc = runGit(realRepo, ['merge-base', '--is-ancestor', resolvedSha, 'HEAD']);
    if (headAnc.error || (headAnc.status !== 0 && headAnc.status !== 1)) {
      return unknownResult(seat, 'git_error', head, commitTimeSec);
    }
    if (headAnc.status !== 0) {
      failed.push('head');
    }
  }

  // 3. rules loaded strictly after checkout HEAD has continuously contained the commit
  const presentSince = resolvePresentSince(realRepo, resolvedSha, commitTimeSec);
  if (presentSince.error) {
    return unknownResult(seat, presentSince.error, head, commitTimeSec);
  }
  const presentSinceSec = presentSince.timeSec;
  const presentSinceSource = presentSince.source;

  const parsedStart = parseTimestampMs(sessionStartedRaw);
  const parsedCompact = parseTimestampMs(lastCompactRaw);
  const seatTranscriptMs = (opts.transcript && opts.seat && seat.seat === opts.seat)
    ? transcriptCompactMs
    : null;

  const loadCandidates = [];
  if (parsedStart.state === 'ok') loadCandidates.push(parsedStart.ms);
  if (parsedCompact.state === 'ok') loadCandidates.push(parsedCompact.ms);
  if (seatTranscriptMs !== null) loadCandidates.push(seatTranscriptMs);

  const loadedAtMs = loadCandidates.length > 0 ? Math.max(...loadCandidates) : null;
  const loadedAtIso = loadedAtMs !== null ? new Date(loadedAtMs).toISOString() : null;

  if (loadedAtMs !== null) {
    if (!(loadedAtMs > presentSinceSec * 1000)) {
      failed.push('loaded');
    }
  }

  // 4. optional behaviour probe
  if (seat.probe !== undefined && seat.probe !== null) {
    if (seat.probe.ok !== true) {
      failed.push('probe');
    }
  }

  if (failed.length > 0) {
    return {
      seat: seat.seat,
      host: seat.host,
      repo,
      verdict: 'stale',
      failed,
      reason: null,
      head,
      commit_time: commitTimeSec,
      session_started_at: sessionStartedRaw,
      loaded_at: loadedAtIso,
      present_since: presentSinceSec,
      present_since_source: presentSinceSource,
    };
  }

  const extra = {
    loadedAt: loadedAtIso,
    presentSince: presentSinceSec,
    presentSinceSource,
  };
  if (loadedAtMs === null) {
    if (parsedStart.state === 'invalid') {
      return unknownResult(seat, 'invalid_session_started_at', head, commitTimeSec, extra);
    }
    if (parsedCompact.state === 'invalid') {
      return unknownResult(seat, 'invalid_last_compact_at', head, commitTimeSec, extra);
    }
    return unknownResult(seat, 'no_load_time', head, commitTimeSec, extra);
  }
  if (parsedStart.state === 'invalid') {
    return unknownResult(seat, 'invalid_session_started_at', head, commitTimeSec, extra);
  }
  if (parsedCompact.state === 'invalid') {
    return unknownResult(seat, 'invalid_last_compact_at', head, commitTimeSec, extra);
  }

  return {
    seat: seat.seat,
    host: seat.host,
    repo,
    verdict: 'effective',
    failed: [],
    reason: null,
    head,
    commit_time: commitTimeSec,
    session_started_at: sessionStartedRaw,
    loaded_at: loadedAtIso,
    present_since: presentSinceSec,
    present_since_source: presentSinceSource,
  };
}

function checkInventory(doc, opts, localHostname = os.hostname()) {
  const fetchCache = new Map();
  const transcriptCompactMs = opts.transcriptCompactMs !== undefined
    ? opts.transcriptCompactMs
    : (opts.transcript ? readTranscriptCompactMs(opts.transcript) : null);
  const seats = [];
  const summary = { effective: 0, stale: 0, unknown: 0, total: doc.seats.length };

  for (const seat of doc.seats) {
    const res = checkSeat(seat, opts, localHostname, fetchCache, transcriptCompactMs);
    seats.push(res);
    summary[res.verdict] += 1;
  }

  let exitCode = 0;
  if (summary.stale > 0) exitCode = 1;
  else if (summary.unknown > 0) exitCode = 2;

  return { seats, summary, exitCode };
}

function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;

  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      stdout.write(usageText());
      return 0;
    }
    const doc = loadInventory(opts.inventory);
    const localHostname = opts.host || io.hostname || os.hostname();
    const { seats, summary, exitCode } = checkInventory(doc, opts, localHostname);
    if (opts.json) {
      stdout.write(`${JSON.stringify({ schema: OUTPUT_SCHEMA, seats, summary }, null, 2)}\n`);
    } else {
      for (const row of seats) {
        stdout.write(`${JSON.stringify(row)}\n`);
      }
      stdout.write(`${JSON.stringify({ summary })}\n`);
    }
    return exitCode;
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`rule-effect-check: ${err.message}\n`);
      return 3;
    }
    stderr.write(`rule-effect-check: unexpected error: ${err && err.message ? err.message : String(err)}\n`);
    return 3;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  INVENTORY_SCHEMA,
  OUTPUT_SCHEMA,
  parseArgs,
  loadInventory,
  parseTimestampMs,
  parseSessionStartMs: parseTimestampMs,
  isLocalHost,
  readTranscriptCompactMs,
  resolvePresentSince,
  checkSeat,
  checkInventory,
  main,
};
