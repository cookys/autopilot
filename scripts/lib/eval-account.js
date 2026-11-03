'use strict';
/**
 * eval-account.js - G37 W5: the account-layer front for Node eval runners (plan 4.1 A12, 8 W5, N9).
 *   probe()                 -> { state: 'legacy' | 'active' | 'broken', code?, message? }
 *       Asks `claude-account.js env-check` once, BEFORE any claude spawn. 'legacy' = unconfigured or mode_off
 *       (the runner keeps its old path byte-for-byte); 'broken' = a registry exists but is unusable (fail closed:
 *       the runner must exit non-zero without spawning anything).
 *   wrap(cmd, args, purpose)-> { cmd, args } running `claude-account.js exec --pick -- <cmd> <args>`; the token goes
 *       from claude-account.js into the child env only. HOME / CLAUDE_CONFIG_DIR of the child are the alias's.
 *   withLocators(env)       -> copy of `env` that also carries the registry/live/state locators of this process,
 *       so a cell env built from scratch still resolves the same registry.
 * Exits: callers use ACCOUNT_BROKEN_EXIT (2) for a broken registry.
 * Built-ins only, Node >= 20.10.
 */
const path = require('path');
const { layerState } = require('./account-rail');

const ACCOUNT_JS = path.join(__dirname, '..', 'claude-account.js');
const LOCATORS = ['AUTOPILOT_ACCOUNTS_DIR', 'AUTOPILOT_LIVE_DIR', 'AUTOPILOT_STATE_DIR', 'AUTOPILOT_CONFIG', 'AUTOPILOT_CONFIG_FILE', 'XDG_RUNTIME_DIR', 'TMPDIR'];
const ACCOUNT_BROKEN_EXIT = 2;

function probe(env) {
  // Fail closed when the layer is missing (L9): nothing is spawned.
  if (!require('fs').existsSync(ACCOUNT_JS)) return { state: 'broken', code: ACCOUNT_BROKEN_EXIT, message: 'claude-account.js is missing' };
  // The ONE reading of env-check (account-rail.js layerState, always --any, anything unrecognised is invalid): the same
  // rule every rail uses. legacy = unconfigured / mode_off; invalid = a registry exists but is unusable -> broken.
  const r = layerState({ env: env || process.env, purpose: 'eval-probe' });
  if (r.state === 'invalid') return { state: 'broken', code: ACCOUNT_BROKEN_EXIT, message: String(r.detail || '').slice(0, 200) };
  return { state: r.state };
}

function wrap(cmd, args, purpose) {
  return { cmd: process.execPath, args: [ACCOUNT_JS, 'exec', '--pick', '--purpose', purpose, '--', cmd, ...(args || [])] };
}

function withLocators(env, from) {
  const src = from || process.env;
  const out = Object.assign({}, env);
  for (const k of LOCATORS) if (typeof src[k] === 'string' && src[k] && out[k] === undefined) out[k] = src[k];
  return out;
}

/** One-call gate for a runner: prints one line and returns the exit code when the registry is broken, else null. */
function gate(label, env) {
  const p = probe(env);
  if (p.state === 'broken') {
    process.stderr.write(`${label}: the account registry is unusable (${p.message || 'env-check failed'}); refusing to start, nothing was spawned\n`);
    return { exit: p.code || ACCOUNT_BROKEN_EXIT, state: 'broken' };
  }
  return { exit: null, state: p.state };
}

module.exports = { probe, wrap, withLocators, gate, ACCOUNT_JS, ACCOUNT_BROKEN_EXIT };
