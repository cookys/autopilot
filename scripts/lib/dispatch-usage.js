'use strict';

// scripts/lib/dispatch-usage.js — the dispatch usage ledger writer (schema dispatch_usage/1).
//
// One row is appended per finished dispatch to <live_dir>/dispatch-usage-YYYYMM.jsonl (live_dir is
// resolveLiveDir(), the same base claude-account.js uses; YYYYMM is UTC, taken from ended_at). A run that
// writes a second row is read by the consumer as "last row wins". Fleet only reads this file.
//
//   node scripts/lib/dispatch-usage.js append --from-result <result.json|-> --role <role> [flags]
//
//   --run-id --parent-run-id --root-run-id --started-at <epoch> --ended-at <epoch> --wall-secs <n>
//   --provider-session-id <id>   (claude-family runners: the child Claude session id, NOT in the result JSON)
//   --endpoint <name>            (named endpoint the run was sent to)   --runner/--model override the result's
//   --served-runner --served-model --served-endpoint --fallbacks-json '[{runner,model,endpoint,reason}]'
//   --lane --upstream-task-id --upstream-message-id --requester-member   (env fallbacks: AUTOPILOT_DISPATCH_LANE,
//   AUTOPILOT_UPSTREAM_TASK_ID, AUTOPILOT_UPSTREAM_MESSAGE_ID, AUTOPILOT_REQUESTER_MEMBER)
//
// Rules: unknown is null, never 0; no token or credential value is ever copied (the row is built from a fixed
// field whitelist, error text and logs are not copied); usage is never estimated (usage_source says where it
// came from). Writing never throws and the CLI always exits 0: a failed write prints one "dispatch-usage: warn"
// line on stderr and the dispatch result is untouched. AUTOPILOT_DISPATCH_USAGE=off disables it.
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLiveDir } = require('./live-state-dir');

const SCHEMA = 'dispatch_usage/1';
const ROLES = ['reviewer', 'implementer', 'consult', 'exam', 'author', 'plan-review', 'other'];
const USAGE_SOURCES = ['provider_response', 'transcript', 'none'];
const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'reasoning_tokens'];
const USAGE_ALIASES = { cache_read_tokens: 'cache_read_input_tokens', cache_write_tokens: 'cache_creation_input_tokens' };
// Runners that run the claude CLI: their child session id is the dedupe key against the Claude transcript.
const CLAUDE_FAMILY = ['claude', 'claude-native', 'cc-shim', 'claude-code'];
const ACCOUNT_RE = /^[A-Za-z0-9_.-]+(:[A-Za-z0-9_.@-]+)?$/;

const isInt = (v) => Number.isInteger(v) && v >= 0;
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const intOrNull = (v) => (isInt(v) ? v : null);

// ---- account mapping -------------------------------------------------------------------------------------
// accountFor({runner, endpoint, endpointLocal, courier, claudeAlias, codexAlias}) -> alias string or null.
//   named endpoint on a private/loopback address  -> local:<courier name>   (courier "<ns>/<courier>"; unknown -> null)
//   named endpoint elsewhere (glm, minimax, ...)  -> <endpoint name>
//   claude family without an endpoint             -> claude:<alias>         (alias unknown -> null)
//   codex                                         -> codex:<alias>          (alias unknown -> null)
//   every other single-account runner             -> the runner name
// Never a credential: only names go in.
function accountFor(o) {
  const x = o || {};
  const runner = str(x.runner);
  const endpoint = str(x.endpoint);
  if (endpoint) {
    if (x.endpointLocal) {
      const courier = str(x.courier);
      const name = courier ? courier.split('/').pop() : null;
      return name ? `local:${name}` : null;
    }
    return endpoint;
  }
  if (!runner) return null;
  if (CLAUDE_FAMILY.includes(runner)) return str(x.claudeAlias) ? `claude:${x.claudeAlias}` : null;
  if (runner === 'codex') return str(x.codexAlias) ? `codex:${x.codexAlias}` : null;
  return runner;
}

// ---- row ---------------------------------------------------------------------------------------------------
function normalizeUsage(u) {
  const out = {};
  for (const k of USAGE_KEYS) out[k] = null;
  if (u && typeof u === 'object' && !Array.isArray(u)) {
    for (const k of Object.keys(u)) {
      const target = USAGE_KEYS.includes(k) ? k : USAGE_ALIASES[k];
      if (target && isInt(u[k])) out[target] = u[k];
    }
  }
  return out;
}

function normalizeRole(r) {
  return ROLES.includes(r) ? r : 'other';
}

function normalizeFallbacks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((f) => {
    const g = f && typeof f === 'object' ? f : {};
    return {
      runner: str(g.runner), model: str(g.model),
      account: str(g.account) || accountFor({ runner: g.runner, endpoint: g.endpoint, endpointLocal: g.endpointLocal, courier: g.courier }),
      reason: str(g.reason),
    };
  });
}

// input: flat object (see rowFromResult). Missing means null. Returns the row object (not yet validated).
function normalizeRow(i) {
  const x = i || {};
  const usage = normalizeUsage(x.usage);
  const anyUsage = USAGE_KEYS.some((k) => usage[k] !== null);
  let usageSource = USAGE_SOURCES.includes(x.usage_source) ? x.usage_source : (anyUsage ? 'provider_response' : 'none');
  if (!anyUsage) usageSource = 'none';
  const endedAt = intOrNull(x.ended_at);
  const wall = intOrNull(x.wall_secs);
  let startedAt = intOrNull(x.started_at);
  if (startedAt === null && endedAt !== null && wall !== null) startedAt = endedAt - wall;
  const runner = str(x.runner);
  const model = str(x.model);
  const account = str(x.account);
  const served = x.served_by && typeof x.served_by === 'object' ? x.served_by : {};
  return {
    schema: SCHEMA,
    run_id: str(x.run_id),
    parent_run_id: str(x.parent_run_id),
    root_run_id: str(x.root_run_id),
    started_at: startedAt,
    ended_at: endedAt,
    courier: str(x.courier),
    os_user: str(x.os_user),
    host: str(x.host),
    requester: {
      member: str(x.requester_member),
      session_id: str(x.requester_session_id),
      lane: str(x.lane),
    },
    upstream: { task_id: str(x.upstream_task_id), message_id: str(x.upstream_message_id) },
    role: normalizeRole(x.role),
    runner,
    model,
    account,
    served_by: {
      runner: str(served.runner) || runner,
      model: str(served.model) || model,
      account: str(served.account) || account,
    },
    fallbacks: normalizeFallbacks(x.fallbacks),
    usage,
    usage_source: usageSource,
    status: str(x.status),
    wall_secs: wall,
    timed_out: typeof x.timed_out === 'boolean' ? x.timed_out : null,
    error_category: str(x.error_category),
    provider_session_id: str(x.provider_session_id),
    branch: str(x.branch),
    base: str(x.base),
    commit: str(x.commit),
  };
}

// Returns null when the row is valid, else one reason string.
function validateRow(row) {
  if (!row || typeof row !== 'object') return 'row_not_object';
  if (row.schema !== SCHEMA) return 'bad_schema';
  if (!str(row.run_id)) return 'run_id_missing';
  if (!ROLES.includes(row.role)) return 'bad_role';
  if (!str(row.runner)) return 'runner_missing';
  if (!isInt(row.ended_at)) return 'ended_at_not_epoch_int';
  if (row.started_at !== null && !isInt(row.started_at)) return 'started_at_not_epoch_int';
  if (!USAGE_SOURCES.includes(row.usage_source)) return 'bad_usage_source';
  for (const k of USAGE_KEYS) {
    if (row.usage[k] !== null && !isInt(row.usage[k])) return `usage_${k}_not_int_or_null`;
  }
  const anyUsage = USAGE_KEYS.some((k) => row.usage[k] !== null);
  if (row.usage_source === 'none' && anyUsage) return 'usage_present_but_source_none';
  if (row.usage_source !== 'none' && !anyUsage) return 'usage_source_set_but_usage_empty';
  for (const a of [row.account, row.served_by && row.served_by.account]) {
    if (a !== null && !ACCOUNT_RE.test(a)) return 'bad_account';
  }
  if (!Array.isArray(row.fallbacks)) return 'fallbacks_not_array';
  // Dedupe key: a claude-family row that claims provider usage must name the child Claude session.
  if (CLAUDE_FAMILY.includes(row.runner) && row.usage_source !== 'none' && !row.provider_session_id) {
    return 'claude_family_missing_provider_session_id';
  }
  return null;
}

// result: the parsed dispatch result JSON. ctx: the flag values (see header). Returns the flat input of normalizeRow.
function rowFromResult(result, ctx) {
  const r = result && typeof result === 'object' ? result : {};
  const c = ctx || {};
  const runner = str(c.runner) || str(r.runner);
  const model = str(c.model) || str(r.model) || str(r.engine);
  const endpoint = str(c.endpoint);
  return {
    run_id: str(c.run_id) || str(r.run_id),
    parent_run_id: c.parent_run_id,
    root_run_id: c.root_run_id,
    started_at: c.started_at,
    ended_at: c.ended_at,
    courier: c.courier,
    os_user: c.os_user,
    host: c.host,
    requester_member: c.requester_member,
    requester_session_id: c.requester_session_id,
    lane: c.lane,
    upstream_task_id: c.upstream_task_id,
    upstream_message_id: c.upstream_message_id,
    role: c.role,
    runner,
    model,
    account: accountFor({ runner, endpoint, endpointLocal: c.endpointLocal, courier: c.courier, claudeAlias: c.claudeAlias, codexAlias: c.codexAlias }),
    served_by: {
      runner: str(c.served_runner),
      model: str(c.served_model),
      account: c.served_runner || c.served_endpoint
        ? accountFor({ runner: c.served_runner || runner, endpoint: c.served_endpoint, endpointLocal: c.servedEndpointLocal, courier: c.courier, claudeAlias: c.claudeAlias, codexAlias: c.codexAlias })
        : null,
    },
    fallbacks: c.fallbacks,
    usage: r.usage,
    usage_source: c.usage_source,
    status: str(r.status),
    wall_secs: c.wall_secs !== undefined && c.wall_secs !== null ? c.wall_secs : r.wall_secs,
    timed_out: r.timed_out,
    error_category: r.error_category,
    provider_session_id: str(c.provider_session_id) || str(r.provider_session_id),
    branch: r.branch,
    base: r.base,
    commit: r.commit,
  };
}

// ---- writing ---------------------------------------------------------------------------------------------
function ledgerFileName(endedAt) {
  const d = new Date(endedAt * 1000);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `dispatch-usage-${ym}.jsonl`;
}

// Append one validated row. Never throws; returns { ok: true, file } or { ok: false, error }.
function appendRow(row, opts) {
  try {
    const bad = validateRow(row);
    if (bad) return { ok: false, error: bad };
    const o = opts || {};
    const base = o.dir || resolveLiveDir({ env: o.env || process.env, warn: () => {} }).base;
    const file = path.join(base, ledgerFileName(row.ended_at));
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o600);
    try {
      const buf = Buffer.from(`${JSON.stringify(row)}\n`);
      // One write for the whole row: O_APPEND makes it atomic against a concurrent appender.
      const n = fs.writeSync(fd, buf, 0, buf.length);
      if (n !== buf.length) return { ok: false, error: 'short_write' };
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: `write_failed (${String(e && e.code || e && e.message).slice(0, 80)})` };
  }
}

// ---- process facts (cached: at most one `fleet whoami` per process) --------------------------------------
let courierCache;
function courierFromFleet(env) {
  if (courierCache !== undefined) return courierCache;
  courierCache = null;
  try {
    const r = spawnSync((env && env.FLEET_BIN) || 'fleet', ['whoami'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], env });
    if (r.status === 0) {
      const ns = /^namespace:\s*(\S+)/m.exec(r.stdout || '');
      const cr = /^courier:\s*(\S+)/m.exec(r.stdout || '');
      if (ns && cr) courierCache = `${ns[1]}/${cr[1]}`;
    }
  } catch (_) { /* null */ }
  return courierCache;
}

function endpointIsLocal(name, env) {
  try {
    const script = path.join(__dirname, '..', 'resolve-endpoint.sh');
    const r = spawnSync('bash', [script, name], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], env });
    const m = /"transport_security":"([^"]*)"/.exec(r.stdout || '');
    return !!m && m[1] === 'plaintext_private';
  } catch (_) { return false; }
}

// ---- CLI ---------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-/g, '_');
    out[key] = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : '';
  }
  return out;
}

function epochOrNull(v) {
  return v !== undefined && /^[0-9]+$/.test(String(v)) ? Number(v) : null;
}

function warn(msg) {
  try { fs.writeSync(2, `dispatch-usage: warn: ${msg}\n`); } catch (_) { /* nothing left to do */ }
}

function runAppend(args, env, nowSecs) {
  if (env.AUTOPILOT_DISPATCH_USAGE === 'off') return { ok: true, skipped: true };
  let result = null;
  if (args.from_result) {
    const raw = args.from_result === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.from_result, 'utf8');
    try { result = JSON.parse(raw); } catch (_) { return { ok: false, error: 'result_not_json' }; }
  }
  const endpoint = str(args.endpoint);
  const servedEndpoint = str(args.served_endpoint);
  let fallbacks = null;
  if (args.fallbacks_json) { try { fallbacks = JSON.parse(args.fallbacks_json); } catch (_) { return { ok: false, error: 'fallbacks_not_json' }; } }
  const courier = courierFromFleet(env);
  const ctx = {
    role: args.role, run_id: str(args.run_id), parent_run_id: str(args.parent_run_id), root_run_id: str(args.root_run_id),
    started_at: epochOrNull(args.started_at), ended_at: epochOrNull(args.ended_at) !== null ? epochOrNull(args.ended_at) : nowSecs,
    wall_secs: epochOrNull(args.wall_secs),
    runner: str(args.runner), model: str(args.model), endpoint,
    endpointLocal: endpoint ? endpointIsLocal(endpoint, env) : false,
    served_runner: str(args.served_runner), served_model: str(args.served_model), served_endpoint: servedEndpoint,
    servedEndpointLocal: servedEndpoint ? endpointIsLocal(servedEndpoint, env) : false,
    fallbacks: fallbacks === null ? null : fallbacks.map((f) => ({ ...f, endpointLocal: f && f.endpoint ? endpointIsLocal(f.endpoint, env) : false, courier })),
    provider_session_id: str(args.provider_session_id),
    usage_source: str(args.usage_source),
    courier, os_user: os.userInfo().username, host: os.hostname(),
    requester_member: str(args.requester_member) || str(env.AUTOPILOT_REQUESTER_MEMBER),
    requester_session_id: str(env.CLAUDE_CODE_SESSION_ID),
    lane: str(args.lane) || str(env.AUTOPILOT_DISPATCH_LANE),
    upstream_task_id: str(args.upstream_task_id) || str(env.AUTOPILOT_UPSTREAM_TASK_ID),
    upstream_message_id: str(args.upstream_message_id) || str(env.AUTOPILOT_UPSTREAM_MESSAGE_ID),
    claudeAlias: str(env.AUTOPILOT_ACCOUNT),
  };
  return appendRow(normalizeRow(rowFromResult(result, ctx)), { env });
}

function main(argv, env) {
  try {
    const cmd = argv[0];
    if (cmd !== 'append') { warn('usage: dispatch-usage.js append --from-result <file|-> --role <role> [flags]'); return 0; }
    const r = runAppend(parseArgs(argv.slice(1)), env || process.env, Math.floor(Date.now() / 1000));
    if (!r.ok) warn(r.error);
  } catch (e) {
    warn(String(e && e.message || e).slice(0, 120));
  }
  return 0;
}

module.exports = {
  SCHEMA, ROLES, USAGE_KEYS, CLAUDE_FAMILY,
  accountFor, normalizeUsage, normalizeRow, validateRow, rowFromResult, ledgerFileName, appendRow, courierFromFleet, main,
};

if (require.main === module) {
  // Exit via the exit code only after stderr is flushed: warn() uses writeSync, so nothing is left in a pipe.
  process.exitCode = main(process.argv.slice(2), process.env);
}
