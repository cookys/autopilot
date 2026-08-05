#!/usr/bin/env node
'use strict';

/**
 * Durable heterogeneous plan-review session controller.
 *
 * Identity: canonical git repository + caller-stable logical_plan_id. A ticket,
 * runner, model, process, cwd, or session change cannot open another budget.
 * Width: 1-4 frozen seats in one generation. Each seat gets at most two
 * transport/parser attempts. Generation 2 is the hard semantic terminal cap.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  createRunnerTransportEnvelope,
} = require('../src/transport/runner-envelope');
const {
  normalizePlanReviewPayload,
} = require('./lib/plan-review-normalize');
const {
  applyDispositions,
  backlogCandidates,
  loadDispositionFile,
  normalizeAndDedupeFindings,
  unresolvedCandidateFingerprints,
} = require('./lib/plan-review-findings');

const SCRIPT_DIR = __dirname;
const DISPATCH_AUTHOR = path.join(SCRIPT_DIR, 'dispatch-author.sh');
const RUBRIC_FREEZE = path.join(SCRIPT_DIR, 'rubric-freeze.js');
const DEFAULT_STATE_ROOT = path.join(os.homedir(), '.autopilot', 'plan-review');
const DEFAULTS = Object.freeze({
  maxGenerations: 2,
  maxWallSeconds: 7200,
  growthWarnRatio: 1.25,
  growthStopRatio: 1.5,
  effort: 'xhigh',
  timeout: '5m',
});
const RUNNERS = new Set([
  'codex',
  'agy',
  'grok',
  'cc-shim',
  'anthropic-compatible',
  'claude-native',
  'qoderclicn',
]);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage:
  node scripts/dispatch-plan-review.js \\
    --repo-root <repo> --plan-file <plan> --rubric-file <rubric> \\
    --ticket <id> --session-id <id> --generation <1|2> \\
    --manifest-file <manifest.json> [--disposition-file <decisions.json>] \\
    [--state-dir <dir>] [--now <ISO-8601>]

Legacy compatibility:
  replace --manifest-file with --runner/--model/--effort/--endpoint and optional
  --deep-* flags. --logical-plan-id is recommended; omitted legacy calls use a
  frozen ticket-bound compatibility identity.

Hard limits: 1-4 seats, two attempts per seat, two semantic generations, 7200s.`;
}

function parseArgs(argv) {
  const opts = {
    effort: DEFAULTS.effort,
    timeout: DEFAULTS.timeout,
    maxGenerations: DEFAULTS.maxGenerations,
    maxWallSeconds: DEFAULTS.maxWallSeconds,
    growthWarnRatio: DEFAULTS.growthWarnRatio,
    growthStopRatio: DEFAULTS.growthStopRatio,
    stateDir: process.env.AUTOPILOT_PLAN_REVIEW_STATE_DIR || DEFAULT_STATE_ROOT,
  };
  const flags = new Map([
    ['--repo-root', 'repoRoot'],
    ['--plan-file', 'planFile'],
    ['--rubric-file', 'rubricFile'],
    ['--manifest-file', 'manifestFile'],
    ['--disposition-file', 'dispositionFile'],
    ['--logical-plan-id', 'logicalPlanId'],
    ['--ticket', 'ticket'],
    ['--session-id', 'sessionId'],
    ['--generation', 'generation'],
    ['--runner', 'runner'],
    ['--model', 'model'],
    ['--effort', 'effort'],
    ['--timeout', 'timeout'],
    ['--endpoint', 'endpoint'],
    ['--deep-runner', 'deepRunner'],
    ['--deep-model', 'deepModel'],
    ['--deep-effort', 'deepEffort'],
    ['--deep-endpoint', 'deepEndpoint'],
    ['--state-dir', 'stateDir'],
    ['--max-generations', 'maxGenerations'],
    ['--max-wall-seconds', 'maxWallSeconds'],
    ['--growth-warn-ratio', 'growthWarnRatio'],
    ['--growth-stop-ratio', 'growthStopRatio'],
    ['--now', 'now'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const key = flags.get(arg);
    if (!key) throw new CliError(`unknown argument: ${arg}`);
    if (index + 1 >= argv.length || argv[index + 1] === '') {
      throw new CliError(`${arg} requires a non-empty value`);
    }
    opts[key] = argv[++index];
  }
  for (const key of ['repoRoot', 'planFile', 'rubricFile', 'ticket', 'sessionId', 'generation']) {
    if (!opts[key]) throw new CliError(`missing required option: ${key}`);
  }
  opts.generation = positiveInteger(opts.generation, '--generation');
  opts.maxGenerations = positiveInteger(opts.maxGenerations, '--max-generations');
  opts.maxWallSeconds = positiveInteger(opts.maxWallSeconds, '--max-wall-seconds');
  opts.growthWarnRatio = positiveNumber(opts.growthWarnRatio, '--growth-warn-ratio');
  opts.growthStopRatio = positiveNumber(opts.growthStopRatio, '--growth-stop-ratio');
  if (opts.generation > 2) throw new CliError('generation exceeds hard cap 2', 3);
  if (opts.maxGenerations > 2) throw new CliError('max-generations cannot exceed hard cap 2');
  if (opts.maxWallSeconds > 7200) throw new CliError('max-wall-seconds cannot exceed hard cap 7200');
  if (opts.growthWarnRatio > 1.25 || opts.growthStopRatio > 1.5
      || opts.growthWarnRatio >= opts.growthStopRatio) {
    throw new CliError('plan growth ratios exceed or contradict hard ceilings');
  }
  opts.timeoutSeconds = parseTimeoutSeconds(opts.timeout);
  if (opts.timeoutSeconds > opts.maxWallSeconds) {
    throw new CliError('--timeout cannot exceed the wall-clock budget');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(opts.ticket)) {
    throw new CliError('--ticket must match [A-Za-z0-9._-]+');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(opts.sessionId)) {
    throw new CliError('--session-id must match [A-Za-z0-9._:-]+');
  }
  if (opts.logicalPlanId && !/^[A-Za-z0-9._:-]+$/.test(opts.logicalPlanId)) {
    throw new CliError('--logical-plan-id must match [A-Za-z0-9._:-]+');
  }
  if (opts.now !== undefined
      && (!Number.isFinite(Date.parse(opts.now))
        || process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1')) {
    throw new CliError('--now is valid only under the explicit test seam');
  }
  const hasManifest = Boolean(opts.manifestFile);
  const hasLegacy = Boolean(opts.runner || opts.model || opts.deepRunner || opts.deepModel);
  if (hasManifest && hasLegacy) {
    throw new CliError('--manifest-file cannot be combined with legacy reviewer flags');
  }
  if (!hasManifest && (!opts.runner || !opts.model)) {
    throw new CliError('provide --manifest-file or the legacy --runner and --model tuple');
  }
  opts.repoRoot = canonicalDirectory(opts.repoRoot, '--repo-root');
  opts.planFile = canonicalFile(opts.planFile, '--plan-file');
  opts.rubricFile = canonicalFile(opts.rubricFile, '--rubric-file');
  if (opts.manifestFile) opts.manifestFile = canonicalFile(opts.manifestFile, '--manifest-file');
  if (opts.dispositionFile) {
    opts.dispositionFile = canonicalFile(opts.dispositionFile, '--disposition-file');
  }
  opts.stateDir = path.resolve(opts.stateDir);
  return opts;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new CliError(`${label} must be a positive integer`);
  }
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be positive`);
  }
  return parsed;
}

function parseTimeoutSeconds(value) {
  const match = /^([1-9][0-9]*)(s|m)$/.exec(String(value || '').trim().toLowerCase());
  if (!match) throw new CliError('--timeout must use positive Ns or Nm syntax');
  const seconds = Number(match[1]) * (match[2] === 'm' ? 60 : 1);
  if (!Number.isSafeInteger(seconds)) throw new CliError('--timeout is outside the supported range');
  return seconds;
}

function canonicalDirectory(raw, label) {
  let resolved;
  try {
    resolved = fs.realpathSync(raw);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${raw}`);
  }
  if (!fs.statSync(resolved).isDirectory()) throw new CliError(`${label} must be a directory`);
  return resolved;
}

function canonicalFile(raw, label) {
  let resolved;
  try {
    resolved = fs.realpathSync(raw);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${raw}`);
  }
  if (!fs.statSync(resolved).isFile()) throw new CliError(`${label} must be a regular file`);
  return resolved;
}

function canonicalRepoIdentity(repoRoot) {
  const run = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) throw new CliError('--repo-root must be a git repository');
  const raw = run.stdout.trim();
  const common = path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
  return `git-common-dir:${fs.realpathSync(common)}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonical(value[key]);
  return output;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function readProcessStart(pid) {
  if (fs.existsSync('/proc/self/stat')) {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const suffix = raw.slice(raw.lastIndexOf(') ') + 2).trim().split(/\s+/);
      if (suffix.length < 20 || !/^[0-9]+$/.test(suffix[19])) {
        return { status: 'unknown' };
      }
      return { status: 'live', process_start: suffix[19] };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return { status: 'dead' };
      return { status: 'unknown' };
    }
  }
  const observed = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (observed.status !== 0 || !String(observed.stdout || '').trim()) {
    try {
      process.kill(pid, 0);
      return { status: 'unknown' };
    } catch (error) {
      return error.code === 'ESRCH' ? { status: 'dead' } : { status: 'unknown' };
    }
  }
  return {
    status: 'live',
    process_start: sha256(`ps-lstart:${String(observed.stdout).trim()}`),
  };
}

function directoryInode(directory) {
  return String(fs.lstatSync(directory).ino);
}

function exactOwner(value, inodeKey) {
  const allowed = new Set(['pid', 'process_start', 'nonce', inodeKey]);
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key))
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && typeof value.process_start === 'string'
    && /^(?:[0-9]+|[0-9a-f]{64})$/.test(value.process_start)
    && typeof value.nonce === 'string'
    && /^[0-9a-f]{32}$/.test(value.nonce)
    && typeof value[inodeKey] === 'string'
    && /^[0-9]+$/.test(value[inodeKey]);
}

function ownerLiveness(owner, expectedInode, inodeKey) {
  if (!exactOwner(owner, inodeKey) || owner[inodeKey] !== String(expectedInode)) {
    return 'unknown';
  }
  const observed = readProcessStart(owner.pid);
  if (observed.status === 'unknown') return 'unknown';
  if (observed.status === 'dead') return 'dead';
  return observed.process_start === owner.process_start ? 'live' : 'dead';
}

function currentOwner(inode, inodeKey, nonce = crypto.randomBytes(16).toString('hex')) {
  const observed = readProcessStart(process.pid);
  if (observed.status !== 'live') {
    throw new CliError('cannot establish durable process identity', 3);
  }
  return {
    pid: process.pid,
    process_start: observed.process_start,
    nonce,
    [inodeKey]: String(inode),
  };
}

function readLockOwner(lock) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
  } catch (error) {
    throw new CliError('plan-review durable lock owner is unverifiable', 3);
  }
}

function publishLock(lock) {
  const candidate = `${lock}.acquire-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  fs.mkdirSync(candidate, { mode: 0o700 });
  const inode = directoryInode(candidate);
  const owner = currentOwner(inode, 'lock_inode');
  atomicWriteJson(path.join(candidate, 'owner.json'), owner);
  try {
    fs.renameSync(candidate, lock);
  } catch (error) {
    fs.rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
  return { lock, inode, owner };
}

function acquireLock(directory, name) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, name);
  try {
    return publishLock(lock);
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
    let inode;
    try {
      inode = directoryInode(lock);
    } catch (statError) {
      throw new CliError('plan-review durable lock changed during inspection', 3);
    }
    const existing = readLockOwner(lock);
    const liveness = ownerLiveness(existing, inode, 'lock_inode');
    if (liveness === 'live') throw new CliError('plan-review durable identity is busy', 3);
    if (liveness !== 'dead') {
      throw new CliError('plan-review durable lock owner is unverifiable', 3);
    }
    const quarantine = `${lock}.recovering`;
    try {
      fs.renameSync(lock, quarantine);
    } catch (renameError) {
      throw new CliError('plan-review durable lock changed during recovery', 3);
    }
    if (directoryInode(quarantine) !== inode
        || ownerLiveness(readLockOwner(quarantine), inode, 'lock_inode') !== 'dead') {
      if (!fs.existsSync(lock)) fs.renameSync(quarantine, lock);
      throw new CliError('plan-review durable lock failed stale-owner proof', 3);
    }
    let replacement;
    try {
      replacement = publishLock(lock);
    } catch (retryError) {
      if (['EEXIST', 'ENOTEMPTY'].includes(retryError.code)) {
        throw new CliError('plan-review durable identity is busy', 3);
      }
      throw retryError;
    }
    fs.rmSync(quarantine, { recursive: true, force: true });
    return replacement;
  }
}

function releaseLock(handle) {
  let observed;
  try {
    observed = readLockOwner(handle.lock);
  } catch (error) {
    throw new CliError('plan-review durable lock ownership changed before release', 3);
  }
  if (directoryInode(handle.lock) !== handle.inode
      || !exactOwner(observed, 'lock_inode')
      || observed.nonce !== handle.owner.nonce
      || observed.pid !== handle.owner.pid
      || observed.process_start !== handle.owner.process_start
      || observed.lock_inode !== handle.owner.lock_inode) {
    throw new CliError('plan-review durable lock ownership changed before release', 3);
  }
  const released = `${handle.lock}.released-${handle.owner.nonce}`;
  fs.renameSync(handle.lock, released);
  fs.rmSync(released, { recursive: true, force: true });
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== allowed.size
      || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new CliError(`${label} has an invalid shape`);
  }
}

function boundedString(value, label, maxLength, pattern = null) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength
      || (pattern && !pattern.test(value))) {
    throw new CliError(`${label} must be a 1-${maxLength} character string`);
  }
  return value;
}

function normalizeTuple(value, label, includeSeatFields) {
  const keys = new Set([
    'id', 'runner', 'model', 'effort', 'endpoint', 'role', 'family',
    'readiness_status', 'qualification_status',
  ]);
  if (includeSeatFields) {
    keys.add('required');
    keys.add('excluded_families');
    keys.add('fallbacks');
  }
  exactKeys(value, keys, label);
  boundedString(value.id, `${label}.id`, 64, /^[A-Za-z][A-Za-z0-9_-]*$/);
  boundedString(value.runner, `${label}.runner`, 64);
  boundedString(value.model, `${label}.model`, 256);
  boundedString(value.endpoint, `${label}.endpoint`, 128);
  boundedString(value.role, `${label}.role`, 128);
  boundedString(value.family, `${label}.family`, 128);
  if (!RUNNERS.has(value.runner)
      || !EFFORTS.has(value.effort)
      || !['ready', 'unavailable'].includes(value.readiness_status)
      || !['qualified', 'unqualified'].includes(value.qualification_status)) {
    throw new CliError(`${label} has an invalid exact tuple`);
  }
  const tuple = {
    id: value.id,
    runner: value.runner,
    model: value.model,
    effort: value.effort,
    endpoint: value.endpoint,
    role: value.role,
    family: value.family,
    readiness_status: value.readiness_status,
    qualification_status: value.qualification_status,
  };
  if (!includeSeatFields) return tuple;
  if (typeof value.required !== 'boolean'
      || !Array.isArray(value.excluded_families)
      || value.excluded_families.length > 16
      || !Array.isArray(value.fallbacks)
      || value.fallbacks.length > 4) {
    throw new CliError(`${label} has invalid seat policy fields`);
  }
  const excludedFamilies = value.excluded_families.map(
    (family, index) => boundedString(
      family,
      `${label}.excluded_families[${index}]`,
      128,
    ),
  );
  if (new Set(excludedFamilies).size !== excludedFamilies.length) {
    throw new CliError(`${label}.excluded_families must contain unique values`);
  }
  return {
    ...tuple,
    required: value.required,
    excluded_families: excludedFamilies,
    fallbacks: value.fallbacks.map(
      (fallback, index) => normalizeTuple(fallback, `${label}.fallbacks[${index}]`, false),
    ),
  };
}

function validateManifest(value) {
  const keys = new Set([
    'schema_version', 'artifact_type', 'logical_plan_id',
    'minimum_distinct_families', 'max_attempts_per_seat', 'seats',
  ]);
  exactKeys(value, keys, 'manifest');
  if (value.schema_version !== 1 || value.artifact_type !== 'plan_review_manifest'
      || typeof value.logical_plan_id !== 'string'
      || value.logical_plan_id.length > 256
      || !/^[A-Za-z0-9._:-]+$/.test(value.logical_plan_id)
      || !Number.isInteger(value.minimum_distinct_families)
      || value.minimum_distinct_families < 1
      || value.minimum_distinct_families > 4
      || value.max_attempts_per_seat !== 2
      || !Array.isArray(value.seats)
      || value.seats.length < 1
      || value.seats.length > 4) {
    throw new CliError('manifest identity or limits are invalid');
  }
  const seats = value.seats.map(
    (seat, index) => normalizeTuple(seat, `manifest.seats[${index}]`, true),
  );
  const ids = new Set();
  for (const seat of seats) {
    if (ids.has(seat.id)) throw new CliError(`duplicate manifest seat id: ${seat.id}`);
    ids.add(seat.id);
    for (const fallback of seat.fallbacks) {
      if (ids.has(fallback.id)) {
        throw new CliError(`duplicate seat/fallback id: ${fallback.id}`);
      }
      ids.add(fallback.id);
    }
  }
  if (new Set(seats.map((seat) => seat.family)).size < value.minimum_distinct_families) {
    throw new CliError('manifest primary panel violates minimum distinct-family count');
  }
  return {
    schema_version: 1,
    artifact_type: 'plan_review_manifest',
    logical_plan_id: value.logical_plan_id,
    minimum_distinct_families: value.minimum_distinct_families,
    max_attempts_per_seat: 2,
    seats,
  };
}

function legacyManifest(opts) {
  function tuple(id, runner, model, effort, endpoint, role) {
    if (!RUNNERS.has(runner) || !EFFORTS.has(effort)) {
      throw new CliError(`legacy ${id} tuple is invalid`);
    }
    return {
      id,
      runner,
      model,
      effort,
      endpoint: endpoint || 'default',
      role,
      family: `legacy-${model}`,
      readiness_status: 'ready',
      qualification_status: 'qualified',
      required: true,
      excluded_families: [],
      fallbacks: [],
    };
  }
  const seats = [
    tuple('chair', opts.runner, opts.model, opts.effort, opts.endpoint, 'chair'),
  ];
  const hasDeep = [opts.deepRunner, opts.deepModel, opts.deepEffort, opts.deepEndpoint]
    .some((value) => value !== undefined);
  if (hasDeep) {
    if (!opts.deepRunner || !opts.deepModel || !opts.deepEffort) {
      throw new CliError('legacy deep seat requires runner, model, and effort');
    }
    seats.push(tuple(
      'deep',
      opts.deepRunner,
      opts.deepModel,
      opts.deepEffort,
      opts.deepEndpoint,
      'deep',
    ));
  }
  return {
    schema_version: 1,
    artifact_type: 'plan_review_manifest',
    logical_plan_id: opts.logicalPlanId || `legacy-ticket:${opts.ticket}`,
    minimum_distinct_families: 1,
    max_attempts_per_seat: 2,
    seats,
  };
}

function loadManifest(opts) {
  if (!opts.manifestFile) {
    const manifest = legacyManifest(opts);
    return {
      manifest,
      bytes: Buffer.from(`${JSON.stringify(canonical(manifest))}\n`),
      legacy: true,
    };
  }
  let parsed;
  const bytes = fs.readFileSync(opts.manifestFile);
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new CliError(`manifest is not valid JSON: ${error.message}`);
  }
  return { manifest: validateManifest(parsed), bytes, legacy: false };
}

function extractRubricIds(bytes) {
  const ids = new Set();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:(?:#{1,6})\s*|[-*]\s*)?\[?([A-Za-z][A-Za-z0-9_-]*\d+)\]?\s*(?::|[.)-]\s|[—–]\s)/,
    );
    if (match) ids.add(match[1]);
  }
  if (ids.size === 0) throw new CliError('rubric contains no stable IDs');
  return ids;
}

function sealSpec(command, specFile, sealPath) {
  const args = command === 'seal'
    ? [RUBRIC_FREEZE, 'seal', specFile, '--out', sealPath]
    : [RUBRIC_FREEZE, 'check', specFile, sealPath, '--json'];
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) {
    throw new CliError(command === 'seal' ? 'unable to seal frozen input' : 'frozen input drifted', 3);
  }
  return command === 'seal'
    ? JSON.parse(fs.readFileSync(sealPath, 'utf8')).spec_sha256
    : JSON.parse(run.stdout).spec_sha256;
}

function withLock(directory, name, fn) {
  const handle = acquireLock(directory, name);
  try {
    return fn();
  } finally {
    releaseLock(handle);
  }
}

function loadState(statePath) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new CliError('plan-review state is unreadable', 3);
  }
  if (!state || state.version !== 2 || !Array.isArray(state.claims)) {
    throw new CliError('plan-review state has unsupported shape', 3);
  }
  return state;
}

function logicalBinding(opts, repoIdentity, manifest, sessionKey) {
  const logicalDir = path.join(opts.stateDir, 'logical');
  const logicalKey = sha256(`${repoIdentity}\0${manifest.logical_plan_id}`);
  const indexPath = path.join(logicalDir, `${logicalKey}.json`);
  return {
    logicalDir,
    logicalKey,
    indexPath,
    lockName: `${logicalKey}.lock`,
    value: {
      schema_version: 1,
      repo_identity: repoIdentity,
      logical_plan_id: manifest.logical_plan_id,
      ticket: opts.ticket,
      session_key: sessionKey,
    },
  };
}

function validateBinding(value, label) {
  const keys = new Set([
    'schema_version', 'repo_identity', 'logical_plan_id', 'ticket', 'session_key',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))
      || value.schema_version !== 1
      || typeof value.repo_identity !== 'string'
      || typeof value.logical_plan_id !== 'string'
      || typeof value.ticket !== 'string'
      || typeof value.session_key !== 'string'
      || !/^[0-9a-f]{64}$/.test(value.session_key)
      || value.session_key !== sha256(`${value.repo_identity}\0${value.ticket}`)) {
    throw new CliError(`${label} is unreadable`, 3);
  }
  return value;
}

function readBinding(filePath, label) {
  try {
    return validateBinding(JSON.parse(fs.readFileSync(filePath, 'utf8')), label);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${label} is unreadable`, 3);
  }
}

function bindingFromState(statePath) {
  try {
    const state = loadState(statePath);
    return validateBinding({
      schema_version: 1,
      repo_identity: state.repo_identity,
      logical_plan_id: state.logical_plan_id,
      ticket: state.ticket,
      session_key: state.session_key,
    }, 'plan-review orphan identity');
  } catch (error) {
    return null;
  }
}

function findLogicalOrphan(opts, repoIdentity, logicalPlanId) {
  if (!fs.existsSync(opts.stateDir)) return null;
  const matches = [];
  for (const entry of fs.readdirSync(opts.stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'logical' || !/^[0-9a-f]{64}$/.test(entry.name)) {
      continue;
    }
    const directory = path.join(opts.stateDir, entry.name);
    const identityPath = path.join(directory, 'session-identity.json');
    const statePath = path.join(directory, 'state.json');
    let candidate = null;
    if (fs.existsSync(identityPath)) {
      try {
        candidate = readBinding(identityPath, 'plan-review orphan identity');
      } catch (error) {
        candidate = fs.existsSync(statePath) ? bindingFromState(statePath) : null;
      }
    } else if (fs.existsSync(statePath)) {
      candidate = bindingFromState(statePath);
    }
    if (candidate
        && candidate.session_key === entry.name
        && candidate.repo_identity === repoIdentity
        && candidate.logical_plan_id === logicalPlanId) {
      matches.push(candidate);
    }
  }
  if (matches.length > 1
      && new Set(matches.map((item) => item.session_key)).size > 1) {
    throw new CliError('logical plan has conflicting orphan session identities', 3);
  }
  return matches[0] || null;
}

function assertSameBinding(actual, expected) {
  if (actual.repo_identity !== expected.repo_identity
      || actual.logical_plan_id !== expected.logical_plan_id
      || actual.ticket !== expected.ticket
      || actual.session_key !== expected.session_key) {
    throw new CliError(
      `logical plan already bound to canonical ticket ${actual.ticket} (${actual.session_key})`,
      3,
    );
  }
}

function prepareLogicalBinding(binding, sessionDir) {
  let canonicalBinding = null;
  if (fs.existsSync(binding.indexPath)) {
    canonicalBinding = readBinding(binding.indexPath, 'logical plan index');
  } else {
    canonicalBinding = findLogicalOrphan(
      { stateDir: path.dirname(binding.logicalDir) },
      binding.value.repo_identity,
      binding.value.logical_plan_id,
    );
    if (canonicalBinding) {
      atomicWriteJson(binding.indexPath, canonicalBinding);
    }
  }
  if (canonicalBinding) {
    assertSameBinding(canonicalBinding, binding.value);
  }

  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const identityPath = path.join(sessionDir, 'session-identity.json');
  if (fs.existsSync(identityPath)) {
    assertSameBinding(readBinding(identityPath, 'plan-review session identity'), binding.value);
  } else {
    const statePath = path.join(sessionDir, 'state.json');
    if (fs.existsSync(statePath)) {
      const recovered = bindingFromState(statePath);
      if (!recovered) throw new CliError('plan-review orphan state identity is unreadable', 3);
      assertSameBinding(recovered, binding.value);
    }
    atomicWriteJson(identityPath, binding.value);
  }
}

function commitLogicalBinding(binding) {
  if (fs.existsSync(binding.indexPath)) {
    assertSameBinding(readBinding(binding.indexPath, 'logical plan index'), binding.value);
    return;
  }
  atomicWriteJson(binding.indexPath, binding.value);
}

function buildPrompt(seat, planBytes, rubricBytes, rubricIds) {
  const nonce = crypto.randomBytes(12).toString('hex');
  return `You are the ${seat.role} seat (${seat.id}) in one frozen plan-review generation.
Review only against frozen rubric IDs: ${[...rubricIds].join(', ')}.
Do not schedule another review generation. The controller owns attempts and termination.

Return one JSON object with only verdict and findings; do not emit Markdown or any prose outside
that object. Every finding must contain all ten keys (never omit a key and never use null):
rubric_id, class, severity, affected_surface, claim, evidence, evidence_reference,
repair, blocks_next_slice_or_immediate_integrity, cannot_defer_to_spike. The first eight keys
must be non-empty JSON strings and the last two keys must be JSON booleans. This remains true for
non-blocking findings; give them concrete evidence and a non-empty repair string such as
"No current change; follow-up only." Never use null for evidence or repair.
Every string value must be valid RFC 8259 JSON: JSON-escape embedded double quotes, backslashes,
newlines, tabs, and other control characters; never copy raw shell quoting into a string. Before
returning, ensure a strict JSON parse would succeed; if a command example needs quoting, paraphrase
it or use single quotes inside the JSON string.
Allowed verdict values (exact strings): "READY", "CONDITIONAL", "STOP".
Allowed class values (exact strings): "decision-now", "implementation-spike", "future".
Allowed severity values (exact strings): "blocking", "non-blocking".
A finding is a blocker candidate if and only if all of these hold: rubric_id is one of the frozen rubric IDs above; class is "decision-now"; severity is "blocking"; blocks_next_slice_or_immediate_integrity is true; cannot_defer_to_spike is true.
READY is valid only when findings is empty; if any finding exists, use CONDITIONAL or STOP.

<FROZEN_RUBRIC_${nonce}>
${rubricBytes.toString('utf8')}
</FROZEN_RUBRIC_${nonce}>
<PLAN_UNDER_REVIEW_${nonce}>
${planBytes.toString('utf8')}
</PLAN_UNDER_REVIEW_${nonce}>
`;
}

function testSequence() {
  const raw = process.env.AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE;
  if (!raw) return null;
  if (process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1') {
    throw new CliError('response sequence requires explicit test-seam opt-in', 4);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliError('response sequence is invalid JSON', 4);
  }
}

function seamEntry(sequence, seatId, attempt, legacyEnv) {
  if (sequence && Array.isArray(sequence[seatId])) return sequence[seatId][attempt - 1];
  if (attempt === 1 && process.env[legacyEnv]) return process.env[legacyEnv];
  if (attempt === 2 && process.env[legacyEnv]) return process.env[legacyEnv];
  return null;
}

function sleepMilliseconds(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000) {
    throw new CliError('response seam delay_ms must be an integer from 0 to 10000', 4);
  }
  if (milliseconds > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  }
}

function dispatchSeat(
  target,
  prompt,
  attempt,
  sequence,
  legacyEnv,
  sequenceAttempt = attempt,
  repoRoot,
) {
  const seam = seamEntry(sequence, target.id, sequenceAttempt, legacyEnv);
  if (seam) {
    if (process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1') {
      throw new CliError('response file requires explicit test-seam opt-in', 4);
    }
    const descriptor = typeof seam === 'string' ? { file: seam } : seam;
    if (descriptor.delay_ms !== undefined) sleepMilliseconds(descriptor.delay_ms);
    const rawPath = canonicalFile(descriptor.file, 'response seam');
    const raw = fs.readFileSync(rawPath);
    const classification = descriptor.classification || 'success';
    const child = {
      status: classification === 'success' ? 0 : 1,
      signal: classification === 'interrupted' ? 'SIGTERM' : null,
      error: classification === 'unavailable' ? { code: 'ENOENT' } : null,
      stdout: raw,
      stderr: '',
    };
    const envelope = createRunnerTransportEnvelope({
      runner: target.runner,
      model: target.model,
      operation: 'plan-review',
      argv: ['test-seam', target.id, String(attempt)],
      cwd: process.cwd(),
      child,
      outcomeHints: {
        timedOut: classification === 'timeout',
        quota: classification === 'quota',
        unavailable: classification === 'unavailable',
      },
      privateRawReference: {
        kind: 'private-file',
        locator: rawPath,
        digest: sha256(raw),
      },
    });
    return { envelope, raw };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-plan-review-'));
  fs.chmodSync(tempDir, 0o700);
  const promptPath = path.join(tempDir, 'prompt.txt');
  fs.writeFileSync(promptPath, prompt, { mode: 0o600 });
  const args = [
    '--runner', target.runner,
    '--model', target.model,
    '--prompt-file', promptPath,
    '--effort', target.effort,
    '--timeout', `${target.timeoutSeconds}s`,
  ];
  if (target.endpoint !== 'default') args.push('--endpoint', target.endpoint);
  if (target.runner === 'codex') args.push('--repo-root', repoRoot);
  const childCwd = target.runner === 'codex' ? repoRoot : tempDir;
  try {
    const run = spawnSync(DISPATCH_AUTHOR, args, {
      cwd: childCwd,
      env: { ...process.env, DISPATCH_QUIET: '1', DISPATCH_DETACH: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    let authorEnvelope = null;
    try {
      authorEnvelope = JSON.parse(String(run.stdout || '').trim());
    } catch (error) {
      // Mechanical failure remains in the shared transport envelope.
    }
    const rawPath = authorEnvelope && authorEnvelope.raw_log
      ? canonicalFile(authorEnvelope.raw_log, 'dispatch-author raw_log')
      : path.join(tempDir, 'missing.raw');
    const raw = fs.existsSync(rawPath) ? fs.readFileSync(rawPath) : Buffer.alloc(0);
    const success = run.status === 0
      && authorEnvelope
      && authorEnvelope.status === 'authored'
      && authorEnvelope.runner === target.runner
      && authorEnvelope.model === target.model
      && raw.length > 0;
    const envelope = createRunnerTransportEnvelope({
      runner: target.runner,
      model: target.model,
      operation: 'plan-review',
      argv: args,
      cwd: childCwd,
      child: {
        status: success ? 0 : (Number.isInteger(run.status) ? run.status : 1),
        signal: run.signal || null,
        error: run.error || null,
        stdout: raw,
        stderr: run.stderr || '',
      },
      privateRawReference: raw.length > 0 ? {
        kind: 'private-file',
        locator: rawPath,
        digest: sha256(raw),
      } : null,
    });
    return { envelope, raw };
  } finally {
    fs.rmSync(promptPath, { force: true });
    try {
      fs.rmdirSync(tempDir);
    } catch (error) {
      // A retained raw artifact can keep the private directory alive.
    }
  }
}

function fallbackEligible(manifest, seat, fallback, selectedTargets) {
  if (fallback.readiness_status !== 'ready'
      || fallback.qualification_status !== 'qualified'
      || seat.excluded_families.includes(fallback.family)) return false;
  const families = new Set(manifest.seats
    .map((candidate) => {
      if (candidate.id === seat.id) return fallback.family;
      const selected = selectedTargets.has(candidate.id)
        ? selectedTargets.get(candidate.id)
        : candidate;
      return selected ? selected.family : null;
    })
    .filter(Boolean));
  return families.size >= manifest.minimum_distinct_families;
}

function reviewSeat({
  manifest,
  seat,
  repoRoot,
  planBytes,
  rubricBytes,
  rubricIds,
  timeoutSeconds,
  sequence,
  selectedTargets,
  deadlineMs,
  clockNow,
}) {
  const attempts = [];
  let selected = seat;
  let substitution = null;
  for (let attempt = 1; attempt <= manifest.max_attempts_per_seat; attempt += 1) {
    const remainingSeconds = Math.floor((deadlineMs - clockNow()) / 1000);
    if (remainingSeconds < 1) {
      return {
        seat_id: seat.id,
        target_id: selected.id,
        runner: selected.runner,
        model: selected.model,
        family: selected.family,
        verdict: null,
        findings: [],
        attempts,
        substitution,
        exhausted: true,
        deadline_exhausted: true,
      };
    }
    if (attempt === 1 && (seat.readiness_status !== 'ready'
        || seat.qualification_status !== 'qualified')) {
      selected = seat.fallbacks.find(
        (candidate) => fallbackEligible(manifest, seat, candidate, selectedTargets),
      );
      if (!selected) break;
      selectedTargets.set(seat.id, selected);
      substitution = {
        seat_id: seat.id,
        from_id: seat.id,
        to_id: selected.id,
        attempt,
        reason: 'primary_unavailable',
      };
    } else if (attempt === 2) {
      const fallback = seat.fallbacks.find(
        (candidate) => fallbackEligible(manifest, seat, candidate, selectedTargets),
      );
      if (fallback) {
        selected = fallback;
        selectedTargets.set(seat.id, selected);
        substitution = {
          seat_id: seat.id,
          from_id: seat.id,
          to_id: fallback.id,
          attempt,
          reason: 'retry_substitution',
        };
      }
    }
    const bounded = {
      ...selected,
      timeoutSeconds: Math.min(timeoutSeconds, remainingSeconds),
    };
    const legacyEnv = seat.id === 'chair'
      ? 'AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE'
      : seat.id === 'deep'
        ? 'AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE'
        : `AUTOPILOT_PLAN_REVIEW_${seat.id.toUpperCase()}_RESPONSE_FILE`;
    const dispatched = dispatchSeat(
      bounded,
      buildPrompt(bounded, planBytes, rubricBytes, rubricIds),
      attempt,
      sequence,
      legacyEnv,
      selected.id === seat.id ? attempt : 1,
      repoRoot,
    );
    const normalized = normalizePlanReviewPayload({
      envelope: dispatched.envelope,
      raw: dispatched.raw,
      expected: bounded,
    });
    attempts.push({
      seat_id: seat.id,
      target_id: selected.id,
      attempt,
      transport_envelope: dispatched.envelope,
      transport_status: normalized.transport_status,
      parser_status: normalized.parser_status,
      semantic_status: normalized.semantic_status,
    });
    if (normalized.payload) {
      return {
        seat_id: seat.id,
        target_id: selected.id,
        runner: selected.runner,
        model: selected.model,
        family: selected.family,
        verdict: normalized.payload.verdict,
        findings: normalized.payload.findings,
        attempts,
        substitution,
      };
    }
  }
  return {
    seat_id: seat.id,
    target_id: selected ? selected.id : seat.id,
    runner: selected ? selected.runner : seat.runner,
    model: selected ? selected.model : seat.model,
    family: selected ? selected.family : seat.family,
    verdict: null,
    findings: [],
    attempts,
    substitution,
    exhausted: true,
  };
}

function artifactPath(sessionDir, generation) {
  return path.join(sessionDir, `generation-${String(generation).padStart(2, '0')}.json`);
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function growthRatioValue(planBytes, baselineBytes) {
  if (!Number.isSafeInteger(planBytes) || planBytes < 1
      || !Number.isSafeInteger(baselineBytes) || baselineBytes < 1) {
    throw new CliError('plan growth ratio requires non-empty safe byte counts', 3);
  }
  const divisor = greatestCommonDivisor(planBytes, baselineBytes);
  return {
    numerator: planBytes / divisor,
    denominator: baselineBytes / divisor,
  };
}

function publicArtifact(base) {
  return base;
}

function policyArtifact(context, reason, details = {}) {
  return {
    schema_version: 1,
    artifact_type: 'plan_review_artifact',
    ticket: context.opts.ticket,
    logical_plan_id: context.manifest.logical_plan_id,
    session_id: context.opts.sessionId,
    session_key: context.sessionKey,
    generation: context.opts.generation,
    verdict: 'STOP',
    semantic_verdict: null,
    terminal: true,
    policy_reason: reason,
    rubric_sha256: context.rubricSha,
    manifest_sha256: context.manifestSha,
    plan_sha256: context.planSha,
    growth_ratio: context.growthRatioValue || { numerator: 1, denominator: 1 },
    growth_warning: Boolean(context.growthWarning),
    transport_status: 'policy_stop',
    attempts: [],
    substitutions: [],
    reviewer_verdicts: [],
    findings: [],
    backlog_candidates: [],
    accepted_blocker_count: 0,
    repair_authorized: false,
    next_generation: null,
    reviewed_at: context.now.toISOString(),
    ...details,
  };
}

function artifactExitCode(artifact) {
  if (artifact.transport_status === 'transport_exhausted') return 4;
  return artifact.verdict === 'STOP' ? 3 : 0;
}

function finish(payload, code) {
  process.stdout.write(`${JSON.stringify(publicArtifact(payload), null, 2)}\n`);
  process.exit(code);
}

function createClock(nowOverride) {
  const actualStartedAt = Date.now();
  const logicalStartedAt = nowOverride === undefined
    ? actualStartedAt
    : Date.parse(nowOverride);
  return {
    now: () => logicalStartedAt + (Date.now() - actualStartedAt),
  };
}

function claimOwner(sessionDir, nonce) {
  return currentOwner(directoryInode(sessionDir), 'session_inode', nonce);
}

function claimOwnerLiveness(claim, sessionDir) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)
      || !exactOwner(claim.owner, 'session_inode')
      || claim.owner.nonce !== claim.claim_id) {
    return 'unknown';
  }
  return ownerLiveness(claim.owner, directoryInode(sessionDir), 'session_inode');
}

function crashAt(testPoint) {
  const requested = process.env.AUTOPILOT_TEST_PLAN_REVIEW_CRASH_AT;
  if (requested !== testPoint) return;
  if (process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1') {
    throw new CliError('crash point requires explicit test-seam opt-in', 4);
  }
  process.exit(86);
}

/**
 * Controlled post-claim failures must not leave an in-flight claim that the next
 * invocation would misclassify as orphaned transport exhaustion. Unexpected
 * crashes intentionally leave the claim for dead-owner recovery.
 */
function abortInFlightClaim(sessionDir, statePath, claimId, reason) {
  withLock(sessionDir, '.claim.lock', () => {
    if (!fs.existsSync(statePath)) return;
    const state = loadState(statePath);
    if (!state || !state.active_claim || state.active_claim.claim_id !== claimId) return;
    state.active_claim = null;
    const claim = state.claims.find((item) => item.claim_id === claimId);
    if (claim && claim.status === 'in-flight') {
      claim.status = 'aborted';
      claim.abort_reason = String(reason || 'controlled_post_claim_failure').slice(0, 512);
    }
    atomicWriteJson(statePath, state);
  });
}

function exitControlledError(error) {
  process.stderr.write(`dispatch-plan-review: ${error.message}\n`);
  process.exit(error instanceof CliError ? error.exitCode : 2);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`dispatch-plan-review: ${error.message}\n${usage()}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }
  const loaded = loadManifest(opts);
  const manifest = loaded.manifest;
  const manifestSha = sha256(loaded.bytes);
  const repoIdentity = canonicalRepoIdentity(opts.repoRoot);
  const sessionKey = sha256(`${repoIdentity}\0${opts.ticket}`);
  const sessionDir = path.join(opts.stateDir, sessionKey);
  const statePath = path.join(sessionDir, 'state.json');
  const rubricSeal = path.join(sessionDir, 'rubric-seal.json');
  const manifestCopy = path.join(sessionDir, 'manifest.json');
  const manifestSeal = path.join(sessionDir, 'manifest-seal.json');
  const planBytes = fs.readFileSync(opts.planFile);
  if (planBytes.length === 0 || planBytes.toString('utf8').trim() === '') {
    throw new CliError('plan file must contain non-whitespace content');
  }
  const rubricBytes = fs.readFileSync(opts.rubricFile);
  const planSha = sha256(planBytes);
  const rubricSha = sha256(rubricBytes);
  const rubricIds = extractRubricIds(rubricBytes);
  const clock = createClock(opts.now);
  const now = new Date(clock.now());
  const claimId = crypto.randomBytes(16).toString('hex');
  const binding = logicalBinding(opts, repoIdentity, manifest, sessionKey);
  let state;
  let growthRatio = 1;
  let growthWarning = false;
  const context = {
    opts,
    manifest,
    sessionKey,
    manifestSha,
    rubricSha,
    planSha,
    now,
    growthRatioValue: { numerator: 1, denominator: 1 },
    growthWarning,
  };

  let early = null;
  withLock(binding.logicalDir, binding.lockName, () => {
    prepareLogicalBinding(binding, sessionDir);
    withLock(sessionDir, '.claim.lock', () => {
      if (!fs.existsSync(statePath)) {
        if (opts.generation !== 1) throw new CliError('new session must acquire generation 1', 3);
        fs.writeFileSync(manifestCopy, loaded.bytes, { mode: 0o600 });
        if (sealSpec('seal', opts.rubricFile, rubricSeal) !== rubricSha
            || sealSpec('seal', manifestCopy, manifestSeal) !== manifestSha) {
          throw new CliError('frozen rubric/manifest seal mismatch', 3);
        }
        state = {
          version: 2,
          session_key: sessionKey,
          repo_identity: repoIdentity,
          logical_plan_id: manifest.logical_plan_id,
          ticket: opts.ticket,
          rubric_sha256: rubricSha,
          manifest_sha256: manifestSha,
          baseline_plan_sha256: planSha,
          baseline_plan_bytes: planBytes.length,
          started_at: now.toISOString(),
          deadline_at: new Date(now.getTime() + opts.maxWallSeconds * 1000).toISOString(),
          max_generations: opts.maxGenerations,
          max_wall_seconds: opts.maxWallSeconds,
          growth_warn_ratio: opts.growthWarnRatio,
          growth_stop_ratio: opts.growthStopRatio,
          next_generation: 1,
          active_claim: null,
          terminal: false,
          terminal_verdict: null,
          repair_authorized: false,
          claims: [],
          artifacts: [],
        };
        atomicWriteJson(statePath, state);
        crashAt('after_session_init');
      } else {
        state = loadState(statePath);
      }
      if (state.repo_identity !== repoIdentity
          || state.session_key !== sessionKey
          || state.ticket !== opts.ticket
          || state.logical_plan_id !== manifest.logical_plan_id
          || state.rubric_sha256 !== rubricSha
          || state.manifest_sha256 !== manifestSha
          || !Number.isSafeInteger(state.baseline_plan_bytes)
          || state.baseline_plan_bytes < 1) {
        throw new CliError('durable identity or frozen rubric/manifest drifted', 3);
      }
      if (sealSpec('check', opts.rubricFile, rubricSeal) !== rubricSha
          || sealSpec('check', manifestCopy, manifestSeal) !== manifestSha) {
        throw new CliError('frozen rubric/manifest drifted', 3);
      }
      commitLogicalBinding(binding);
      if (state.terminal) {
        throw new CliError(`plan-review session already terminal: ${state.terminal_verdict}`, 3);
      }
      if (!Number.isInteger(state.max_generations)
          || state.max_generations < 1
          || state.max_generations > DEFAULTS.maxGenerations) {
        throw new CliError('durable generation ceiling is invalid', 3);
      }
      if (opts.maxGenerations > state.max_generations) {
        throw new CliError('max-generations cannot broaden the frozen session ceiling', 3);
      }
      if (opts.maxGenerations < state.max_generations) {
        state.max_generations = opts.maxGenerations;
        atomicWriteJson(statePath, state);
      }

      growthRatio = planBytes.length / state.baseline_plan_bytes;
      growthWarning = growthRatio >= state.growth_warn_ratio;
      context.growthRatioValue = growthRatioValue(planBytes.length, state.baseline_plan_bytes);
      context.growthWarning = growthWarning;

      if (state.active_claim) {
        const liveness = claimOwnerLiveness(state.active_claim, sessionDir);
        if (liveness === 'live') {
          throw new CliError('plan-review generation is already claimed by a live owner', 3);
        }
        if (liveness !== 'dead') {
          throw new CliError('active plan-review claim owner is unverifiable', 3);
        }
        const orphan = state.active_claim;
        early = {
          ...policyArtifact(context, 'orphaned_active_claim_transport_exhausted'),
          session_id: orphan.session_id,
          generation: orphan.generation,
          plan_sha256: orphan.plan_sha256,
          verdict: 'CONDITIONAL',
          semantic_verdict: null,
          transport_status: 'transport_exhausted',
        };
        const outPath = artifactPath(sessionDir, orphan.generation);
        if (fs.existsSync(outPath)) {
          throw new CliError('orphaned claim conflicts with an existing generation artifact', 3);
        }
        atomicWriteJson(outPath, early);
        state.active_claim = null;
        state.artifacts.push(outPath);
        const claim = state.claims.find((item) => item.claim_id === orphan.claim_id);
        if (!claim || claim.status !== 'in-flight') {
          throw new CliError('orphaned claim journal is inconsistent', 3);
        }
        claim.status = 'transport-exhausted';
        claim.artifact = outPath;
        claim.attempt_count = manifest.max_attempts_per_seat * manifest.seats.length;
        claim.attempt_accounting = 'unknown_conservatively_exhausted';
        state.terminal = true;
        state.terminal_verdict = early.verdict;
        state.terminal_reason = early.policy_reason;
        atomicWriteJson(statePath, state);
        return;
      }

      if (state.next_generation > state.max_generations
          || opts.generation > state.max_generations) {
        early = {
          ...policyArtifact(context, 'caller_generation_cap_reached'),
          verdict: 'CONDITIONAL',
          semantic_verdict: 'CONDITIONAL',
        };
      } else if (opts.generation !== state.next_generation) {
        throw new CliError(
          `generation ${opts.generation} cannot acquire; next is ${state.next_generation}`,
          3,
        );
      }
      if (!early && clock.now() >= Date.parse(state.deadline_at)) {
        context.now = new Date(clock.now());
        early = policyArtifact(context, 'wall_clock_expired');
      }
      if (!early && growthRatio > state.growth_stop_ratio) {
        early = policyArtifact(context, 'plan_growth_hard_stop');
      }

      if (!early && opts.generation === 2 && !state.repair_authorized) {
        const previous = JSON.parse(fs.readFileSync(artifactPath(sessionDir, 1), 'utf8'));
        const decisions = loadDispositionFile(opts.dispositionFile, {
          logicalPlanId: manifest.logical_plan_id,
          generation: 1,
        });
        if (!decisions) throw new CliError('generation 2 requires depth-0 disposition input', 3);
        applyDispositions(previous.findings, decisions);
        const unresolved = unresolvedCandidateFingerprints(previous.findings);
        if (unresolved.length > 0) {
          throw new CliError(
            'generation 2 requires disposition for every blocker candidate',
            3,
          );
        }
        const accepted = previous.findings.filter(
          (finding) => finding.disposition === 'accepted_blocker',
        );
        if (accepted.length === 0) {
          early = {
            ...policyArtifact(context, 'no_accepted_blocker_authorizes_generation_2'),
            verdict: 'CONDITIONAL',
            semantic_verdict: 'CONDITIONAL',
          };
        } else {
          state.repair_authorized = true;
          state.accepted_blocker_fingerprints = accepted.map((finding) => finding.fingerprint);
        }
      }
      if (early) {
        state.terminal = true;
        state.terminal_verdict = early.verdict;
        state.terminal_reason = early.policy_reason;
        const outPath = path.join(sessionDir, `terminal-${early.policy_reason}.json`);
        atomicWriteJson(outPath, early);
        state.artifacts.push(outPath);
        atomicWriteJson(statePath, state);
        return;
      }
      const claim = {
        claim_id: claimId,
        generation: opts.generation,
        session_id: opts.sessionId,
        claimed_at: now.toISOString(),
        plan_sha256: planSha,
        manifest_sha256: manifestSha,
        owner: claimOwner(sessionDir, claimId),
      };
      state.active_claim = claim;
      state.claims.push({ ...claim, status: 'in-flight' });
      atomicWriteJson(statePath, state);
    });
  });
  if (early) finish(early, artifactExitCode(early));
  crashAt('after_claim');

  // Validate disposition shape/identity before dispatch when possible so a bad
  // file cannot acquire a durable claim and then escape through the outer catch.
  // Fingerprint binding still runs after findings exist (applyDispositions).
  if (opts.generation === 1 && opts.dispositionFile) {
    try {
      loadDispositionFile(opts.dispositionFile, {
        logicalPlanId: manifest.logical_plan_id,
        generation: 1,
      });
    } catch (error) {
      if (error instanceof CliError || error instanceof TypeError) {
        abortInFlightClaim(sessionDir, statePath, claimId, error.message);
        exitControlledError(error);
      }
      throw error;
    }
  }

  try {
    const deadlineMs = Date.parse(state.deadline_at);
    const sequence = testSequence();
    const selectedTargets = new Map(manifest.seats.map((seat) => [seat.id, seat]));
    const seatReviews = [];
    for (const seat of manifest.seats) {
      const seatReview = reviewSeat({
        manifest,
        seat,
        repoRoot: opts.repoRoot,
        planBytes,
        rubricBytes,
        rubricIds,
        timeoutSeconds: opts.timeoutSeconds,
        sequence,
        selectedTargets,
        deadlineMs,
        clockNow: clock.now,
      });
      seatReviews.push(seatReview);
      if (seatReview.exhausted) selectedTargets.set(seat.id, null);
    }
    const attempts = seatReviews.flatMap((seat) => seat.attempts);
    const substitutions = seatReviews
      .map((seat) => seat.substitution)
      .filter(Boolean);
    const completedReviews = seatReviews.filter((seat) => !seat.exhausted);
    const requiredExhausted = seatReviews.filter((seat) => {
      const policy = manifest.seats.find((candidate) => candidate.id === seat.seat_id);
      return seat.exhausted && policy.required;
    });
    const familyCount = new Set(completedReviews.map((seat) => seat.family)).size;
    context.now = new Date(clock.now());
    let artifact;
    if (clock.now() >= deadlineMs || seatReviews.some((seat) => seat.deadline_exhausted)) {
      artifact = {
        ...policyArtifact(context, 'wall_clock_expired'),
        attempts,
        substitutions,
        reviewer_verdicts: completedReviews.map((seat) => ({
          seat_id: seat.seat_id,
          target_id: seat.target_id,
          family: seat.family,
          verdict: seat.verdict,
        })),
      };
    } else if (requiredExhausted.length > 0) {
      artifact = {
        ...policyArtifact(context, 'required_seat_transport_exhausted'),
        verdict: 'CONDITIONAL',
        semantic_verdict: null,
        transport_status: 'transport_exhausted',
        attempts,
        substitutions,
      };
    } else if (familyCount < manifest.minimum_distinct_families) {
      artifact = {
        ...policyArtifact(context, 'panel_family_diversity_exhausted'),
        // Public verdict stays CONDITIONAL for schema consumers; transport
        // exhaustion has no semantic plan verdict.
        verdict: 'CONDITIONAL',
        semantic_verdict: null,
        transport_status: 'transport_exhausted',
        attempts,
        substitutions,
        reviewer_verdicts: completedReviews.map((seat) => ({
          seat_id: seat.seat_id,
          target_id: seat.target_id,
          family: seat.family,
          verdict: seat.verdict,
        })),
      };
    } else {
      let findings = normalizeAndDedupeFindings(completedReviews, rubricIds);
      const decisions = opts.generation === 1
        ? loadDispositionFile(opts.dispositionFile, {
          logicalPlanId: manifest.logical_plan_id,
          generation: 1,
        })
        : null;
      findings = applyDispositions(findings, decisions, {
        legacyAutoAdmit: loaded.legacy,
      });
      const accepted = findings.filter((finding) => finding.disposition === 'accepted_blocker');
      const unresolved = unresolvedCandidateFingerprints(findings);
      // Preserve whether any blocker candidates existed before disposition. Fully
      // dispositioned zero-accept sets must not leak READY merely because seats
      // also reported READY — READY is reserved for runs with no blocker candidates.
      const hadBlockerCandidates = findings.some((finding) => finding.candidate_blocker);
      const allReady = completedReviews.every((seat) => seat.verdict === 'READY');
      const atGenerationCap = opts.generation >= state.max_generations;
      let verdict;
      let terminal;
      let reason;
      // Authorize repair only when every blocker candidate has a disposition and
      // at least one was accepted. Partial disposition must not open generation 2.
      let repairAuthorized = accepted.length > 0 && unresolved.length === 0;
      if (atGenerationCap) {
        terminal = true;
        repairAuthorized = false;
        if (accepted.length > 0 && unresolved.length === 0) {
          verdict = 'STOP';
          reason = 'generation_cap_with_accepted_blockers';
        } else if (unresolved.length > 0 && !loaded.legacy) {
          verdict = 'CONDITIONAL';
          reason = 'generation_cap_requires_depth_0_adjudication';
        } else {
          // Zero-accept at cap: READY only when no blocker candidates existed.
          verdict = (allReady && !hadBlockerCandidates) ? 'READY' : 'CONDITIONAL';
          reason = opts.generation === 2
            ? 'generation_2_terminal'
            : 'caller_generation_cap_terminal';
        }
      } else if (unresolved.length > 0 && !loaded.legacy) {
        // Incomplete disposition (or none): every candidate still needs depth-0.
        verdict = 'CONDITIONAL';
        terminal = false;
        reason = 'depth_0_adjudication_required';
        repairAuthorized = false;
      } else if (accepted.length > 0) {
        verdict = 'CONDITIONAL';
        terminal = false;
        reason = 'accepted_blockers_authorize_generation_2';
      } else if (allReady && !hadBlockerCandidates) {
        // No blocker candidates and all seats READY → terminal READY.
        verdict = 'READY';
        terminal = true;
        reason = 'no_accepted_blockers';
      } else {
        // Fully dispositioned with zero accepts (including rejected blocker
        // candidates) or non-READY seats → terminal CONDITIONAL. Do not emit
        // depth_0_adjudication_required once no candidates remain unresolved.
        verdict = 'CONDITIONAL';
        terminal = true;
        reason = 'nonblocking_conditional';
      }
      artifact = {
        schema_version: 1,
        artifact_type: 'plan_review_artifact',
        ticket: opts.ticket,
        logical_plan_id: manifest.logical_plan_id,
        session_id: opts.sessionId,
        session_key: sessionKey,
        generation: opts.generation,
        verdict,
        semantic_verdict: verdict,
        terminal,
        policy_reason: reason,
        rubric_sha256: rubricSha,
        manifest_sha256: manifestSha,
        plan_sha256: planSha,
        growth_ratio: context.growthRatioValue,
        growth_warning: growthWarning,
        transport_status: 'complete',
        attempts,
        substitutions,
        reviewer_verdicts: completedReviews.map((seat) => ({
          seat_id: seat.seat_id,
          target_id: seat.target_id,
          family: seat.family,
          verdict: seat.verdict,
        })),
        findings,
        backlog_candidates: backlogCandidates(findings),
        accepted_blocker_count: accepted.length,
        repair_authorized: repairAuthorized,
        next_generation: terminal ? null : opts.generation + 1,
        reviewed_at: context.now.toISOString(),
      };
    }

    withLock(sessionDir, '.claim.lock', () => {
      state = loadState(statePath);
      if (!state.active_claim || state.active_claim.claim_id !== claimId) {
        throw new CliError('active plan-review claim changed before completion', 3);
      }
      const outPath = artifactPath(sessionDir, opts.generation);
      atomicWriteJson(outPath, artifact);
      state.active_claim = null;
      state.artifacts.push(outPath);
      const claim = state.claims.find((item) => item.claim_id === claimId);
      if (claim) {
        claim.status = artifact.transport_status === 'transport_exhausted'
          ? 'transport-exhausted'
          : 'complete';
        claim.artifact = outPath;
        claim.attempt_count = attempts.length;
      }
      if (artifact.terminal) {
        state.terminal = true;
        state.terminal_verdict = artifact.verdict;
        state.terminal_reason = artifact.policy_reason;
      } else {
        state.next_generation = opts.generation + 1;
        state.repair_authorized = artifact.repair_authorized;
      }
      atomicWriteJson(statePath, state);
    });
    finish(artifact, artifactExitCode(artifact));
  } catch (error) {
    if (error instanceof CliError || error instanceof TypeError) {
      abortInFlightClaim(sessionDir, statePath, claimId, error.message);
      exitControlledError(error);
    }
    throw error;
  }
}

try {
  main();
} catch (error) {
  if (error instanceof CliError || error instanceof TypeError) {
    process.stderr.write(`dispatch-plan-review: ${error.message}\n`);
    process.exit(error instanceof CliError ? error.exitCode : 2);
  }
  process.stderr.write(`dispatch-plan-review: ${error.stack || error.message || String(error)}\n`);
  process.exit(2);
}
