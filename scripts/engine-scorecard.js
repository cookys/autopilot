#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');

const VALID_ROLES = new Set(['reviewer', 'implementer', 'planner', 'verifier', 'orchestrator']);
const LADDER_ROLES = new Set(['reviewer', 'implementer', 'planner']);
const VALID_VERSION_SOURCES = new Set(['runtime', 'manual']);
const VALID_STATUSES = new Set(['qualified', 'failed', 'expired']);
const VALID_COST_SOURCES = new Set(['measured', 'manual', 'unknown']);

const REQUIRED_FIELDS = [
  'engine',
  'runner',
  'family',
  'role',
  'model_version',
  'version_source',
  'corpus_version',
  'harness_version',
  'runner_version',
  'prompt_config_hash',
  'date',
  'quality',
  'capability_score',
  'cost',
  'latency',
  'status',
  'qualified_at',
  'expires',
];

const CONFIGURED_IDENTITY_FIELDS = [
  'engine',
  'runner',
  'role',
  'corpus_version',
  'harness_version',
  'runner_version',
  'prompt_config_hash',
];

const HELP_TEXT = `Usage:\n\
  node scripts/engine-scorecard.js record [--file <path>]\n\
  node scripts/engine-scorecard.js current --role <reviewer|implementer|planner|verifier|orchestrator> [--now <ISO-date>]\n\
  node scripts/engine-scorecard.js report --role <reviewer|implementer|planner|verifier|orchestrator> [--key capability|cost]\n\
  node scripts/engine-scorecard.js ladder --role <reviewer|implementer|planner> [--implementer-family <family>]\n\
\n  --file <path>  Read one JSON row from this file.\n\
  --role is required for current/report/ladder.\n\
  --key accepts capability (default) or cost.\n\
  --now accepts ISO date; used by current for deterministic TTL checks.\n\
  --implementer-family is optional; if provided, ladder demotes matching family entries.\n\
  verifier/orchestrator rows are evidence-only in v1; use current/report, not ladder.\n\
\nExit codes:\n\
  0 = success\n\
  1 = validation error\n\
  2 = usage error / unknown command\n`;

function usage(code) {
  console.log(HELP_TEXT);
  process.exit(code);
}

function failValidation(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function failUsage(message = null) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  usage(2);
}

function isHelpToken(token) {
  return token === '-h' || token === '--help' || token === 'help';
}

function expandTilde(raw) {
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith(`~${path.sep}`)) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

const SCORECARD_DIR = path.resolve(
  expandTilde(process.env.ENGINE_SCORECARD_DIR || path.join('~', '.autopilot', 'engine-scorecard')),
);
const SCORECARD_FILE = path.join(SCORECARD_DIR, 'scorecard.jsonl');
const LOCK_FILE = path.join(SCORECARD_DIR, '.lock');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function readTextLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function warnMalformedLine(lineNo, message) {
  process.stderr.write(`WARN: malformed scorecard line ${lineNo}: ${message}\n`);
}

function parseJsonObject(raw, context) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    failValidation(`${context}: invalid JSON (${err.message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failValidation(`${context}: expected a JSON object`);
  }
  return parsed;
}

function readStoreRows(silentWarn = false) {
  const lines = readTextLines(SCORECARD_FILE);
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        if (!silentWarn) warnMalformedLine(i + 1, 'not an object');
        continue;
      }
      rows.push(row);
    } catch (err) {
      if (!silentWarn) warnMalformedLine(i + 1, err.message);
    }
  }

  return rows;
}

function toEventId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function maxEventId(rows) {
  let max = 0;
  for (const row of rows) {
    const id = toEventId(row.event_id);
    if (id !== null && id > max) max = id;
  }
  return max;
}

function toDateMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' && !value.includes('T')
    ? `${value}T00:00:00Z`
    : String(value);
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function todayMsUtc() {
  return toDateMs(new Date().toISOString().slice(0, 10)) || Date.now();
}

function nowArgToMs(value, required = false) {
  const ms = toDateMs(value);
  if (value === undefined || value === null || value === '') {
    return required ? failValidation('missing --now value') : todayMsUtc();
  }
  if (ms === null) failUsage(`invalid --now date: ${value}`);
  return ms;
}

function identityKey(row) {
  // Invocation-tuple extension (v2.32.25 R1): effort/model are OPTIONAL row fields
  // but distinct values are distinct qualifications (gpt-X@high and gpt-X@xhigh
  // must not collapse to the latest event). They join the KEY (undefined → '')
  // without joining the required-field check — most rows legitimately omit them.
  const tupleExt = ['effort', 'model']
    .map((name) => (row && row[name] !== undefined ? String(row[name]) : ''));
  return CONFIGURED_IDENTITY_FIELDS
    .map((name) => (row && row[name] !== undefined ? String(row[name]) : ''))
    .concat(tupleExt)
    .join('\u0000');
}

function identityFieldMissing(row) {
  for (const field of CONFIGURED_IDENTITY_FIELDS) {
    if (row[field] === undefined) return field;
  }
  return null;
}

function validateRecordRow(row) {
  const missing = REQUIRED_FIELDS.filter((field) => row[field] === undefined);
  if (missing.length > 0) {
    failValidation(`missing required field(s): ${missing.join(', ')}`);
  }

  if (typeof row.engine !== 'string' || row.engine.trim().length === 0) {
    failValidation('engine must be a non-empty string');
  }

  if (!VALID_ROLES.has(row.role)) {
    failValidation(`invalid role '${row.role}'`);
  }

  if (!VALID_VERSION_SOURCES.has(row.version_source)) {
    failValidation(`invalid version_source '${row.version_source}'`);
  }

  // OPTIONAL effort (v2.32.25, family-conflict fallback): when present it names the
  // calibrated reasoning effort of this row's invocation tuple. Only codex-runner
  // consumers require it; absent = "not effort-calibrated" (ladder projects null).
  if (row.effort !== undefined
      && !['low', 'medium', 'high', 'xhigh', 'max'].includes(row.effort)) {
    failValidation(`invalid effort '${row.effort}' (low|medium|high|xhigh|max or omit)`);
  }

  // OPTIONAL model (v2.32.25): the exact --model string for this row's runner when
  // the engine id is a display id rather than a dispatchable model (e.g. engine
  // "claude-haiku" dispatches as claude-native --model "haiku"). Absent = engine id
  // IS the dispatch string.
  if (row.model !== undefined
      && (typeof row.model !== 'string' || row.model.trim().length === 0)) {
    failValidation('model must be a non-empty string when present');
  }

  if (!VALID_STATUSES.has(row.status)) {
    failValidation(`invalid status '${row.status}'`);
  }

  if (!row.cost || typeof row.cost !== 'object' || Array.isArray(row.cost)) {
    failValidation('cost must be an object');
  }

  if (!VALID_COST_SOURCES.has(row.cost.source)) {
    failValidation(`invalid cost.source '${row.cost.source}'`);
  }
}

// Pure-Node synchronous sleep (no child process — keeps the dependency-minimal premise).
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

// Liveness probe for the current lock holder. The lock file stores the holder's PID;
// an EMPTY / non-numeric / unreadable lock (a writer that crashed before/after writing,
// or a leftover) is treated as STALE so it can be stolen rather than wedging writes.
function lockHolderAlive() {
  let content;
  try {
    content = fs.readFileSync(LOCK_FILE, 'utf8').trim();
  } catch {
    return false; // vanished/unreadable → not a live holder
  }
  const pid = Number(content);
  if (!Number.isInteger(pid) || pid <= 0) return false; // empty/garbage → stale
  try {
    process.kill(pid, 0); // signal 0 = existence probe, sends nothing
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true; // exists but owned by another user → assume live
    return false; // ESRCH (no such process) etc → dead → stale
  }
}

// Lock strategy: exclusive O_CREAT|O_EXCL lock file holding the writer's PID, with a
// PID-liveness STALE-LOCK BREAKER so a crashed writer cannot permanently wedge appends.
function acquireLock() {
  ensureDir(SCORECARD_DIR);
  const deadline = Date.now() + 8000;
  let delayMs = 5;

  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Stale-lock breaker: a dead/empty holder is stolen immediately (no wait).
      if (!lockHolderAlive()) {
        try { fs.unlinkSync(LOCK_FILE); } catch { /* another process won the steal; just retry */ }
        continue;
      }
      // A genuinely live holder: back off, bounded by the deadline.
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for scorecard lock (held by a live process)');
      }
      sleepMs(delayMs);
      delayMs = Math.min(delayMs * 2, 50);
    }
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Ignore stale lock cleanup failures.
  }
}

function withWriteLock(callback) {
  acquireLock();
  try {
    return callback();
  } finally {
    releaseLock();
  }
}

function appendRow(row) {
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(SCORECARD_FILE, line, { mode: 0o600 });
}

function parseCurrentArgs(args) {
  let role = null;
  let now;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--now') {
      if (i + 1 >= args.length) failUsage('--now requires a value');
      now = args[++i];
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  if (!VALID_ROLES.has(role)) failUsage(`invalid role '${role}'`);

  const nowMs = nowArgToMs(now, false);

  return { role, nowMs };
}

function parseReportArgs(args) {
  let role = null;
  let key = 'capability';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--key') {
      if (i + 1 >= args.length) failUsage('--key requires a value');
      key = args[++i];
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  if (!VALID_ROLES.has(role)) failUsage(`invalid role '${role}'`);
  if (key !== 'capability' && key !== 'cost') failUsage(`invalid --key '${key}'`);

  return { role, key };
}

function parseLadderArgs(args) {
  let role = null;
  let implementerFamily = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--implementer-family') {
      if (i + 1 >= args.length) failUsage('--implementer-family requires a value');
      implementerFamily = args[++i];
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  if (!VALID_ROLES.has(role)) failUsage(`invalid role '${role}'`);
  if (!LADDER_ROLES.has(role)) {
    failUsage(`ladder is not enabled for evidence-only role '${role}'; use report`);
  }

  return { role, implementerFamily };
}

function parseRecordArgs(args) {
  let file = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--file') {
      if (i + 1 >= args.length) failUsage('--file requires a path');
      file = args[++i];
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  return { file };
}

function currentRowsForRole(role, nowMs) {
  const rows = readStoreRows();
  const latest = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.role !== role) continue;

    const missing = identityFieldMissing(row);
    if (missing) {
      warnMalformedLine(0, `configured-identity field missing (${missing})`);
      continue;
    }

    const currentId = toEventId(row.event_id);
    if (currentId === null) {
      warnMalformedLine(0, 'invalid event_id for current view');
      continue;
    }

    const key = identityKey(row);
    const existing = latest.get(key);
    const existingId = existing ? toEventId(existing.event_id) : null;

    if (!existing || existingId === null || currentId > existingId) {
      latest.set(key, row);
    }
  }

  // Invocation-tuple supersede (v2.32.25 R6, shared by current AND ladder):
  // `model` is an alias refinement of the same qualification — the newest event
  // per engine+runner+effort wins regardless of whether it carries `model`, so
  // a stale model-less row can neither stay selectable in the ladder nor feed
  // `reviewer_qualified` in resolve-review-loop --check-scorecard. Distinct
  // efforts remain distinct rungs (R1).
  const byInvocation = new Map();
  for (const row of latest.values()) {
    const key = `${row.engine}\u0000${row.runner}\u0000${row.effort === undefined ? '' : row.effort}`;
    const existing = byInvocation.get(key);
    if (!existing || (toEventId(row.event_id) || 0) > (toEventId(existing.event_id) || 0)) {
      byInvocation.set(key, row);
    }
  }

  const output = [];

  for (const row of byInvocation.values()) {
    const effectiveStatus = deriveStatus(row, nowMs);
    const rowStatus = typeof effectiveStatus === 'string' ? effectiveStatus : row.status;

    output.push({
      engine: row.engine,
      runner: row.runner,
      role: row.role,
      corpus_version: row.corpus_version,
      harness_version: row.harness_version,
      runner_version: row.runner_version,
      prompt_config_hash: row.prompt_config_hash,
      status: rowStatus,
      capability_score: row.capability_score,
      family: row.family,
      cost: row.cost,
      model_version: row.model_version,
      // optional invocation-tuple fields (v2.32.25) — carried so ladder can project them
      ...(row.effort !== undefined ? { effort: row.effort } : {}),
      ...(row.model !== undefined ? { model: row.model } : {}),
      event_id: toEventId(row.event_id) || 0,
    });
  }

  return output.sort((a, b) => {
    if (a.engine !== b.engine) return a.engine < b.engine ? -1 : 1;
    if (a.runner !== b.runner) return a.runner < b.runner ? -1 : 1;
    return 0;
  });
}

function deriveStatus(row, nowMs) {
  if (row.status !== 'qualified') return row.status;
  const expiresMs = toDateMs(row.expires);
  if (expiresMs === null) return row.status;
  return expiresMs < nowMs ? 'expired' : row.status;
}

function sortByCapability(a, b) {
  const ac = Number(a.capability_score);
  const bc = Number(b.capability_score);
  if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) {
    return bc - ac;
  }
  if (Number.isFinite(ac) && !Number.isFinite(bc)) return -1;
  if (!Number.isFinite(ac) && Number.isFinite(bc)) return 1;
  return 0;
}

// Cost sort value: a row is worst-cost (Infinity, never "free") if its source is
// `unknown` OR either unit price is missing/non-numeric — an unpriced `manual`/`measured`
// row is still unmeasured and must NOT rank as the cheapest (plan: "never rank an
// unmeasured engine as free").
function costSortValue(row) {
  const src = row.cost && row.cost.source;
  const inp = Number(row.cost ? row.cost.usd_per_mtok_input : NaN);
  const out = Number(row.cost ? row.cost.usd_per_mtok_output : NaN);
  if (src === 'unknown' || !Number.isFinite(inp) || !Number.isFinite(out)) return Infinity;
  return inp + out;
}

function rankCost(a, b) {
  const av = costSortValue(a);
  const bv = costSortValue(b);
  if (av !== bv) return av - bv; // Infinity (unmeasured) always sorts last
  return sortByCapability(a, b); // tie (incl. both unmeasured) → capability desc
}

function cmdRecord(args) {
  const { file } = parseRecordArgs(args);
  const raw = file
    ? fs.readFileSync(file, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const parsed = parseJsonObject(raw, 'record input');

  validateRecordRow(parsed);

  const stored = { ...parsed };
  delete stored.event_id;

  const writtenRow = withWriteLock(() => {
    const rows = readStoreRows(true);
    const assigned = maxEventId(rows) + 1;
    const row = { ...stored, event_id: assigned };
    appendRow(row);
    return row;
  });

  process.stdout.write(`${JSON.stringify(writtenRow)}\n`);
}

function cmdCurrent(args) {
  const { role, nowMs } = parseCurrentArgs(args);
  const rows = currentRowsForRole(role, nowMs);
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}

function cmdReport(args) {
  const { role, key } = parseReportArgs(args);
  const rows = currentRowsForRole(role, todayMsUtc()).filter((row) => row.status === 'qualified');
  const ranked = rows.slice();

  if (key === 'cost') {
    ranked.sort(rankCost);
  } else {
    ranked.sort(sortByCapability);
  }

  process.stdout.write(`${JSON.stringify(ranked)}\n`);
}

function cmdLadder(args) {
  const { role, implementerFamily } = parseLadderArgs(args);
  // currentRowsForRole already applies the invocation-tuple supersede (R6) —
  // a later failed/expired re-qualification retires the rung before this
  // qualified filter runs (R5 semantics preserved).
  const deduped = currentRowsForRole(role, todayMsUtc())
    .filter((row) => row.status === 'qualified')
    .sort(sortByCapability);

  const ladder = deduped.map((row) => ({
    engine: row.engine,
    runner: row.runner,
    family: row.family,
    capability_score: row.capability_score,
    effort: row.effort === undefined ? null : row.effort,
    model: row.model === undefined ? null : row.model,
    same_family: Boolean(implementerFamily && row.family === implementerFamily),
  }));

  if (implementerFamily) {
    ladder.sort((a, b) => {
      if (a.same_family !== b.same_family) {
        return a.same_family ? 1 : -1;
      }
      return sortByCapability(a, b);
    });
  }

  process.stdout.write(`${JSON.stringify(ladder)}\n`);
}

(function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) usage(2);
  if (isHelpToken(argv[0])) usage(0);

  const command = argv[0];
  const commandArgs = argv.slice(1);

  if (command === 'record') cmdRecord(commandArgs);
  else if (command === 'current') cmdCurrent(commandArgs);
  else if (command === 'report') cmdReport(commandArgs);
  else if (command === 'ladder') cmdLadder(commandArgs);
  else failUsage(`unknown subcommand '${command}'`);
})();
