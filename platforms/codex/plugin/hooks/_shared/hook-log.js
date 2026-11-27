'use strict';
/**
 * hook-log.js — one shared decision log for guard hooks (M7d).
 *
 * One JSONL line per decision: {hook, rule, decision: allow|warn|block, intercepted, at}.
 *   intercepted = true when the hook really changed what happens (deny, or an input rewrite);
 *   a warn that only adds text is intercepted=false.
 * `hook` must be registered in hooks/gates.tsv (same id column as capacity's gates.tsv).
 *
 * Default-on. Destination: AUTOPILOT_HOOK_LOG=<file>, else
 * ${XDG_STATE_HOME:-$HOME/.local/state}/autopilot/hook-log.jsonl; AUTOPILOT_HOOK_LOG=off disables.
 * The log FAILS LOUDLY: logDecision throws when the line cannot be written, and
 * record() turns that into stderr + exit 1. It never silently skips.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DECISIONS = new Set(['allow', 'warn', 'block']);
const GATES_TSV = path.join(__dirname, '..', 'gates.tsv');

function registeredHooks(tsv = GATES_TSV) {
  const rows = fs.readFileSync(tsv, 'utf8').split('\n').slice(1);
  return new Set(rows.map((r) => r.split('\t')[0]).filter(Boolean));
}

function envVar(env, key) {
  const v = env ? env[key] : process.env[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Where decisions go: AUTOPILOT_HOOK_LOG, else ${XDG_STATE_HOME:-$HOME/.local/state}/autopilot/hook-log.jsonl.
// AUTOPILOT_HOOK_LOG=off disables logging (null). `dflt` marks the default path (its directory is created).
function logTarget(env) {
  const o = envVar(env, 'AUTOPILOT_HOOK_LOG');
  if (o && o.toLowerCase() === 'off') return null;
  if (o) return { file: o, dflt: false };
  const state = envVar(env, 'XDG_STATE_HOME') || path.join(envVar(env, 'HOME') || os.homedir(), '.local', 'state');
  return { file: path.join(state, 'autopilot', 'hook-log.jsonl'), dflt: true };
}

function logPath(env) {
  const t = logTarget(env);
  return t && t.file;
}

// Throws on any problem: bad entry, unregistered hook, unwritable path.
function logDecision(entry, opts = {}) {
  const t = opts.path ? { file: opts.path, dflt: false } : logTarget(opts.env);
  if (!t) throw new Error('hook-log: logging is off (AUTOPILOT_HOOK_LOG=off)');
  const file = t.file;
  const e = entry || {};
  if (!registeredHooks(opts.gates).has(e.hook)) throw new Error(`hook-log: hook "${e.hook}" is not registered in hooks/gates.tsv`);
  if (typeof e.rule !== 'string' || !e.rule) throw new Error('hook-log: rule must be a non-empty string');
  if (!DECISIONS.has(e.decision)) throw new Error(`hook-log: decision must be allow|warn|block, got "${e.decision}"`);
  if (typeof e.intercepted !== 'boolean') throw new Error('hook-log: intercepted must be boolean');
  const line = JSON.stringify({
    hook: e.hook, rule: e.rule, decision: e.decision, intercepted: e.intercepted,
    at: e.at || new Date().toISOString(),
  });
  if (t.dflt) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
}

// For hooks: no-op when unconfigured; on failure print and exit 1 (outside any fail-open catch).
function record(entry, opts = {}) {
  if (!opts.path && !logTarget(opts.env)) return;
  try {
    logDecision(entry, opts);
  } catch (err) {
    process.stderr.write(`hook-log: cannot record decision: ${err && err.message}\n`);
    process.exit(1);
  }
}

module.exports = { logDecision, record, logPath, logTarget, registeredHooks, DECISIONS };
