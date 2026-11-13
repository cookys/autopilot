#!/usr/bin/env node
'use strict';

/**
 * pace-select.js — pace-aware non-Claude engine selector (PM 01M79D2S).
 *
 * Reads a capacity.pace/1 file, maps pools to engine keys via
 * scripts/lib/noncq-pools.json merged with scripts/lib/pace-roles.json `pools`
 * (which supplies scarce pools such as "codex A" / "codex B" excluded from
 * noncq drain), determines role eligibility from an autopilot.qualified/1 file
 * when present (pass or provisional row matching pool runner + model; falls
 * back to pace-roles.json when missing, reporting qualified_source) minus
 * --exclude, checks endpoint readiness for any candidate pool with an
 * `endpoint` field via scripts/resolve-endpoint.sh, and selects the engine
 * whose best fresh pool has the largest linear-pace slack
 * (expected_pct - used_pct).
 *
 * Rules:
 *   - Rows with class === "claude" are never candidates; class === "scarce"
 *     and class === "other" rows are read.
 *   - Candidate pools with `endpoint` must pass `resolve-endpoint.sh <endpoint>`
 *     (`ready === true`); otherwise the candidate is listed as
 *     `{ engine, reason: "endpoint_not_ready" }` and never chosen.
 *   - Missing/null used_pct or expected_pct, or stale !== false, is unknown
 *     (never treated as 0) via scripts/lib/pace-reading.js.
 *   - Alias pools sharing an engine key merge by largest fresh slack.
 *   - Among keys with slack >= -10, pick the largest slack (over_pace: false).
 *   - If none has slack >= -10 but at least one key has a fresh reading, pick
 *     the largest slack anyway with over_pace: true.
 *   - If no candidate key has a known fresh reading, emit
 *     { engine: null, reason: "pace_unknown", ... } and exit 3.
 *
 * USAGE:
 *   node scripts/pace-select.js --role <reviewer|implementer|author>
 *     [--pace <pace.v1.json>] [--qualified <qualified.v1.json>]
 *     [--exclude k1,k2] [--json]
 *
 * Default --pace: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json.
 * Default --qualified: $AUTOPILOT_QUALIFIED_FILE, else $HOME/.autopilot/qualified.v1.json.
 *
 * EXIT: 0 engine selected · 2 bad flags / invalid schema · 3 pace_unknown.
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PACE_SCHEMA, freshReading } = require('./lib/pace-reading.js');
const { sameEngine } = require('./lib/engine-spelling.js');

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_PACE_UNKNOWN = 3;
const OVER_PACE_SLACK_FLOOR = -10;
const QUALIFIED_SCHEMA = 'autopilot.qualified/1';
const VALID_QUALIFIED_RESULTS = new Set(['pass', 'fail', 'provisional']);

const POOLS_PATH = path.join(__dirname, 'lib', 'noncq-pools.json');
const ROLES_PATH = path.join(__dirname, 'lib', 'pace-roles.json');
const RESOLVE_ENDPOINT_SH = path.join(__dirname, 'resolve-endpoint.sh');

const USAGE_TEXT = [
  'usage: pace-select.js --role <role> [--pace <pace.v1.json>] [--qualified <qualified.v1.json>] [--exclude k1,k2] [--json]',
  '  --role R        Role to select for (reviewer|implementer|author; required)',
  '  --pace F        capacity.pace/1 file (default: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json)',
  '  --qualified F   autopilot.qualified/1 file (default: $AUTOPILOT_QUALIFIED_FILE, else $HOME/.autopilot/qualified.v1.json; falls back to pace-roles.json when missing)',
  '  --exclude k1,k2 Comma-separated engine keys to exclude',
  '  --json          Emit JSON output (default)',
  '',
].join('\n');

function usageError(message) {
  const err = new Error(message);
  err.exitCode = EXIT_USAGE;
  return err;
}

function resolveHome(env = process.env) {
  return (typeof env.HOME === 'string' && env.HOME.trim() !== '')
    ? env.HOME.trim()
    : os.homedir();
}

function expandHome(raw, env = process.env) {
  if (typeof raw !== 'string' || raw === '') return raw;
  const home = resolveHome(env);
  if (raw === '~') return home;
  if (raw.startsWith('~/') || raw.startsWith(`~${path.sep}`)) {
    return path.join(home, raw.slice(2));
  }
  return raw;
}

function defaultPacePath(env = process.env) {
  if (typeof env.AUTOPILOT_PACE_FILE === 'string' && env.AUTOPILOT_PACE_FILE.trim() !== '') {
    return path.resolve(expandHome(env.AUTOPILOT_PACE_FILE.trim(), env));
  }
  return path.join(resolveHome(env), 'projects', 'capacity', 'out', 'pace.v1.json');
}

function defaultQualifiedPath(env = process.env) {
  if (typeof env.AUTOPILOT_QUALIFIED_FILE === 'string' && env.AUTOPILOT_QUALIFIED_FILE.trim() !== '') {
    return path.resolve(expandHome(env.AUTOPILOT_QUALIFIED_FILE.trim(), env));
  }
  return path.join(resolveHome(env), '.autopilot', 'qualified.v1.json');
}

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw usageError(`${label} (${filePath}): ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw usageError(`${label} must be a JSON object`);
  }
  return parsed;
}

function loadPools(poolsPath = POOLS_PATH) {
  return readJsonObject(poolsPath, 'noncq-pools.json');
}

function loadRoles(rolesPath = ROLES_PATH) {
  return readJsonObject(rolesPath, 'pace-roles.json');
}

function mergePools(pools, roles) {
  const rolePools = (
    roles
    && typeof roles.pools === 'object'
    && roles.pools !== null
    && !Array.isArray(roles.pools)
  )
    ? roles.pools
    : {};
  return { ...rolePools, ...pools };
}

function defaultCheckEndpoint(endpoint, env = process.env) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return false;
  const res = spawnSync('bash', [RESOLVE_ENDPOINT_SH, endpoint.trim()], {
    encoding: 'utf8',
    env,
    input: '',
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
    return false;
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return Boolean(parsed && parsed.ready === true);
  } catch (_err) {
    return false;
  }
}

function validRoleNames(roles) {
  return Object.keys(roles)
    .filter((k) => !k.startsWith('_') && Array.isArray(roles[k]))
    .sort();
}

function assertValidRole(roles, role) {
  if (
    typeof role !== 'string'
    || role.trim() === ''
    || role.startsWith('_')
    || !Object.prototype.hasOwnProperty.call(roles, role)
    || !Array.isArray(roles[role])
  ) {
    throw usageError(`--role must be one of ${validRoleNames(roles).join('|')} (got ${JSON.stringify(role)})`);
  }
}

function normalizeExclude(exclude) {
  if (exclude === undefined || exclude === null || exclude === '') return new Set();
  if (exclude instanceof Set) {
    return new Set([...exclude].map((s) => String(s).trim()).filter(Boolean));
  }
  if (Array.isArray(exclude)) {
    const out = new Set();
    for (const item of exclude) {
      for (const part of String(item).split(',')) {
        const k = part.trim();
        if (k) out.add(k);
      }
    }
    return out;
  }
  if (typeof exclude === 'string') {
    return new Set(exclude.split(',').map((s) => s.trim()).filter(Boolean));
  }
  throw usageError('--exclude must be a comma-separated string, array, or Set');
}

function normRunner(r) {
  if (typeof r !== 'string') return '';
  const trimmed = r.trim();
  return trimmed === 'codex-cli' ? 'codex' : trimmed;
}

function qualifiedRoleMatches(rowRole, requestedRole) {
  if (rowRole === requestedRole) return true;
  if (requestedRole === 'author' && rowRole === 'verification_author') return true;
  return false;
}

function validateQualified(qualified) {
  if (
    !qualified
    || typeof qualified !== 'object'
    || Array.isArray(qualified)
    || qualified.schema !== QUALIFIED_SCHEMA
    || !Array.isArray(qualified.rows)
  ) {
    throw usageError(`qualified input must have schema ${JSON.stringify(QUALIFIED_SCHEMA)} and rows[]`);
  }
  for (let i = 0; i < qualified.rows.length; i += 1) {
    const row = qualified.rows[i];
    if (
      !row
      || typeof row !== 'object'
      || Array.isArray(row)
      || typeof row.engine !== 'string'
      || row.engine.trim() === ''
      || typeof row.runner !== 'string'
      || row.runner.trim() === ''
      || typeof row.role !== 'string'
      || row.role.trim() === ''
      || !VALID_QUALIFIED_RESULTS.has(row.result)
    ) {
      throw usageError(
        `qualified.rows[${i}] must have non-empty engine, runner, role, and result in pass|fail|provisional`,
      );
    }
  }
}

function poolEntryEligibleInQualified(entry, role, qualifiedRows) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (typeof entry.runner !== 'string' || typeof entry.model !== 'string') return false;
  const entryRunner = normRunner(entry.runner);
  const entryModel = entry.model.trim();
  if (!entryRunner || !entryModel) return false;

  for (const row of qualifiedRows) {
    if (row.result !== 'pass' && row.result !== 'provisional') continue;
    if (!qualifiedRoleMatches(row.role.trim(), role)) continue;
    if (normRunner(row.runner) !== entryRunner) continue;
    if (sameEngine(row.engine.trim(), entryModel)) return true;
  }
  return false;
}

function selectEngine({
  pace,
  pools,
  roles,
  role,
  exclude,
  checkEndpoint,
  qualified,
  qualifiedSource,
} = {}) {
  const resolvedPools = pools === undefined ? loadPools() : pools;
  const resolvedRoles = roles === undefined ? loadRoles() : roles;
  if (!resolvedPools || typeof resolvedPools !== 'object' || Array.isArray(resolvedPools)) {
    throw usageError('pools must be an object');
  }
  if (!resolvedRoles || typeof resolvedRoles !== 'object' || Array.isArray(resolvedRoles)) {
    throw usageError('roles must be an object');
  }
  if (checkEndpoint !== undefined && typeof checkEndpoint !== 'function') {
    throw usageError('checkEndpoint must be a function');
  }
  assertValidRole(resolvedRoles, role);

  const useQualified = qualified !== undefined && qualified !== null;
  if (useQualified) {
    validateQualified(qualified);
  }
  const resolvedQualifiedSource = useQualified
    ? (typeof qualifiedSource === 'string' && qualifiedSource.trim() !== ''
      ? qualifiedSource
      : 'qualified.v1.json')
    : 'pace-roles.json';

  if (
    !pace
    || typeof pace !== 'object'
    || Array.isArray(pace)
    || pace.schema !== PACE_SCHEMA
    || !Array.isArray(pace.rows)
  ) {
    throw usageError(`pace input must have schema ${JSON.stringify(PACE_SCHEMA)} and rows[]`);
  }

  const mergedPools = mergePools(resolvedPools, resolvedRoles);
  const excluded = normalizeExclude(exclude);
  let allowedKeys;
  if (useQualified) {
    const eligibleKeys = new Set();
    for (const entry of Object.values(mergedPools)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (typeof entry.key !== 'string' || entry.key.length === 0) continue;
      if (excluded.has(entry.key)) continue;
      if (poolEntryEligibleInQualified(entry, role, qualified.rows)) {
        eligibleKeys.add(entry.key);
      }
    }
    allowedKeys = [];
    const seen = new Set();
    for (const k of resolvedRoles[role]) {
      if (typeof k === 'string' && eligibleKeys.has(k) && !seen.has(k)) {
        seen.add(k);
        allowedKeys.push(k);
      }
    }
    for (const k of eligibleKeys) {
      if (!seen.has(k)) {
        seen.add(k);
        allowedKeys.push(k);
      }
    }
  } else {
    allowedKeys = resolvedRoles[role].filter(
      (k) => typeof k === 'string' && k.length > 0 && !excluded.has(k),
    );
  }
  const allowedSet = new Set(allowedKeys);

  const endpointProbe = checkEndpoint || defaultCheckEndpoint;
  const endpointCache = new Map();
  const isEndpointReady = (ep) => {
    if (endpointCache.has(ep)) return endpointCache.get(ep);
    const ready = Boolean(endpointProbe(ep));
    endpointCache.set(ep, ready);
    return ready;
  };

  // Determine endpoint readiness per candidate pool before scanning pace rows.
  const readyPools = new Map();
  const keyHadPool = new Set();
  const keyHadReadyPool = new Set();
  for (const [poolName, entry] of Object.entries(mergedPools)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.key !== 'string' || !allowedSet.has(entry.key)) continue;
    if (useQualified && !poolEntryEligibleInQualified(entry, role, qualified.rows)) continue;
    keyHadPool.add(entry.key);
    const endpoint = typeof entry.endpoint === 'string' ? entry.endpoint.trim() : '';
    if (endpoint !== '' && !isEndpointReady(endpoint)) {
      continue;
    }
    keyHadReadyPool.add(entry.key);
    readyPools.set(poolName, entry);
  }

  const bestByKey = new Map();
  for (const row of pace.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (row.class === 'claude') continue;
    const poolName = typeof row.pool === 'string' ? row.pool : '';
    if (!poolName || !readyPools.has(poolName)) continue;
    const entry = readyPools.get(poolName);
    const key = entry.key;
    const reading = freshReading(row);
    if (!reading) continue;

    const prev = bestByKey.get(key);
    if (!prev || reading.slack > prev.reading.slack) {
      bestByKey.set(key, { key, entry, reading });
    }
  }

  const paceGeneratedAt = typeof pace.generated_at === 'string'
    ? pace.generated_at
    : (typeof pace.pace_generated_at === 'string' ? pace.pace_generated_at : null);

  const candidates = [];
  const known = [];
  for (const key of allowedKeys) {
    if (keyHadPool.has(key) && !keyHadReadyPool.has(key)) {
      candidates.push({
        engine: key,
        reason: 'endpoint_not_ready',
      });
      continue;
    }
    const hit = bestByKey.get(key);
    if (hit) {
      candidates.push({
        engine: key,
        pool: hit.reading.pool,
        slack_pts: hit.reading.slack,
      });
      known.push(hit);
    } else {
      candidates.push({
        engine: key,
        reason: 'unknown',
      });
    }
  }

  if (known.length === 0) {
    return {
      engine: null,
      reason: 'pace_unknown',
      role,
      qualified_source: resolvedQualifiedSource,
      pace_generated_at: paceGeneratedAt,
      candidates,
    };
  }

  const qualifying = known.filter((item) => item.reading.slack >= OVER_PACE_SLACK_FLOOR);
  const poolToPick = qualifying.length > 0 ? qualifying : known;
  const overPace = qualifying.length === 0;

  let chosen = poolToPick[0];
  for (let i = 1; i < poolToPick.length; i += 1) {
    if (poolToPick[i].reading.slack > chosen.reading.slack) {
      chosen = poolToPick[i];
    }
  }

  const out = {
    engine: chosen.key,
    runner: chosen.entry.runner ?? null,
    model: chosen.entry.model ?? null,
    pool: chosen.reading.pool,
    slack_pts: chosen.reading.slack,
    used_pct: chosen.reading.used_pct,
    expected_pct: chosen.reading.expected_pct,
    over_pace: overPace,
    role,
    qualified_source: resolvedQualifiedSource,
    pace_generated_at: paceGeneratedAt,
    candidates,
  };
  if (typeof chosen.entry.endpoint === 'string' && chosen.entry.endpoint.trim() !== '') {
    out.endpoint = chosen.entry.endpoint.trim();
  }
  return out;
}

function parseArgs(argv) {
  const out = {
    help: false,
    role: null,
    pace: null,
    qualified: null,
    exclude: [],
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--role' || a === '--pace' || a === '--qualified' || a === '--exclude') {
      const val = argv[i + 1];
      if (val === undefined || val === '' || val.startsWith('--')) {
        throw usageError(`flag ${a} requires a value`);
      }
      i += 1;
      if (a === '--role') out.role = val;
      else if (a === '--pace') out.pace = val;
      else if (a === '--qualified') out.qualified = val;
      else out.exclude.push(val);
      continue;
    }
    if (a.startsWith('--role=')) {
      out.role = a.slice('--role='.length);
      continue;
    }
    if (a.startsWith('--pace=')) {
      const val = a.slice('--pace='.length);
      if (val === '') throw usageError('flag --pace requires a value');
      out.pace = val;
      continue;
    }
    if (a.startsWith('--qualified=')) {
      const val = a.slice('--qualified='.length);
      if (val === '') throw usageError('flag --qualified requires a value');
      out.qualified = val;
      continue;
    }
    if (a.startsWith('--exclude=')) {
      out.exclude.push(a.slice('--exclude='.length));
      continue;
    }
    throw usageError(`unknown argument: ${a}`);
  }
  return out;
}

function main(argv = process.argv.slice(2), env = process.env) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`pace-select.js: ${err.message}\n${USAGE_TEXT}`);
    return EXIT_USAGE;
  }

  if (flags.help) {
    process.stdout.write(USAGE_TEXT);
    return EXIT_OK;
  }

  if (!flags.role) {
    process.stderr.write(`pace-select.js: --role is required\n${USAGE_TEXT}`);
    return EXIT_USAGE;
  }

  let pools;
  let roles;
  try {
    pools = loadPools(env.AUTOPILOT_NONCQ_POOLS || POOLS_PATH);
    roles = loadRoles(env.AUTOPILOT_PACE_ROLES || ROLES_PATH);
    assertValidRole(roles, flags.role);
  } catch (err) {
    process.stderr.write(`pace-select.js: ${err.message}\n`);
    return EXIT_USAGE;
  }

  const qualifiedPath = flags.qualified !== null
    ? path.resolve(expandHome(flags.qualified, env))
    : defaultQualifiedPath(env);

  let qualified = null;
  let qualifiedSource = 'pace-roles.json';
  let rawQualified = null;
  try {
    rawQualified = fs.readFileSync(qualifiedPath, 'utf8');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      process.stderr.write(`pace-select.js: cannot read qualified file (${qualifiedPath}): ${err.message}\n`);
      return EXIT_USAGE;
    }
  }
  if (rawQualified !== null) {
    try {
      qualified = JSON.parse(rawQualified);
      validateQualified(qualified);
    } catch (err) {
      process.stderr.write(`pace-select.js: invalid qualified file (${qualifiedPath}): ${err.message}\n`);
      return EXIT_USAGE;
    }
    qualifiedSource = qualifiedPath;
  }

  const checkEndpoint = (ep) => defaultCheckEndpoint(ep, env);
  const pacePath = flags.pace !== null
    ? path.resolve(expandHome(flags.pace, env))
    : defaultPacePath(env);

  let rawPace;
  try {
    rawPace = fs.readFileSync(pacePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      process.stderr.write(`pace-select.js: pace file not found: ${pacePath}\n`);
      const unknownResult = selectEngine({
        pace: { schema: PACE_SCHEMA, generated_at: null, rows: [] },
        pools,
        roles,
        role: flags.role,
        exclude: flags.exclude,
        checkEndpoint,
        qualified,
        qualifiedSource,
      });
      process.stdout.write(`${JSON.stringify(unknownResult, null, 2)}\n`);
      return EXIT_PACE_UNKNOWN;
    }
    process.stderr.write(`pace-select.js: cannot read pace file (${pacePath}): ${err.message}\n`);
    return EXIT_USAGE;
  }

  let pace;
  try {
    pace = JSON.parse(rawPace);
  } catch (err) {
    process.stderr.write(`pace-select.js: pace file is not JSON (${pacePath}): ${err.message}\n`);
    return EXIT_USAGE;
  }

  let result;
  try {
    result = selectEngine({
      pace,
      pools,
      roles,
      role: flags.role,
      exclude: flags.exclude,
      checkEndpoint,
      qualified,
      qualifiedSource,
    });
  } catch (err) {
    process.stderr.write(`pace-select.js: ${err.message}\n`);
    return err.exitCode || EXIT_USAGE;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.engine === null ? EXIT_PACE_UNKNOWN : EXIT_OK;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  selectEngine,
  loadPools,
  loadRoles,
  mergePools,
  defaultCheckEndpoint,
  defaultPacePath,
  defaultQualifiedPath,
  main,
  POOLS_PATH,
  ROLES_PATH,
  RESOLVE_ENDPOINT_SH,
  OVER_PACE_SLACK_FLOOR,
  QUALIFIED_SCHEMA,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_PACE_UNKNOWN,
};
