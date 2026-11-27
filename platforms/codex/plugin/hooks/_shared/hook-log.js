'use strict';
/**
 * hook-log.js — one shared decision log for guard hooks (M7d).
 *
 * One JSONL line per decision: {hook, rule, decision: allow|warn|block, intercepted, at}.
 *   intercepted = true when the hook really changed what happens (deny, or an input rewrite);
 *   a warn that only adds text is intercepted=false.
 * `hook` must be registered in hooks/gates.tsv (same id column as capacity's gates.tsv).
 *
 * Destination: AUTOPILOT_HOOK_LOG=<file>. Unset = logging not configured (nothing happens).
 * Once configured the log FAILS LOUDLY: logDecision throws when the line cannot be written, and
 * record() turns that into stderr + exit 1. It never silently skips.
 */
const fs = require('fs');
const path = require('path');

const DECISIONS = new Set(['allow', 'warn', 'block']);
const GATES_TSV = path.join(__dirname, '..', 'gates.tsv');

function registeredHooks(tsv = GATES_TSV) {
  const rows = fs.readFileSync(tsv, 'utf8').split('\n').slice(1);
  return new Set(rows.map((r) => r.split('\t')[0]).filter(Boolean));
}

function logPath(env = process.env) {
  const p = env.AUTOPILOT_HOOK_LOG;
  return typeof p === 'string' && p.trim() ? p : null;
}

// Throws on any problem: bad entry, unregistered hook, unwritable path.
function logDecision(entry, opts = {}) {
  const file = opts.path || logPath(opts.env);
  if (!file) throw new Error('hook-log: no log path (set AUTOPILOT_HOOK_LOG)');
  const e = entry || {};
  if (!registeredHooks(opts.gates).has(e.hook)) throw new Error(`hook-log: hook "${e.hook}" is not registered in hooks/gates.tsv`);
  if (typeof e.rule !== 'string' || !e.rule) throw new Error('hook-log: rule must be a non-empty string');
  if (!DECISIONS.has(e.decision)) throw new Error(`hook-log: decision must be allow|warn|block, got "${e.decision}"`);
  if (typeof e.intercepted !== 'boolean') throw new Error('hook-log: intercepted must be boolean');
  const line = JSON.stringify({
    hook: e.hook, rule: e.rule, decision: e.decision, intercepted: e.intercepted,
    at: e.at || new Date().toISOString(),
  });
  fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
}

// For hooks: no-op when unconfigured; on failure print and exit 1 (outside any fail-open catch).
function record(entry, opts = {}) {
  if (!opts.path && !logPath(opts.env)) return;
  try {
    logDecision(entry, opts);
  } catch (err) {
    process.stderr.write(`hook-log: cannot record decision: ${err && err.message}\n`);
    process.exit(1);
  }
}

module.exports = { logDecision, record, logPath, registeredHooks, DECISIONS };
