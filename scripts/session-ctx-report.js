#!/usr/bin/env node
'use strict';

/**
 * session-ctx-report.js — measure idle Claude Code sessions whose live context is too large
 * (ctx-reset W1). A host-side sweep asks matching sessions to write a HANDOFF and restarts them
 * fresh; this script only measures and decides. It never restarts anything.
 *
 * Data source (the ONLY one): `<liveBase>/context/<session-id>.json` written by
 * hooks/context-budget.js / statusline-live-tee.js. Resolve `<liveBase>` with
 * scripts/lib/live-state-dir.js `resolveLiveDir()` (honours AUTOPILOT_LIVE_DIR). Files are read
 * directly — NOT via `readLive`'s 120 s freshness check (an idle session's file is old by design).
 * Fields used: schema_version (must be 1), session_id, written_at, context_window.total_input_tokens,
 * context_window.context_window_size, model.id (may be absent). Never reads ~/.claude.
 *
 * USAGE:
 *   scripts/session-ctx-report.js list [--json]
 *   scripts/session-ctx-report.js candidates --input <file.json> [--json]
 *     [--soft N] [--hard N] [--soft-idle-min N] [--hard-idle-min N] [--cooldown-min N]
 *
 *   list (default): one row per live file with schema 1. Plain table uses Traditional Chinese
 *   headers. JSON: { sessions, skipped, generated_at }. Malformed / non-schema-1 files are
 *   skipped silently and counted in `skipped`.
 *
 *   candidates: pure decision over a sweep-merged input JSON
 *     { now: ISO, sessions: [{ session_id, ctx_tokens, last_active, last_sent?, holds_claim,
 *       open_tasks, running_go, excluded?, last_reset?, skip_until? }] }
 *   Output per session: { session_id, decision: 'reset'|'keep', reason }. First match wins —
 *   see references/session-reset.md. Export `decide(input, opts)` for tests.
 *
 * Thresholds (flags > env > defaults):
 *   AUTOPILOT_CTX_RESET_SOFT (150000) · AUTOPILOT_CTX_RESET_HARD (250000)
 *   AUTOPILOT_CTX_RESET_SOFT_IDLE_MIN (15) · AUTOPILOT_CTX_RESET_HARD_IDLE_MIN (5)
 *   AUTOPILOT_CTX_RESET_COOLDOWN_MIN (120)
 * Non-positive or non-numeric values → exit 2 with a message.
 *
 * EXIT: 0 success · 2 usage / bad threshold / bad input.
 *
 * Node >= 20.10, built-ins only. Contract: references/session-reset.md.
 */

const fs = require('fs');
const path = require('path');
const { resolveLiveDir } = require('./lib/live-state-dir.js');

const DEFAULTS = Object.freeze({
  soft: 150000,
  hard: 250000,
  softIdleMin: 15,
  hardIdleMin: 5,
  cooldownMin: 120,
});

const ENV_KEYS = Object.freeze({
  soft: 'AUTOPILOT_CTX_RESET_SOFT',
  hard: 'AUTOPILOT_CTX_RESET_HARD',
  softIdleMin: 'AUTOPILOT_CTX_RESET_SOFT_IDLE_MIN',
  hardIdleMin: 'AUTOPILOT_CTX_RESET_HARD_IDLE_MIN',
  cooldownMin: 'AUTOPILOT_CTX_RESET_COOLDOWN_MIN',
});

const LIST_HEADERS = Object.freeze([
  ['工作階段', (r) => r.session_id],
  ['上下文tokens', (r) => String(r.ctx_tokens)],
  ['視窗', (r) => (r.window == null ? '-' : String(r.window))],
  ['模型', (r) => (r.model == null || r.model === '' ? '-' : r.model)],
  ['最後活動', (r) => r.last_active],
  ['閒置(分)', (r) => String(r.idle_min)],
]);

function usage(msg) {
  if (msg) process.stderr.write(`session-ctx-report.js: ${msg}\n`);
  process.stderr.write(
    'usage: session-ctx-report.js list [--json]\n'
    + '       session-ctx-report.js candidates --input <file.json> [--json]\n'
    + '         [--soft N] [--hard N] [--soft-idle-min N] [--hard-idle-min N] [--cooldown-min N]\n',
  );
  process.exit(2);
}

function parsePositiveNumber(raw, label) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false, message: `${label} requires a positive number` };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: `${label} must be a positive number (got ${JSON.stringify(raw)})` };
  }
  return { ok: true, value: n };
}

function resolveThresholds(flagOpts, env) {
  const out = { ...DEFAULTS };
  const sources = [
    { soft: env[ENV_KEYS.soft], hard: env[ENV_KEYS.hard], softIdleMin: env[ENV_KEYS.softIdleMin],
      hardIdleMin: env[ENV_KEYS.hardIdleMin], cooldownMin: env[ENV_KEYS.cooldownMin] },
    flagOpts || {},
  ];
  const labels = {
    soft: '--soft / AUTOPILOT_CTX_RESET_SOFT',
    hard: '--hard / AUTOPILOT_CTX_RESET_HARD',
    softIdleMin: '--soft-idle-min / AUTOPILOT_CTX_RESET_SOFT_IDLE_MIN',
    hardIdleMin: '--hard-idle-min / AUTOPILOT_CTX_RESET_HARD_IDLE_MIN',
    cooldownMin: '--cooldown-min / AUTOPILOT_CTX_RESET_COOLDOWN_MIN',
  };
  for (const src of sources) {
    for (const key of Object.keys(DEFAULTS)) {
      // Explicit empty string is a bad value (non-numeric); only skip when the key was omitted.
      if (src[key] === undefined || src[key] === null) continue;
      const parsed = parsePositiveNumber(src[key], labels[key]);
      if (!parsed.ok) return parsed;
      out[key] = parsed.value;
    }
  }
  return { ok: true, value: out };
}

function parseArgs(argv) {
  const args = {
    mode: 'list',
    json: false,
    input: null,
    soft: undefined,
    hard: undefined,
    softIdleMin: undefined,
    hardIdleMin: undefined,
    cooldownMin: undefined,
  };
  let i = 0;
  if (argv.length === 0 || argv[0] === 'list') {
    if (argv[0] === 'list') i = 1;
    args.mode = 'list';
  } else if (argv[0] === 'candidates') {
    args.mode = 'candidates';
    i = 1;
  } else if (argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  } else if (argv[0].startsWith('-')) {
    // bare flags with implicit list
    args.mode = 'list';
  } else {
    return { error: `unknown mode: ${argv[0]}` };
  }

  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') { args.json = true; continue; }
    if (a === '--help' || a === '-h') return { help: true };
    const take = (key) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} requires a value` };
      i += 1;
      args[key] = v;
      return null;
    };
    if (a === '--input') { const e = take('input'); if (e) return e; continue; }
    if (a === '--soft') { const e = take('soft'); if (e) return e; continue; }
    if (a === '--hard') { const e = take('hard'); if (e) return e; continue; }
    if (a === '--soft-idle-min') { const e = take('softIdleMin'); if (e) return e; continue; }
    if (a === '--hard-idle-min') { const e = take('hardIdleMin'); if (e) return e; continue; }
    if (a === '--cooldown-min') { const e = take('cooldownMin'); if (e) return e; continue; }
    return { error: `unknown argument: ${a}` };
  }
  if (args.mode === 'candidates' && !args.input) {
    return { error: 'candidates requires --input <file.json>' };
  }
  return args;
}

/** Parse one live context file. Returns a row or null when malformed / wrong schema. */
function parseLiveFile(raw, nowMs) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!Number.isInteger(obj.schema_version) || obj.schema_version !== 1) return null;
  if (typeof obj.session_id !== 'string' || !obj.session_id) return null;
  if (typeof obj.written_at !== 'string') return null;
  const writtenMs = Date.parse(obj.written_at);
  if (!Number.isFinite(writtenMs)) return null;
  const cw = obj.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const tokens = cw.total_input_tokens;
  if (!Number.isFinite(tokens)) return null;
  const window = cw.context_window_size;
  const windowVal = Number.isFinite(window) ? window : null;
  const modelId = obj.model && typeof obj.model === 'object' && typeof obj.model.id === 'string'
    ? obj.model.id
    : null;
  const idleMin = Math.max(0, Math.floor((nowMs - writtenMs) / 60000));
  return {
    session_id: obj.session_id,
    ctx_tokens: tokens,
    window: windowVal,
    model: modelId,
    last_active: obj.written_at,
    idle_min: idleMin,
  };
}

function listSessions(liveBase, nowMs) {
  const dir = path.join(liveBase, 'context');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { sessions: [], skipped: 0, generated_at: new Date(nowMs).toISOString() };
    }
    throw err;
  }
  const sessions = [];
  let skipped = 0;
  for (const name of names) {
    // Main live files only — never *.tasks.json or other sidecars.
    if (!name.endsWith('.json') || name.endsWith('.tasks.json')) continue;
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    const row = parseLiveFile(raw, nowMs);
    if (!row) { skipped += 1; continue; }
    sessions.push(row);
  }
  sessions.sort((a, b) => a.session_id.localeCompare(b.session_id));
  return { sessions, skipped, generated_at: new Date(nowMs).toISOString() };
}

function formatListTable(report) {
  const rows = report.sessions;
  const widths = LIST_HEADERS.map(([title, pick]) => {
    let w = title.length;
    for (const row of rows) w = Math.max(w, pick(row).length);
    return w;
  });
  const lineOf = (row) => LIST_HEADERS.map(([, pick], i) => pick(row).padEnd(widths[i])).join('  ');
  const header = LIST_HEADERS.map(([title], i) => title.padEnd(widths[i])).join('  ');
  const lines = [header, ...rows.map(lineOf)];
  if (report.skipped > 0) lines.push(`skipped: ${report.skipped}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Pure decision. opts: { soft, hard, softIdleMin, hardIdleMin, cooldownMin }.
 * Returns [{ session_id, decision, reason }, ...].
 */
function decide(input, opts) {
  if (!input || typeof input !== 'object' || typeof input.now !== 'string') {
    throw Object.assign(new Error('input.now (ISO) is required'), { code: 'USAGE' });
  }
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    throw Object.assign(new Error(`input.now is not a valid ISO time: ${input.now}`), { code: 'USAGE' });
  }
  const thr = { ...DEFAULTS, ...(opts || {}) };
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  return sessions.map((s) => decideOne(s, nowMs, thr));
}

function decideOne(s, nowMs, thr) {
  const sid = s && typeof s.session_id === 'string' ? s.session_id : '';
  const keep = (reason) => ({ session_id: sid, decision: 'keep', reason });
  const reset = (reason) => ({ session_id: sid, decision: 'reset', reason });

  if (s && s.excluded) return keep('excluded');
  if (s && s.holds_claim) return keep('claim');
  if (s && s.running_go) return keep('running_go');
  const openTasks = s && Number(s.open_tasks);
  if (Number.isFinite(openTasks) && openTasks > 0) return keep('open_task');

  if (s && typeof s.skip_until === 'string') {
    const skipMs = Date.parse(s.skip_until);
    if (Number.isFinite(skipMs) && skipMs > nowMs) return keep('skipped_by_session');
  }

  if (s && typeof s.last_reset === 'string') {
    const resetMs = Date.parse(s.last_reset);
    if (Number.isFinite(resetMs)) {
      const ageMin = (nowMs - resetMs) / 60000;
      if (ageMin < thr.cooldownMin) return keep('cooldown');
    }
  }

  const lastActiveMs = s && typeof s.last_active === 'string' ? Date.parse(s.last_active) : NaN;
  const lastSentMs = s && typeof s.last_sent === 'string' ? Date.parse(s.last_sent) : NaN;
  const activityMs = Math.max(
    Number.isFinite(lastActiveMs) ? lastActiveMs : 0,
    Number.isFinite(lastSentMs) ? lastSentMs : 0,
  );
  const idleMin = Number.isFinite(activityMs) && activityMs > 0
    ? (nowMs - activityMs) / 60000
    : Infinity;
  const ctx = s && Number.isFinite(Number(s.ctx_tokens)) ? Number(s.ctx_tokens) : 0;

  if (ctx >= thr.hard && idleMin >= thr.hardIdleMin) return reset('hard');
  if (ctx >= thr.soft && idleMin >= thr.softIdleMin) return reset('soft');
  if (ctx < thr.soft) return keep('below_threshold');
  return keep('not_idle');
}

function formatCandidatesPlain(rows) {
  const widths = [
    Math.max('session_id'.length, ...rows.map((r) => r.session_id.length)),
    Math.max('decision'.length, ...rows.map((r) => r.decision.length)),
    Math.max('reason'.length, ...rows.map((r) => r.reason.length)),
  ];
  const line = (r) => [
    r.session_id.padEnd(widths[0]),
    r.decision.padEnd(widths[1]),
    r.reason.padEnd(widths[2]),
  ].join('  ');
  const header = [
    'session_id'.padEnd(widths[0]),
    'decision'.padEnd(widths[1]),
    'reason'.padEnd(widths[2]),
  ].join('  ');
  return `${[header, ...rows.map(line)].join('\n')}\n`;
}

function main(argv, env) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(
      'session-ctx-report.js — list idle-session context sizes; decide reset candidates\n'
      + 'See references/session-reset.md\n'
      + 'usage: session-ctx-report.js list [--json]\n'
      + '       session-ctx-report.js candidates --input <file.json> [--json]\n'
      + '         [--soft N] [--hard N] [--soft-idle-min N] [--hard-idle-min N] [--cooldown-min N]\n',
    );
    return 0;
  }
  if (parsed.error) usage(parsed.error);

  const thr = resolveThresholds({
    soft: parsed.soft,
    hard: parsed.hard,
    softIdleMin: parsed.softIdleMin,
    hardIdleMin: parsed.hardIdleMin,
    cooldownMin: parsed.cooldownMin,
  }, env || process.env);
  if (!thr.ok) usage(thr.message);

  if (parsed.mode === 'list') {
    let base;
    try {
      base = resolveLiveDir({ env: env || process.env, warn: () => {} }).base;
    } catch (err) {
      usage(err && err.message ? err.message : 'cannot resolve live dir');
    }
    const report = listSessions(base, Date.now());
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(formatListTable(report));
    }
    return 0;
  }

  // candidates
  let raw;
  try {
    raw = fs.readFileSync(parsed.input, 'utf8');
  } catch (err) {
    usage(`cannot read --input ${parsed.input}: ${err.message}`);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    usage(`--input is not JSON: ${err.message}`);
  }
  let rows;
  try {
    rows = decide(input, thr.value);
  } catch (err) {
    if (err && err.code === 'USAGE') usage(err.message);
    throw err;
  }
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(rows)}\n`);
  } else {
    process.stdout.write(formatCandidatesPlain(rows));
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2), process.env));
  } catch (err) {
    process.stderr.write(`session-ctx-report.js: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
}

module.exports = {
  decide,
  listSessions,
  parseLiveFile,
  parseArgs,
  resolveThresholds,
  formatListTable,
  DEFAULTS,
  ENV_KEYS,
  main,
};
