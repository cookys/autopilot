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
 * whose best fresh pool has the largest quota score:
 * (100 - used_pct) / max(hours_to_reset, 1). Ties use larger linear-pace
 * slack (expected_pct - used_pct), then priority.<role> order.
 *
 * Rules:
 *   - Rows with class === "claude" are never candidates; class === "scarce"
 *     and class === "other" rows are read.
 *   - Candidate pools with `endpoint` must pass `resolve-endpoint.sh <endpoint>`
 *     (`ready === true`); otherwise the candidate is listed as
 *     `{ engine, reason: "endpoint_not_ready" }` and never chosen.
 *   - Fresh rows need finite used_pct, expected_pct and reset hours (or a future reset_at).
 *   - stale === true is usable as stale_recent only with finite used_pct, a
 *     future reset_at and seen_at within the last 24 h. Every fresh row ranks
 *     before every stale_recent row. Older/incomplete rows stay unknown.
 *   - A recent stale row may lack expected_pct: its slack stays unknown, never zero.
 *   - Alias pools sharing an engine key merge by quota score, then slack.
 *   - used_pct >= PACE_CEILING_PCT (pace-roles.json, default 85) is over_ceiling
 *     and cannot be selected automatically.
 *   - priority.<role> is only a tie-breaker, never a preference before quota.
 *   - WARN_*_low readings remain visible in low_keys; quota score sets rank.
 *   - The emitted `model` comes from pace-roles.json `role_models.<role>.<key>`
 *     when present (agy -> gemini-4-hydrogen-low; codex -> gpt-6.1-terra), else
 *     the pool entry's model. An unpinned `--dispatch` (no named runner/model/
 *     endpoint) may only emit `unpinned_seats` (grok-4.7/low, gpt-6.1-terra/low,
 *     gemini-4-hydrogen-low/low, opencode-go/beam-free/default) and sets `effort`.
 *   - `reviewer_exclude` lists the chosen key's family keys that a reviewer
 *     must not share. agy and agyclaude are different families (google vs
 *     anthropic), so choosing agy emits ["agy"] and never excludes agyclaude;
 *     callers pass it to a follow-up `--role reviewer --exclude <joined>`.
 *   - A pool with `available_dates_file` is offered only when today's Asia/Taipei
 *     date is a line of that file (one YYYY-MM-DD per line; blank lines and lines
 *     starting with # are ignored) AND its `available_window` holds. `~` expands
 *     to $HOME. AUTOPILOT_DS_SEAM_DAYS_FILE overrides the path. The file is read
 *     at pick time, never cached. Missing or unreadable: seam_days_unreadable.
 *     A non-blank non-comment line that is not YYYY-MM-DD: bad_available_dates.
 *     Date not listed: not_seam_day. Outside the window stays outside_window.
 *     Absent the key, the window rule is unchanged. A skipped seat is not chosen.
 *   - If no candidate key has a usable reading, emit
 *     { engine: null, reason: "pace_unknown", low_keys: [], ... } and exit 3.
 *     If ceiling exclusions exhaust the candidates, reason is "over_ceiling".
 *
 * Behind-pace preference (cursor and kimi implementers only): when eligible and
 * behind pace, cursor or kimi gets a yes/no preference before normally-scored
 * candidates — never scaled or boosted proportionally by how many points behind
 * a pool is. A fresh pace row with finite used_pct and expected_pct wins
 * (`basis: "pace"`, behind = status `ALERT_behind` or `behind_early`; for kimi,
 * reading freshness is judged by row `seen_at` within 24 h, never by `reset_at`
 * or file mtime); otherwise scripts/lib/broker-run-pace.js counts today's
 * completed Asia/Taipei broker runs from the audit TSV (`basis: "proxy_runs"`,
 * expected_runs = daily_target * elapsed_day_fraction). The proxy measures runs
 * per day, not quota percent, and is retired automatically when a fresh reading
 * exists. Missing/unreadable audit -> `basis: "none"` and old fallback rules.
 *
 * Ahead-of-pace demotion: a candidate with a fresh `WARN_ahead` row is demoted
 * (`basis: "pace"`, `demoted: "ahead"`) and picked only if no non-ahead eligible
 * candidate exists. Missing or stale pace data causes no demotion.
 *
 * USAGE:
 *   node scripts/pace-select.js --role <reviewer|implementer|author>
 *     [--pace <pace.v1.json>] [--qualified <qualified.v1.json>]
 *     [--exclude k1,k2] [--json]
 *
 * Default --pace: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json.
 * Default --qualified: $AUTOPILOT_QUALIFIED_FILE, else $HOME/.autopilot/qualified.v1.json.
 *
 * --dispatch is the shell adapter: five newline-separated values (runner, model,
 * endpoint, full selector JSON, pace_choice JSON). It prints the selection to
 * stderr. --named-runner/--named-model emit only a fresh over-ceiling warning.
 * Missing/unreadable/invalid pace data emits pace_unknown and exits 0 with no
 * selection so rails retain their existing defaults. No capacity schema changes.
 * Task context: --prompt-file (repeatable) feeds the operator-based cloud gate before
 * ranking. --exclude-family and --exclude-model constrain reviewer retreats.
 * EXIT: 0 selected · 2 bad flags/config/schema · 3 no admissible quota reading.
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PACE_SCHEMA,
  SEEN_AT_FRESH_MS,
  finiteNum,
  isAheadPaceStatus,
  isFreshRowForKey,
  isSeenAtFresh,
} = require('./lib/pace-reading.js');
const { sameEngine, isChineseFamily } = require('./lib/engine-spelling.js');
const { BEHIND_PACE_KEYS, evaluateBehindSignal } = require('./lib/broker-run-pace.js');

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_PACE_UNKNOWN = 3;
const OVER_PACE_SLACK_FLOOR = -10;
const QUALIFIED_SCHEMA = 'autopilot.qualified/1';
const VALID_QUALIFIED_RESULTS = new Set(['pass', 'fail', 'provisional']);

// agy and agyclaude share the "agy" runner but are different model families
// (google vs anthropic): excluding one never excludes the other.
const REVIEWER_FAMILY_EXCLUDE = { agy: ['agy'], glm: ['glm'], agyclaude: ['agyclaude'] };

const POOLS_PATH = path.join(__dirname, 'lib', 'noncq-pools.json');
const ROLES_PATH = path.join(__dirname, 'lib', 'pace-roles.json');
const RESOLVE_ENDPOINT_SH = path.join(__dirname, 'resolve-endpoint.sh');
const ENDPOINT_PROBE_JS = path.join(__dirname, 'lib', 'endpoint-probe.js');

const USAGE_TEXT = [
  'usage: pace-select.js --role <role> [--pace <pace.v1.json>] [--qualified <qualified.v1.json>] [--exclude k1,k2] [--scope mechanical] [--now <ISO>] [--json]',
  '  --role R        Role to select for (reviewer|implementer|author; required)',
  '  --pace F        capacity.pace/1 file (default: $AUTOPILOT_PACE_FILE, else $HOME/projects/capacity/out/pace.v1.json)',
  '  --qualified F   autopilot.qualified/1 file (default: $AUTOPILOT_QUALIFIED_FILE, else $HOME/.autopilot/qualified.v1.json; falls back to pace-roles.json when missing)',
  '  --exclude k1,k2 Comma-separated engine keys to exclude',
  '  --scope S       Work scope; a cn_gate (Chinese-family restricted) seat is a candidate only with --scope mechanical',
  '  --now ISO       Clock for availability windows and seam-day dates (default: now)',
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

const LOW_STATUS_RE = /^WARN_.*_low$/;

function isLowStatus(status) {
  return typeof status === 'string' && LOW_STATUS_RE.test(status.trim());
}

function defaultPacePath(env = process.env) {
  if (typeof env.AUTOPILOT_PACE_FILE === 'string' && env.AUTOPILOT_PACE_FILE.trim() !== '') {
    return path.resolve(expandHome(env.AUTOPILOT_PACE_FILE.trim(), env));
  }
  return path.join(resolveHome(env), 'projects', 'capacity', 'out', 'pace.v1.json');
}

function resolvePacePath(pacePath, env = process.env) {
  if (typeof pacePath === 'string' && pacePath.trim() !== '') {
    return path.resolve(expandHome(pacePath.trim(), env));
  }
  return defaultPacePath(env);
}

function readPaceFile(pacePath, env = process.env) {
  const resolvedPath = resolvePacePath(pacePath, env);
  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      path: resolvedPath,
      status: err && err.code === 'ENOENT' ? 'missing' : 'unreadable',
      error: err && err.message ? err.message : 'unreadable',
      pace: null,
    };
  }
  let pace;
  try {
    pace = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      path: resolvedPath,
      status: 'invalid_json',
      error: err && err.message ? err.message : 'invalid JSON',
      pace: null,
    };
  }
  return { ok: true, path: resolvedPath, status: 'ok', error: null, pace };
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

function defaultCheckEndpoint(endpoint, env = process.env, entry = null) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return false;
  const res = spawnSync('bash', [RESOLVE_ENDPOINT_SH, endpoint.trim()], {
    encoding: 'utf8',
    env,
    input: '',
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
    return false;
  }
  let ready;
  try {
    const parsed = JSON.parse(res.stdout);
    ready = Boolean(parsed && parsed.ready === true);
  } catch (_err) {
    return false;
  }
  if (!ready) return false;
  // A pool entry with `probe_model` is also live-probed: GET <base>/models must answer 200 and list the model
  // (scripts/lib/endpoint-probe.js, 2 s budget). Anything but decision "ok" is offline, so a restricted seat
  // whose host is down is skipped, never waited for.
  const probeModel = entry && typeof entry.probe_model === 'string' ? entry.probe_model.trim() : '';
  if (probeModel === '') return true;
  const probe = spawnSync('node', [ENDPOINT_PROBE_JS, '--endpoint', endpoint.trim(), '--model', probeModel], {
    encoding: 'utf8',
    env,
    input: '',
    timeout: 10000,
  });
  if (probe.error || probe.status !== 0 || typeof probe.stdout !== 'string') return false;
  try {
    return JSON.parse(probe.stdout.trim()).decision === 'ok';
  } catch (_err) {
    return false;
  }
}

// `available_window` {tz, start:"HH:MM", end:"HH:MM"}: true when `now` falls in [start, end) on the wall clock
// of `tz`. A missing or malformed window never restricts (the entry has none).
function inAvailableWindow(windowSpec, now) {
  if (!windowSpec || typeof windowSpec !== 'object') return true;
  const hm = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/u.exec(String(v || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = hm(windowSpec.start);
  const end = hm(windowSpec.end);
  if (start === null || end === null) return true;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: windowSpec.tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const minutes = get('hour') * 60 + get('minute');
  return minutes >= start && minutes < end;
}

// Asia/Taipei calendar date for seam-day lists. The window's own tz is not reused:
// the file's contract is one YYYY-MM-DD in Asia/Taipei per line.
const SEAM_DAY_TZ = 'Asia/Taipei';
const SEAM_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function taipeiDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEAM_DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`;
}

function isCalendarDate(text) {
  const m = SEAM_DAY_RE.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// null when the seat has no date list, or today's Asia/Taipei date is listed.
// Otherwise not_seam_day | seam_days_unreadable | bad_available_dates.
// The key absent (or null) is not a restriction, and the env override is ignored then.
// A present key that is empty or not a string fails closed (seam_days_unreadable).
function seamDayBlock(entry, now, env = process.env) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (!Object.prototype.hasOwnProperty.call(entry, 'available_dates_file') || entry.available_dates_file == null) {
    return null;
  }
  const spec = entry.available_dates_file;
  if (typeof spec !== 'string' || spec.trim() === '') return 'seam_days_unreadable';
  const override = env && typeof env.AUTOPILOT_DS_SEAM_DAYS_FILE === 'string'
    ? env.AUTOPILOT_DS_SEAM_DAYS_FILE.trim()
    : '';
  const raw = override !== '' ? override : spec.trim();
  let filePath;
  try {
    filePath = path.resolve(expandHome(raw, env || process.env));
  } catch (_err) {
    return 'seam_days_unreadable';
  }
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_err) {
    return 'seam_days_unreadable';
  }
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const today = taipeiDate(clock);
  let listed = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (!isCalendarDate(trimmed)) return 'bad_available_dates';
    if (trimmed === today) listed = true;
  }
  return listed ? null : 'not_seam_day';
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

// Noncq retains its strict freshness contract; only this selector admits recent stale rows.
// For kimi, reading freshness is judged by row seen_at within 24 h, never by reset_at or file mtime.
function quotaReading(row, now = new Date(), key = null) {
  const used = finiteNum(row.used_pct);
  if (used === null) return null;
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const reset = typeof row.reset_at === 'string' ? Date.parse(row.reset_at) : NaN;
  if (key === 'kimi') {
    if (!isSeenAtFresh(row, clock)) return null;
    const expected = finiteNum(row.expected_pct);
    if (expected === null) return null;
    const hours = finiteNum(row.hours_to_reset)
      ?? (reset > clock.getTime() ? (reset - clock.getTime()) / 3600000 : null);
    return {
      pool: row.pool,
      used_pct: used,
      expected_pct: expected,
      slack: expected - used,
      hours_to_reset: hours,
      reset_at: Number.isFinite(reset) ? row.reset_at : null,
      status: 'fresh',
      score: hours !== null ? (100 - used) / Math.max(hours, 1) : -Infinity,
    };
  }
  if (![false, true].includes(row.stale)) return null;
  const seen = typeof row.seen_at === 'string' ? Date.parse(row.seen_at) : NaN;
  const age = clock.getTime() - seen;
  const recent = row.stale === true;
  if (recent && !(reset > clock.getTime() && age >= 0 && age <= SEEN_AT_FRESH_MS)) return null;
  const hours = finiteNum(row.hours_to_reset)
    ?? (reset > clock.getTime() ? (reset - clock.getTime()) / 3600000 : null);
  if (hours === null) return null;
  const expected = finiteNum(row.expected_pct);
  if (!recent && expected === null) return null;
  return { pool: row.pool, used_pct: used, expected_pct: expected,
    slack: expected === null ? null : expected - used, hours_to_reset: hours,
    reset_at: Number.isFinite(reset) ? row.reset_at : null,
    status: recent ? 'stale_recent' : 'fresh', score: (100 - used) / Math.max(hours, 1) };
}

function compareDesc(aVal, bVal) {
  if (aVal === bVal) return 0;
  return bVal > aVal ? 1 : -1;
}

function compareReadings(a, b) {
  const rank = r => ['schedule_only', 'observed_available'].includes(r.status) ? 2 : Number(r.status === 'stale_recent');
  return (rank(a) - rank(b))
    || compareDesc(a.score, b.score)
    || compareDesc(a.slack ?? -Infinity, b.slack ?? -Infinity);
}

function selectEngine({
  pace,
  pools,
  roles,
  role,
  exclude,
  checkEndpoint,
  files = [],
  excludeFamily,
  qualified,
  qualifiedSource,
  scope,
  now,
  env,
  cwd,
  dispatchCheap = false,
} = {}) {
  const resolvedEnv = env && typeof env === 'object' ? env : process.env;
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

  const mergedPools = Object.fromEntries(Object.entries(mergePools(resolvedPools, resolvedRoles)).map(([name, entry]) => [name,
    entry && typeof entry === 'object' ? { ...entry, model: resolvedRoles.role_models?.[role]?.[entry.key] || entry.model } : entry]));
  const excluded = normalizeExclude(exclude);
  // pace-roles.json `_disabled`: keys kept in the tables but never offered by the picker (operator: test before enabling).
  // kimi has no usage command: a dispatch-observed exhaustion (kimi-quota-observe.js) is unpickable until its reset.
  if (require('./lib/kimi-quota-observe').exhaustedKimi({ env: resolvedEnv, now: now instanceof Date ? now.getTime() : undefined })) excluded.add('kimi');
  const kimiBrokerAvailable = require('./lib/cursor-broker-client').brokerAvailable('kimi', { env: resolvedEnv, now: now instanceof Date ? now.getTime() : undefined });
  const kimiStopped = require('./lib/kimi-local-stop').isStopped(resolvedEnv);
  const stoppedKeys = new Set();
  if (role !== 'implementer' || !kimiBrokerAvailable) {
    excluded.add('kimi');
    for (const entry of Object.values(mergedPools)) {
      if (entry && entry.runner === 'kimi') excluded.add(entry.key);
    }
  }
  if (role !== 'implementer' && kimiStopped) {
    stoppedKeys.add('kimi');
    for (const entry of Object.values(mergedPools)) {
      if (entry && entry.runner === 'kimi') stoppedKeys.add(entry.key);
    }
    for (const key of stoppedKeys) excluded.add(key);
  }
  const cursorState = require('./lib/cursor-quota-observe').cursorState({ env: resolvedEnv, now: now instanceof Date ? now.getTime() : undefined });
  if (role !== 'implementer' || cursorState !== 'available') excluded.add('cursor');
  if (Array.isArray(resolvedRoles._disabled)) for (const k of resolvedRoles._disabled) if (typeof k === 'string') excluded.add(k);
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
  const cheapSeats = (
    dispatchCheap
    && resolvedRoles.unpinned_seats
    && typeof resolvedRoles.unpinned_seats === 'object'
    && !Array.isArray(resolvedRoles.unpinned_seats)
  ) ? resolvedRoles.unpinned_seats : null;
  if (cheapSeats) {
    allowedKeys = Object.keys(cheapSeats).filter((k) => !excluded.has(k) && cheapSeats[k] && typeof cheapSeats[k] === 'object');
  }
  const allowedSet = new Set(allowedKeys);

  const endpointProbe = checkEndpoint || ((ep, entry) => defaultCheckEndpoint(ep, resolvedEnv, entry));
  const endpointCache = new Map();
  const isEndpointReady = (ep, entry) => {
    if (endpointCache.has(ep)) return endpointCache.get(ep);
    const ready = Boolean(endpointProbe(ep, entry));
    endpointCache.set(ep, ready);
    return ready;
  };

  // Determine endpoint readiness per candidate pool before scanning pace rows.
  const readyPools = new Map();
  const keyHadPool = new Set();
  const keyHadReadyPool = new Set();
  const blockedKeys = new Map();
  for (const [poolName, entry] of Object.entries(mergedPools)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.key !== 'string' || !allowedSet.has(entry.key)) continue;
    if (useQualified && !poolEntryEligibleInQualified(entry, role, qualified.rows)) continue;
    keyHadPool.add(entry.key);
    // cn_gate seat (Chinese-family, restricted): only for mechanical scope, inside its
    // availability window, and — when available_dates_file is set — on a listed seam day.
    // Checked before the endpoint probe, so a closed gate costs no network call.
    // Outside the window stays outside_window and does not read the date file.
    // A present available_dates_file on any seat uses the same seamDayBlock helper.
    const clock = now instanceof Date ? now : new Date();
    let blocked = null;
    if (entry.cn_gate === true && scope !== 'mechanical') blocked = 'cn_gate_scope';
    else if (entry.cn_gate === true && !inAvailableWindow(entry.available_window, clock)) blocked = 'outside_window';
    else {
      const seamReason = seamDayBlock(entry, clock, resolvedEnv);
      if (seamReason) blocked = seamReason;
    }
    const cnGate = require('./lib/cn-model-dispatch-gate');
    const isKimiEntry = entry.key === 'kimi' || normRunner(entry.runner) === 'kimi';
    const gateBaseOpts = {
      runner: entry.runner,
      model: entry.model,
      endpoint: entry.endpoint,
      env: resolvedEnv,
      ...(cwd !== undefined ? { cwd } : {}),
    };
    let gate;
    if (isKimiEntry && Array.isArray(files) && files.length > 0) {
      for (const promptFile of files) {
        gate = cnGate.check({ ...gateBaseOpts, files: [promptFile] });
        if (!gate.allowed) break;
      }
    } else {
      gate = cnGate.check({ ...gateBaseOpts, files });
    }
    if (!blocked && !gate.allowed) {
      blocked = isKimiEntry ? `cn_gate:${gate.cls || 'barred'}` : 'cn_model_dispatch_barred';
    }
    if (excludeFamily && excludeFamily.split(',').map(f => f.trim()).includes(gate.family)) blocked = 'same_family';
    if (blocked) {
      blockedKeys.set(entry.key, blocked);
      continue;
    }
    const endpoint = typeof entry.endpoint === 'string' ? entry.endpoint.trim() : '';
    if (endpoint !== '' && !isEndpointReady(endpoint, entry)) {
      continue;
    }
    keyHadReadyPool.add(entry.key);
    readyPools.set(poolName, entry);
  }

  const ceiling = Number.isFinite(resolvedRoles.PACE_CEILING_PCT) ? resolvedRoles.PACE_CEILING_PCT : 85;
  const selectClock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const overCeiling = new Map();
  const bestByKey = new Map();
  for (const row of pace.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    if (row.class === 'claude') continue;
    const poolName = typeof row.pool === 'string' ? row.pool : '';
    if (!poolName || !readyPools.has(poolName)) continue;
    const entry = readyPools.get(poolName);
    const key = entry.key;
    // A fresh high reading must not evade the ceiling through missing pace fields.
    if (isFreshRowForKey(row, key, selectClock) && finiteNum(row.used_pct) !== null && row.used_pct >= ceiling) {
      overCeiling.set(key, { used_pct: row.used_pct, reset_at: row.reset_at ?? null });
      continue;
    }
    const reading = quotaReading(row, selectClock, key);
    if (!reading) continue;
    if (reading.used_pct >= ceiling) {
      overCeiling.set(key, reading);
      continue;
    }
    const heteroReserveRaw = finiteNum(pace.burn_more?.hetero_reserve_pct) ?? finiteNum(pace.hetero_reserve_pct);
    const heteroReservePct = heteroReserveRaw !== null ? heteroReserveRaw : 50;
    if (scope === 'mechanical' && key === 'agy' && reading.used_pct !== null && reading.used_pct >= (100 - heteroReservePct)) {
      blockedKeys.set(key, 'hetero_reserve');
      continue;
    }
    const low = isLowStatus(row.status);
    const ahead = reading.status === 'fresh' && isAheadPaceStatus(row.status);

    const prev = bestByKey.get(key);
    if (
      !prev
      || compareReadings(reading, prev.reading) < 0
    ) {
      bestByKey.set(key, { key, entry, reading, low, ahead });
    }
  }

  const hasPromptFiles = Array.isArray(files) && files.length > 0;
  const behindSignals = new Map();
  for (const key of BEHIND_PACE_KEYS) {
    if (!allowedSet.has(key)) continue;
    const poolNames = new Set();
    for (const [poolName, entry] of Object.entries(mergedPools)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (entry.key !== key) continue;
      if (useQualified && !poolEntryEligibleInQualified(entry, role, qualified.rows)) continue;
      poolNames.add(poolName);
    }
    behindSignals.set(key, evaluateBehindSignal({
      key,
      paceRows: pace.rows,
      poolNames,
      ceiling,
      roles: resolvedRoles,
      now: selectClock,
      env: resolvedEnv,
      expandHome,
    }));
  }

  // Preserve schedule-only diagnostics, but a seat without quota ranks below every usable reading.
  for (const [poolName, entry] of readyPools.entries()) {
    // A successful broker observation admits Cursor without inventing a usage
    // percentage. Rank it behind all measured readings, including recent stale.
    if (entry.key === 'cursor' && cursorState === 'available' && !bestByKey.has(entry.key) && !overCeiling.has(entry.key)) {
      bestByKey.set(entry.key, { key: entry.key, entry, low: false,
        reading: { pool: 'cursor', slack: null, used_pct: null, expected_pct: null, score: -Infinity, status: 'observed_available' } });
    }
    // No usable grok pace row: one live probe (cached 15 min) can admit the seat the way a cursor observation does.
    if (
      role === 'implementer'
      && entry.key === 'grok'
      && !bestByKey.has(entry.key)
      && !overCeiling.has(entry.key)
      && !excluded.has(entry.key)
      && !blockedKeys.has(entry.key)
    ) {
      const grokState = require('./lib/grok-live-probe').grokProbeState({
        env: resolvedEnv,
        now: selectClock,
        model: entry.model,
      });
      if (grokState === 'available') {
        bestByKey.set(entry.key, { key: entry.key, entry, low: false,
          reading: { pool: poolName, slack: null, used_pct: null, expected_pct: null, score: -Infinity, status: 'observed_available' } });
      }
    }
    if (
      BEHIND_PACE_KEYS.has(entry.key)
      && !bestByKey.has(entry.key)
      && !overCeiling.has(entry.key)
      && (entry.key !== 'kimi' || hasPromptFiles)
      && behindSignals.get(entry.key)?.behind === true
    ) {
      const sig = behindSignals.get(entry.key);
      const fr = sig.freshReading;
      bestByKey.set(entry.key, {
        key: entry.key,
        entry,
        low: sig.freshRow ? isLowStatus(sig.freshRow.status) : false,
        reading: fr
          ? {
              pool: fr.pool,
              slack: fr.slack,
              used_pct: fr.used_pct,
              expected_pct: fr.expected_pct,
              reset_at: sig.freshRow?.reset_at ?? null,
              score: -Infinity,
              status: 'fresh',
            }
          : {
              pool: poolName,
              slack: null,
              used_pct: null,
              expected_pct: null,
              reset_at: null,
              score: -Infinity,
              status: 'observed_available',
            },
      });
    }
    if (entry.schedule_only === true && !bestByKey.has(entry.key)) {
      bestByKey.set(entry.key, {
        key: entry.key,
        entry,
        reading: { pool: entry.key, slack: 0, used_pct: null, expected_pct: null, score: -Infinity, status: 'schedule_only' },
        low: false,
      });
    }
  }

  for (const [key, hit] of bestByKey.entries()) {
    if (!BEHIND_PACE_KEYS.has(key)) continue;
    const sig = behindSignals.get(key);
    if (!sig) continue;
    Object.assign(hit.reading, sig.fields);
    const preferEligible = role === 'implementer'
      && (key !== 'kimi' || hasPromptFiles)
      && !blockedKeys.has(key)
      && !overCeiling.has(key);
    if (preferEligible && sig.behind === true) {
      hit.preferBehind = true;
    }
  }
  // Never sole: a cn_gate seat is a candidate only while a non-Chinese-family key has a known reading to pair
  // with it; the pairing key is reported as `pair_with`.
  const pairable = [...bestByKey.values()].filter((h) => h.entry.cn_gate !== true && !isChineseFamily(h.entry.family));
  if (pairable.length === 0) {
    for (const [key, hit] of [...bestByKey.entries()]) {
      if (hit.entry.cn_gate === true) {
        bestByKey.delete(key);
        blockedKeys.set(key, 'no_non_cn_pair');
      }
    }
  }

  const paceGeneratedAt = typeof pace.generated_at === 'string'
    ? pace.generated_at
    : (typeof pace.pace_generated_at === 'string' ? pace.pace_generated_at : null);

  const candidates = [...stoppedKeys].filter((key) => resolvedRoles[role].includes(key) && !resolvedRoles._disabled?.includes(key) && !normalizeExclude(exclude).has(key))
    .map((engine) => ({ engine, reason: 'kimi_local_stopped' }));
  const known = [];
  const lowKeys = [];
  for (const key of allowedKeys) {
    if (blockedKeys.get(key) === 'cn_gate_scope') continue; // not applicable without --scope mechanical: not listed
    const behindFields = behindSignals.get(key)?.fields || {};
    if (blockedKeys.has(key)) {
      candidates.push({ engine: key, reason: blockedKeys.get(key), ...behindFields });
      continue;
    }
    if (keyHadPool.has(key) && !keyHadReadyPool.has(key)) {
      candidates.push({
        engine: key,
        reason: 'endpoint_not_ready',
        ...behindFields,
      });
      continue;
    }
    const hit = bestByKey.get(key);
    if (hit) {
      candidates.push({
        engine: key,
        pool: hit.reading.pool,
        slack_pts: hit.reading.slack,
        ...(hit.reading.status === 'stale_recent' ? { status: 'stale_recent' } : {}),
        ...(hit.ahead ? { basis: 'pace', demoted: 'ahead' } : {}),
        ...behindFields,
      });
      known.push(hit);
      if (hit.low) lowKeys.push(key);
    } else if (overCeiling.has(key)) {
      const r = overCeiling.get(key);
      candidates.push({ engine: key, reason: 'over_ceiling', used_pct: r.used_pct, reset_at: r.reset_at, ...behindFields });
    } else {
      candidates.push({
        engine: key,
        reason: 'unknown',
        ...behindFields,
      });
    }
  }

  if (known.length === 0) {
    return {
      engine: null,
      reason: overCeiling.size ? 'over_ceiling' : 'pace_unknown',
      low_keys: [],
      role,
      qualified_source: resolvedQualifiedSource,
      pace_generated_at: paceGeneratedAt,
      candidates,
    };
  }

  const paceIsStale = pace.stale === true || (paceGeneratedAt !== null && !isSeenAtFresh({ pool: 'pace', seen_at: paceGeneratedAt }, selectClock));
  const rawTargets = !paceIsStale && Array.isArray(pace.burn_more?.targets_in_order)
    ? pace.burn_more.targets_in_order.filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => t.trim())
    : [];
  const targetRank = key => { const i = rawTargets.indexOf(key); return i < 0 ? Infinity : i; };

  const priorityList = Array.isArray(resolvedRoles.priority?.[role]) ? resolvedRoles.priority[role] : [];
  const priorityRank = key => { const i = priorityList.indexOf(key); return i < 0 ? Infinity : i; };
  const statusRank = r => ['schedule_only', 'observed_available'].includes(r.status) ? 2 : Number(r.status === 'stale_recent');
  known.sort((a, b) => {
    if (rawTargets.length > 0) {
      const aT = targetRank(a.key);
      const bT = targetRank(b.key);
      if (aT !== bT) return aT - bT;
    }
    const aAhead = a.ahead === true ? 1 : 0;
    const bAhead = b.ahead === true ? 1 : 0;
    if (aAhead !== bAhead) return aAhead - bAhead;
    const aPref = a.preferBehind === true ? 0 : 1;
    const bPref = b.preferBehind === true ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    // Behind signal is a yes/no preference only: never rank behind pools by how many points/runs behind they are.
    const rd = aPref === 0
      ? ((statusRank(a.reading) - statusRank(b.reading)) || compareDesc(a.reading.score, b.reading.score))
      : compareReadings(a.reading, b.reading);
    if (rd !== 0) return rd;
    const aPrio = priorityRank(a.key);
    const bPrio = priorityRank(b.key);
    if (aPrio !== bPrio) return aPrio - bPrio;
    return 0;
  });
  const chosen = known[0];
  const overPace = chosen.reading.slack !== null && chosen.reading.slack < OVER_PACE_SLACK_FLOOR;
  const selectedBy = chosen.preferBehind === true ? 'behind_pace' : 'quota_score';
  const selectionReason = chosen.preferBehind === true
    ? 'behind_pace'
    : (known[1]?.reading.status === 'stale_recent' && chosen.reading.status === 'fresh' ? 'fresh_before_stale_recent' : 'quota_score');
  const chosenBehindFields = behindSignals.get(chosen.key)?.fields || {};

  // role_models overrides the emitted model per role. An unpinned dispatch
  // uses unpinned_seats (cheap qualified seats only) for model and effort.
  const roleModelMap = (
    resolvedRoles.role_models
    && typeof resolvedRoles.role_models === 'object'
    && !Array.isArray(resolvedRoles.role_models)
    && resolvedRoles.role_models[role]
    && typeof resolvedRoles.role_models[role] === 'object'
    && !Array.isArray(resolvedRoles.role_models[role])
  )
    ? resolvedRoles.role_models[role]
    : {};
  const cheapSeat = cheapSeats && cheapSeats[chosen.key];
  const modelOut = cheapSeat && typeof cheapSeat.model === 'string' && cheapSeat.model.trim() !== ''
    ? cheapSeat.model.trim()
    : (typeof roleModelMap[chosen.key] === 'string' && roleModelMap[chosen.key].trim() !== ''
      ? roleModelMap[chosen.key].trim()
      : (chosen.entry.model ?? null));
  const effortOut = cheapSeat && typeof cheapSeat.effort === 'string' && cheapSeat.effort.trim() !== ''
    ? cheapSeat.effort.trim()
    : null;

  const out = {
    engine: chosen.key,
    runner: chosen.entry.runner ?? null,
    model: modelOut,
    ...(effortOut ? { effort: effortOut } : {}),
    pool: chosen.reading.pool,
    slack_pts: chosen.reading.slack,
    used_pct: chosen.reading.used_pct,
    expected_pct: chosen.reading.expected_pct,
    reset_at: chosen.reading.reset_at ?? null,
    score: chosen.reading.score,
    status: chosen.reading.status,
    ...chosenBehindFields,
    over_pace: overPace,
    selected_by: selectedBy,
    low_keys: lowKeys,
    reviewer_exclude: REVIEWER_FAMILY_EXCLUDE[chosen.key] || [chosen.key],
    role,
    qualified_source: resolvedQualifiedSource,
    pace_generated_at: paceGeneratedAt,
    candidates,
    ranked_candidates: known.map((entry) => ({
      runner: entry.entry.runner ?? null,
      model: cheapSeats?.[entry.key]?.model || roleModelMap[entry.key] || entry.entry.model || null,
      endpoint: entry.entry.endpoint || '',
      effort: cheapSeats?.[entry.key]?.effort || entry.entry.effort || '',
    })),
    runner_up: known[1]?.key ?? null,
    reason: selectionReason,
  };
  if (chosen.entry.cn_gate === true) {
    const pair = pairable.reduce((best, h) => (!best || h.reading.slack > best.reading.slack ? h : best), null);
    out.cn_gate = { scope: 'mechanical', never_sole: true, pair_with: pair ? pair.key : null };
  }
  if (typeof chosen.entry.endpoint === 'string' && chosen.entry.endpoint.trim() !== '') {
    out.endpoint = chosen.entry.endpoint.trim();
  }
  return out;
}

function parseArgs(argv) {
  const out = {
    help: false,
    dispatch: false,
    namedRunner: null,
    namedModel: null,
    namedEndpoint: null,
    files: [],
    excludeFamily: null,
    excludeModel: null,
    role: null,
    pace: null,
    qualified: null,
    exclude: [],
    scope: null,
    now: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }
    if (a === '--dispatch') { out.dispatch = true; continue; }
    const extraFlags = { '--named-runner': 'namedRunner', '--named-model': 'namedModel', '--named-endpoint': 'namedEndpoint', '--prompt-file': 'files', '--exclude-family': 'excludeFamily', '--exclude-model': 'excludeModel' };
    if (extraFlags[a]) {
      const val = argv[++i];
      if (!val || val.startsWith('--')) throw usageError('flag ' + a + ' requires a value');
      if (Array.isArray(out[extraFlags[a]])) out[extraFlags[a]].push(val); else out[extraFlags[a]] = val;
      continue;
    }
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--role' || a === '--pace' || a === '--qualified' || a === '--exclude' || a === '--scope' || a === '--now') {
      const val = argv[i + 1];
      if (val === undefined || val === '' || val.startsWith('--')) {
        throw usageError(`flag ${a} requires a value`);
      }
      i += 1;
      if (a === '--role') out.role = val;
      else if (a === '--pace') out.pace = val;
      else if (a === '--qualified') out.qualified = val;
      else if (a === '--scope') out.scope = val;
      else if (a === '--now') out.now = val;
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

// --dispatch emits five lines: runner, model, endpoint, full choice, pace_choice.
// Named seats are never changed; only fresh over-ceiling usage produces a warning.
function emitSelection(result, flags, pace, pools, roles, nowDate = null) {
  if (!flags.dispatch) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.engine === null ? EXIT_PACE_UNKNOWN : EXIT_OK;
  }
  if (flags.namedRunner || flags.namedModel || flags.namedEndpoint) {
    const entries = mergePools(pools, roles);
    const namedRunner = flags.namedRunner && flags.namedRunner !== 'auto' ? flags.namedRunner : null;
    const runnerKeys = new Set();
    if (namedRunner) {
      const targetRunner = normRunner(namedRunner);
      for (const e of Object.values(entries)) {
        if (e && typeof e === 'object' && typeof e.key === 'string' && e.key && normRunner(e.runner) === targetRunner) {
          runnerKeys.add(e.key);
        }
      }
    }
    const singleKeyRunner = runnerKeys.size === 1;
    const clock = nowDate instanceof Date && !Number.isNaN(nowDate.getTime()) ? nowDate : new Date();
    const rows = (Array.isArray(pace?.rows) ? pace.rows : []).filter(row => {
      const entry = entries[row.pool];
      if (!entry || row.class === 'claude' || !isFreshRowForKey(row, entry.key, clock) || finiteNum(row.used_pct) === null) return false;
      if (namedRunner && normRunner(entry.runner) !== normRunner(namedRunner)) return false;
      if (flags.namedEndpoint && (entry.endpoint || '') !== flags.namedEndpoint) return false;
      if (flags.namedModel) {
        return sameEngine(entry.model, flags.namedModel)
          || sameEngine(roles.role_models?.[flags.role]?.[entry.key] || '', flags.namedModel)
          || singleKeyRunner;
      }
      return Boolean(flags.namedEndpoint) || singleKeyRunner;
    }).sort((a, b) => a.used_pct - b.used_pct);
    const row = rows[0];
    if (row && row.used_pct >= (roles.PACE_CEILING_PCT ?? 85)) {
      const key = entries[row.pool].key;
      const alternative = result.engine
        ? (result.basis === 'proxy_runs'
          ? `${result.engine} is behind daily run target (${result.runs_today}/${result.daily_target} runs today)`
          : (finiteNum(result.used_pct) !== null
            ? `${result.engine} has ${100 - result.used_pct}% left`
            : `${result.engine} is available`))
        : 'no eligible alternative has known quota left';
      process.stderr.write('pace: ' + key + ' is at ' + row.used_pct + '% of its 7-day window (resets ' + (row.reset_at ?? 'unknown') + '); named by caller, dispatching anyway — ' + alternative + '\n');
    }
    return EXIT_OK;
  }
  if (!result.engine) {
    process.stderr.write('pace: ' + result.reason + (result.reason === 'pace_unknown' ? '; using existing dispatch default' : '; no engine below ceiling') + '\n');
    return result.reason === 'pace_unknown' ? EXIT_OK : EXIT_PACE_UNKNOWN;
  }
  const choice = { engine: result.engine, used_pct: result.used_pct, reset_at: result.reset_at,
    runner_up: result.runner_up, reason: result.reason };
  const rejected = result.candidates.filter(c => c.reason === 'over_ceiling').map(c => c.engine + ': over_ceiling');
  const usageLabel = result.basis === 'proxy_runs'
    ? `${result.runs_today}/${result.daily_target} runs today, expected ${result.expected_runs}`
    : `${result.used_pct}% used, resets ${result.reset_at}`;
  process.stderr.write('pace: chose ' + result.engine + ' (' + usageLabel + ') over ' + (result.runner_up ?? 'none') + ' (' + [result.reason, ...rejected].join('; ') + ')\n');
  process.stdout.write([result.runner, result.model, result.endpoint || '', JSON.stringify(result), JSON.stringify(choice)].join('\n') + '\n');
  return EXIT_OK;
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
  const namedSeat = flags.dispatch && (flags.namedRunner || flags.namedModel || flags.namedEndpoint);

  let pools;
  let roles;
  try {
    pools = loadPools(env.AUTOPILOT_NONCQ_POOLS || POOLS_PATH);
    roles = loadRoles(env.AUTOPILOT_PACE_ROLES || ROLES_PATH);
    assertValidRole(roles, flags.role);
  } catch (err) {
    if (namedSeat) return EXIT_OK; // telemetry/config cannot veto an explicit seat
    process.stderr.write(`pace-select.js: ${err.message}\n`);
    return EXIT_USAGE;
  }

  if (flags.excludeModel) {
    for (const entry of Object.values(mergePools(pools, roles))) {
      if (sameEngine(entry.model, flags.excludeModel)
        || sameEngine(roles.role_models?.[flags.role]?.[entry.key] || '', flags.excludeModel)) flags.exclude.push(entry.key);
    }
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
      if (namedSeat) {
        qualified = { schema: QUALIFIED_SCHEMA, rows: [] }; // no qualified alternative can be claimed
      } else {
        process.stderr.write(`pace-select.js: cannot read qualified file (${qualifiedPath}): ${err.message}\n`);
        return EXIT_USAGE;
      }
    }
  }
  if (rawQualified !== null) {
    try {
      qualified = JSON.parse(rawQualified);
      validateQualified(qualified);
    } catch (err) {
      if (namedSeat) {
        qualified = { schema: QUALIFIED_SCHEMA, rows: [] };
      } else {
        process.stderr.write(`pace-select.js: invalid qualified file (${qualifiedPath}): ${err.message}\n`);
        return EXIT_USAGE;
      }
    }
    qualifiedSource = qualifiedPath;
  }

  let nowDate = null;
  if (flags.now !== null) {
    nowDate = new Date(flags.now);
    if (Number.isNaN(nowDate.getTime())) {
      process.stderr.write(`pace-select.js: --now is not an ISO time: ${flags.now}\n`);
      return EXIT_USAGE;
    }
  }
  const checkEndpoint = (ep, entry) => defaultCheckEndpoint(ep, env, entry);
  const dispatchCheap = Boolean(flags.dispatch && !flags.namedRunner && !flags.namedModel && !flags.namedEndpoint);
  const paceRead = readPaceFile(flags.pace, env);
  if (!paceRead.ok) {
    if (paceRead.status === 'missing') {
      if (!flags.dispatch) process.stderr.write(`pace-select.js: pace file not found: ${paceRead.path}\n`);
      const unknownResult = selectEngine({
        pace: { schema: PACE_SCHEMA, generated_at: null, rows: [] },
        pools,
        roles,
        role: flags.role,
        files: flags.files, excludeFamily: flags.excludeFamily,
        exclude: flags.exclude,
        checkEndpoint,
        qualified,
        qualifiedSource,
        scope: flags.scope,
        now: nowDate,
        env,
        dispatchCheap,
      });
      return emitSelection(unknownResult, flags, null, pools, roles, nowDate);
    }
    if (flags.dispatch) return emitSelection({ engine: null, reason: 'pace_unknown' }, flags, null, pools, roles, nowDate);
    if (paceRead.status === 'invalid_json') {
      process.stderr.write(`pace-select.js: pace file is not JSON (${paceRead.path}): ${paceRead.error}\n`);
      return EXIT_USAGE;
    }
    process.stderr.write(`pace-select.js: cannot read pace file (${paceRead.path}): ${paceRead.error}\n`);
    return EXIT_USAGE;
  }
  const pace = paceRead.pace;

  let result;
  try {
    result = selectEngine({
      pace,
      pools,
      roles,
      role: flags.role,
      files: flags.files, excludeFamily: flags.excludeFamily,
      exclude: flags.exclude,
      checkEndpoint,
      qualified,
      qualifiedSource,
      scope: flags.scope,
      now: nowDate,
      env,
      dispatchCheap,
    });
  } catch (err) {
    if (flags.dispatch) return emitSelection({ engine: null, reason: 'pace_unknown' }, flags, pace, pools, roles, nowDate);
    process.stderr.write(`pace-select.js: ${err.message}\n`);
    return err.exitCode || EXIT_USAGE;
  }

  return emitSelection(result, flags, pace, pools, roles, nowDate);
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
  inAvailableWindow,
  seamDayBlock,
  defaultPacePath,
  resolvePacePath,
  readPaceFile,
  isLowStatus,
  LOW_STATUS_RE,
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
