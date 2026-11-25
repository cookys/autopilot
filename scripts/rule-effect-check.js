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
 * Read-only by default: never fetches unless `--fetch` is given, never mutates any repo.
 * `--inventory` mode never searches for transcripts. `--seats` mode streams one JSONL
 * transcript per local seat and keeps only timestamp plus record type/subtype.
 *
 * Usage:
 *   node scripts/rule-effect-check.js --inventory <file.json> --commit <sha>
 *       [--commit <repo>=<sha> ...] [--host <name>] [--all-hosts]
 *       [--transcript <jsonl> --seat <address>] [--fetch] [--json]
 *   node scripts/rule-effect-check.js --seats <seats.tsv|auto> [--rule-repo <path>]
 *       [--rule-ref <ref>] [--projects-dir <dir>] [--host <name>] [--json] [--fetch]
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
 *   --seats adds rule_repo (absolute), rule_commit (full sha), rule_ref
 *     (the ref searched; default origin/develop), time_source
 *     ("transcript" | "missing") on each emitted seat, and rule_ref on the
 *     --json document. Foreign-host rows are omitted. When no row is on this
 *     host, --json includes "no_local_seats": true.
 *
 * Exit codes:
 *   0 = every seat is effective
 *   1 = any seat is stale
 *   2 = no seat is stale and some seat is unknown, or --seats has no row on this host
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
    + '       node scripts/rule-effect-check.js --seats <seats.tsv> [--rule-repo <path>] '
    + '[--rule-ref <ref>] [--projects-dir <dir>] [--host <name>] [--json] [--fetch]\n'
    + '\n'
    + 'Options:\n'
    + '  --inventory <file.json>  Seat inventory (schema autopilot.rule-effect-inventory/1)\n'
    + '  --seats <seats.tsv|auto>  seat-decl.tsv (14 columns; seat, host and sid are read), or "auto" to derive the seats from\n'
    + '                             the fleet directory (`fleet peers --json`, FLEET_BIN overrides\n'
    + '                             the binary): live claude seats only; host = courier,\n'
    + '                             sid = generation. Mutually exclusive with --inventory\n'
    + '  --rule-repo <path>       Git checkout whose CLAUDE.md history is the rule (default: this repo)\n'
    + '  --rule-ref <ref>         Ref to search for the newest CLAUDE.md commit (default: origin/develop)\n'
    + '  --projects-dir <dir>     Claude projects dir; transcript is <dir>/*/<sid>.jsonl\n'
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
    seats: null,
    ruleRepo: null,
    ruleRef: null,
    projectsDir: null,
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
    if (arg === '--seats' || arg.startsWith('--seats=')) {
      const val = arg === '--seats' ? argv[++i] : arg.slice('--seats='.length);
      if (val === undefined || val === '' || (arg === '--seats' && val.startsWith('--'))) {
        throw new UsageError('--seats requires a TSV path');
      }
      if (opts.seats !== null) {
        throw new UsageError('--seats may only be specified once');
      }
      opts.seats = val;
      continue;
    }
    if (arg === '--rule-repo' || arg.startsWith('--rule-repo=')) {
      const val = arg === '--rule-repo' ? argv[++i] : arg.slice('--rule-repo='.length);
      if (val === undefined || val === '' || (arg === '--rule-repo' && val.startsWith('--'))) {
        throw new UsageError('--rule-repo requires a path');
      }
      if (opts.ruleRepo !== null) {
        throw new UsageError('--rule-repo may only be specified once');
      }
      opts.ruleRepo = val;
      continue;
    }
    if (arg === '--rule-ref' || arg.startsWith('--rule-ref=')) {
      const val = arg === '--rule-ref' ? argv[++i] : arg.slice('--rule-ref='.length);
      if (val === undefined || val.trim() === '' || /\s/.test(val) || val.startsWith('-')) {
        throw new UsageError('--rule-ref requires a git ref');
      }
      if (opts.ruleRef !== null) {
        throw new UsageError('--rule-ref may only be specified once');
      }
      opts.ruleRef = val;
      continue;
    }
    if (arg === '--projects-dir' || arg.startsWith('--projects-dir=')) {
      const val = arg === '--projects-dir' ? argv[++i] : arg.slice('--projects-dir='.length);
      if (val === undefined || val === '' || (arg === '--projects-dir' && val.startsWith('--'))) {
        throw new UsageError('--projects-dir requires a directory path');
      }
      if (opts.projectsDir !== null) {
        throw new UsageError('--projects-dir may only be specified once');
      }
      opts.projectsDir = val;
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
    if (opts.seats && opts.inventory) {
      throw new UsageError('--seats and --inventory are mutually exclusive');
    }
    if (opts.seats) {
      if (opts.commits.defaultCommit !== null || opts.commits.byRepo.length > 0) {
        throw new UsageError('--commit cannot be combined with --seats');
      }
      if (opts.transcript !== null || opts.seat !== null) {
        throw new UsageError('--transcript/--seat cannot be combined with --seats');
      }
      if (opts.allHosts) {
        throw new UsageError('--all-hosts cannot be combined with --seats');
      }
    } else {
      if (opts.ruleRepo !== null || opts.ruleRef !== null || opts.projectsDir !== null) {
        throw new UsageError('--rule-repo, --rule-ref and --projects-dir require --seats');
      }
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

function forEachTranscriptLine(transcriptPath, onLine) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch (err) {
    throw new UsageError(`cannot read transcript ${transcriptPath}: ${err.message}`);
  }
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
      for (const line of lines) onLine(line);
    }
    const tail = leftover + decoder.end();
    if (tail) onLine(tail);
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`cannot read transcript ${transcriptPath}: ${err.message}`);
  } finally {
    try { fs.closeSync(fd); } catch (_e) { /* ignore */ }
  }
}

function parseLineTimestampMs(rawLine) {
  const line = rawLine.trim();
  if (!line || !line.includes('"timestamp"')) return null;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (_e) {
    return null;
  }
  if (!isPlainObject(rec)) return null;
  const parsed = parseTimestampMs(rec.timestamp);
  return parsed.state === 'ok' ? parsed.ms : null;
}

function readTranscriptCompactMs(transcriptPath) {
  let newestMs = null;
  forEachTranscriptLine(transcriptPath, (line) => {
    const ms = parseCompactBoundaryLineMs(line);
    if (ms !== null && (newestMs === null || ms > newestMs)) newestMs = ms;
  });
  return newestMs;
}

function readTranscriptSeatTimes(transcriptPath) {
  let sessionStartedMs = null;
  let lastCompactMs = null;
  forEachTranscriptLine(transcriptPath, (line) => {
    const anyMs = parseLineTimestampMs(line);
    if (anyMs !== null && (sessionStartedMs === null || anyMs < sessionStartedMs)) {
      sessionStartedMs = anyMs;
    }
    const compactMs = parseCompactBoundaryLineMs(line);
    if (compactMs !== null && (lastCompactMs === null || compactMs > lastCompactMs)) {
      lastCompactMs = compactMs;
    }
  });
  return { sessionStartedMs, lastCompactMs };
}

function loadSeatsTsv(seatsPath) {
  // The seat table has one source: hangar's seat-decl.tsv (14 columns). This check needs seat, host and sid from it.
  let decl;
  try {
    decl = require('./lib/seat-decl').readSeatDecl(seatsPath);
  } catch (err) {
    throw new UsageError(`seats ${err.message}`);
  }
  const rows = [];
  for (const r of decl) {
    if (r.sid === null) continue; // a seat with no recorded session id has nothing to check
    rows.push({ seat: r.seat, host: r.host, sid: r.sid.trim() });
  }
  if (rows.length === 0) {
    throw new UsageError(`seats ${seatsPath}: no data rows with a sid`);
  }
  return rows;
}

// --seats auto: derive the seat list from the fleet directory instead of a TSV.
// Only live claude seats are eligible (the check reads Claude transcripts).
// The binary comes from FLEET_BIN (tests point it at a stub) so the real fleet
// is never touched. A directory that cannot be read, or that yields no live
// claude seat, is a hard usage error (exit 2) — never a silently empty list.
function fleetPeersCall(args) {
  const fleetBin = process.env.FLEET_BIN || 'fleet';
  const res = spawnSync(fleetBin, args, { encoding: 'utf8', timeout: 15000 });
  if (res.error) {
    throw new UsageError(`fleet directory unavailable (${fleetBin} ${args.join(' ')}): ${res.error.message}`);
  }
  if (res.status !== 0) {
    const tail = (res.stderr || '').trim().split('\n')[0];
    throw new UsageError(`fleet directory unavailable (${fleetBin} ${args.join(' ')}): exit ${res.status}${tail ? `: ${tail}` : ''}`);
  }
  return res.stdout;
}

function seatsFromPeersJson(stdout) {
  // lib/fleet-peers is the one parser for `fleet peers --json`. Resolved lazily
  // and allowed to fail: the suite's sed-mutant copies live outside scripts/,
  // where the relative require cannot resolve — those only exercise the
  // non-auto paths, so falling through to the text parser keeps them copy-safe.
  let members;
  try {
    members = require('./lib/fleet-peers').parsePeers(stdout);
  } catch (_e) {
    return null;
  }
  if (members === null) return null;
  const rows = [];
  for (const row of members) {
    if (!row || typeof row !== 'object') continue;
    if (!require('./lib/fleet-peers').isLive(row)) continue;
    if (row.harness !== 'claude') continue;
    if (!row.courier || !row.sub) continue;
    const seat = [row.namespace, row.courier, row.member].filter(Boolean).join('/');
    if (!seat) continue;
    rows.push({ seat, host: row.courier, sid: row.sub });
  }
  return rows;
}

function seatsFromPeersText(stdout) {
  // Older fleets without --json: parse the text listing best-effort. It carries
  // member, generation, state and harness but no namespace/courier, so the
  // seat address is the bare member name and host stays unknown — such rows
  // cannot be host-matched and degrade to the no_local_seats exit.
  const rows = [];
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    const member = line.trim().split(/\s+/)[0];
    const generation = (line.match(/\bgeneration=(\S+)/) || [])[1];
    const state = (line.match(/\bstate=(\S+)/) || [])[1];
    const harness = (line.match(/\bharness=(\S+)/) || [])[1];
    if (!member || !generation) continue;
    if (state !== 'live' || harness !== 'claude') continue;
    rows.push({ seat: member, host: '', sid: generation });
  }
  return rows;
}

function loadSeatsAuto() {
  const jsonOut = fleetPeersCall(['peers', '--json']);
  let rows = seatsFromPeersJson(jsonOut);
  if (rows === null) {
    // The fleet does not support --json; fall back to the text listing.
    rows = seatsFromPeersText(fleetPeersCall(['peers']));
  }
  if (rows.length === 0) {
    throw new UsageError('fleet directory lists no live claude seat');
  }
  return rows;
}

function defaultRuleRepo() {
  const res = runGit(path.dirname(__filename), ['rev-parse', '--show-toplevel']);
  if (res.error || res.status !== 0) {
    throw new UsageError('cannot resolve git toplevel for --rule-repo default');
  }
  const top = res.stdout.trim();
  if (!top) throw new UsageError('cannot resolve git toplevel for --rule-repo default');
  return top;
}

function resolveRuleCommit(ruleRepo, ruleRef) {
  const logRes = runGit(ruleRepo, ['log', '-1', '--format=%H', ruleRef, '--', ':(glob)**/CLAUDE.md']);
  if (logRes.error) {
    throw new UsageError(`cannot read rule commit in ${ruleRepo}: ${logRes.error.message}`);
  }
  if (logRes.status !== 0) {
    throw new UsageError(`cannot read rule commit from ${ruleRef} in ${ruleRepo}`);
  }
  const sha = logRes.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new UsageError(`no CLAUDE.md commit reachable from ${ruleRef} in ${ruleRepo}`);
  }
  return sha;
}

function findSeatTranscript(projectsDir, sid) {
  if (typeof sid !== 'string' || sid === '' || sid.includes('/') || sid.includes('\\') || sid.includes('..')) {
    return null;
  }
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (_e) {
    return null;
  }
  const dirs = entries.filter((ent) => ent.isDirectory()).map((ent) => ent.name).sort();
  for (const dir of dirs) {
    const candidate = path.join(projectsDir, dir, `${sid}.jsonl`);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_e) { /* next */ }
  }
  return null;
}

function msToIso(ms) {
  return ms === null ? null : new Date(ms).toISOString();
}

function withSeatMeta(row, ruleRepo, ruleCommit, ruleRef, timeSource) {
  return {
    ...row,
    rule_repo: ruleRepo,
    rule_commit: ruleCommit,
    rule_ref: ruleRef,
    time_source: timeSource,
  };
}

function checkSeats(opts, localHostname) {
  const ruleRepo = path.resolve(opts.ruleRepo || defaultRuleRepo());
  const ruleRef = opts.ruleRef || 'origin/develop';
  const projectsDir = opts.projectsDir
    ? path.resolve(opts.projectsDir)
    : path.join(os.homedir(), '.claude', 'projects');
  const ruleCommit = resolveRuleCommit(ruleRepo, ruleRef);
  const rows = opts.seats === 'auto' ? loadSeatsAuto() : loadSeatsTsv(opts.seats);
  const localRows = rows.filter((row) => isLocalHost(row.host, localHostname));
  if (localRows.length === 0) {
    return {
      seats: [],
      summary: { effective: 0, stale: 0, unknown: 0, total: 0 },
      exitCode: 2,
      no_local_seats: true,
      rule_ref: ruleRef,
    };
  }

  const slots = localRows.map((row) => {
    const transcriptPath = findSeatTranscript(projectsDir, row.sid);
    if (!transcriptPath) return { kind: 'missing', row };
    const times = readTranscriptSeatTimes(transcriptPath);
    return {
      kind: 'check',
      row,
      seat: {
        seat: row.seat,
        host: row.host,
        repo: ruleRepo,
        remote_ref: ruleRef,
        session_started_at: msToIso(times.sessionStartedMs),
        last_compact_at: msToIso(times.lastCompactMs),
      },
    };
  });

  const checkOpts = {
    ...opts,
    allHosts: false,
    transcript: null,
    seat: null,
    commits: { defaultCommit: ruleCommit, byRepo: [], seenKeys: new Set() },
  };
  const toCheck = slots.filter((slot) => slot.kind === 'check').map((slot) => slot.seat);
  let checked = [];
  if (toCheck.length > 0) {
    checked = checkInventory({ seats: toCheck }, checkOpts, localHostname).seats;
  }
  let cursor = 0;
  const seats = slots.map((slot) => {
    if (slot.kind === 'missing') {
      const unknown = unknownResult(
        { seat: slot.row.seat, host: slot.row.host, repo: ruleRepo },
        'transcript_missing',
        null,
        null,
      );
      return withSeatMeta(unknown, ruleRepo, ruleCommit, ruleRef, 'missing');
    }
    const res = checked[cursor];
    cursor += 1;
    return withSeatMeta(res, ruleRepo, ruleCommit, ruleRef, 'transcript');
  });

  const summary = { effective: 0, stale: 0, unknown: 0, total: seats.length };
  for (const seat of seats) summary[seat.verdict] += 1;
  let exitCode = 0;
  if (summary.stale > 0) exitCode = 1;
  else if (summary.unknown > 0) exitCode = 2;
  return { seats, summary, exitCode, rule_ref: ruleRef };
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
    const localHostname = opts.host || io.hostname || os.hostname();
    const evaluated = opts.seats
      ? checkSeats(opts, localHostname)
      : checkInventory(loadInventory(opts.inventory), opts, localHostname);
    const { seats, summary, exitCode } = evaluated;
    if (evaluated.no_local_seats) {
      stderr.write(`rule-effect-check: no seat in ${opts.seats} is on host ${localHostname}\n`);
    }
    if (opts.json) {
      const doc = { schema: OUTPUT_SCHEMA, seats, summary };
      if (evaluated.rule_ref) doc.rule_ref = evaluated.rule_ref;
      if (evaluated.no_local_seats) doc.no_local_seats = true;
      stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    } else {
      for (const row of seats) {
        stdout.write(`${JSON.stringify(row)}\n`);
      }
      const summaryDoc = { summary };
      if (evaluated.no_local_seats) summaryDoc.no_local_seats = true;
      stdout.write(`${JSON.stringify(summaryDoc)}\n`);
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
