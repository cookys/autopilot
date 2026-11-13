#!/usr/bin/env node
'use strict';

/**
 * pace-select.js — pace-aware non-Claude engine selector (PM 01M79D2S).
 *
 * Reads a capacity.pace/1 file, maps pools to engine keys via
 * scripts/lib/noncq-pools.json, filters to engines allowed for --role in
 * scripts/lib/pace-roles.json (minus --exclude), and selects the engine whose
 * best fresh pool has the largest linear-pace slack (expected_pct - used_pct).
 *
 * Rules:
 *   - Rows with class === "claude" are never candidates.
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
 *     [--pace <pace.v1.json>] [--exclude k1,k2] [--json]
 *
 * Default --pace: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json.
 *
 * EXIT: 0 engine selected · 2 bad flags / invalid schema · 3 pace_unknown.
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PACE_SCHEMA, freshReading } = require('./lib/pace-reading.js');

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_PACE_UNKNOWN = 3;
const OVER_PACE_SLACK_FLOOR = -10;

const POOLS_PATH = path.join(__dirname, 'lib', 'noncq-pools.json');
const ROLES_PATH = path.join(__dirname, 'lib', 'pace-roles.json');

const USAGE_TEXT = [
  'usage: pace-select.js --role <role> [--pace <pace.v1.json>] [--exclude k1,k2] [--json]',
  '  --role R        Role to select for (reviewer|implementer|author; required)',
  '  --pace F        capacity.pace/1 file (default: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json)',
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

function selectEngine({ pace, pools, roles, role, exclude } = {}) {
  const resolvedPools = pools === undefined ? loadPools() : pools;
  const resolvedRoles = roles === undefined ? loadRoles() : roles;
  if (!resolvedPools || typeof resolvedPools !== 'object' || Array.isArray(resolvedPools)) {
    throw usageError('pools must be an object');
  }
  if (!resolvedRoles || typeof resolvedRoles !== 'object' || Array.isArray(resolvedRoles)) {
    throw usageError('roles must be an object');
  }
  assertValidRole(resolvedRoles, role);

  if (
    !pace
    || typeof pace !== 'object'
    || Array.isArray(pace)
    || pace.schema !== PACE_SCHEMA
    || !Array.isArray(pace.rows)
  ) {
    throw usageError(`pace input must have schema ${JSON.stringify(PACE_SCHEMA)} and rows[]`);
  }

  const excluded = normalizeExclude(exclude);
  const allowedKeys = resolvedRoles[role].filter(
    (k) => typeof k === 'string' && k.length > 0 && !excluded.has(k),
  );
  const allowedSet = new Set(allowedKeys);

  const bestByKey = new Map();
  for (const row of pace.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (row.class === 'claude') continue;
    const poolName = typeof row.pool === 'string' ? row.pool : '';
    if (!poolName || !Object.prototype.hasOwnProperty.call(resolvedPools, poolName)) continue;
    const entry = resolvedPools[poolName];
    if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string') continue;
    const key = entry.key;
    if (!allowedSet.has(key)) continue;
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

  return {
    engine: chosen.key,
    runner: chosen.entry.runner ?? null,
    model: chosen.entry.model ?? null,
    pool: chosen.reading.pool,
    slack_pts: chosen.reading.slack,
    used_pct: chosen.reading.used_pct,
    expected_pct: chosen.reading.expected_pct,
    over_pace: overPace,
    role,
    pace_generated_at: paceGeneratedAt,
    candidates,
  };
}

function parseArgs(argv) {
  const out = {
    help: false,
    role: null,
    pace: null,
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
    if (a === '--role' || a === '--pace' || a === '--exclude') {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) {
        throw usageError(`flag ${a} requires a value`);
      }
      i += 1;
      if (a === '--role') out.role = val;
      else if (a === '--pace') out.pace = val;
      else out.exclude.push(val);
      continue;
    }
    if (a.startsWith('--role=')) {
      out.role = a.slice('--role='.length);
      continue;
    }
    if (a.startsWith('--pace=')) {
      out.pace = a.slice('--pace='.length);
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
  defaultPacePath,
  main,
  POOLS_PATH,
  ROLES_PATH,
  OVER_PACE_SLACK_FLOOR,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_PACE_UNKNOWN,
};
