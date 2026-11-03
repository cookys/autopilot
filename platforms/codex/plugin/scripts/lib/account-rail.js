'use strict';
/**
 * account-rail.js - JS caller helper for the G37 account layer (plan 8 W4, N9).
 *
 *   layerState({ env, purpose })  -> { state: 'legacy' | 'active' | 'invalid', detail }
 *   wrapClaude(bin, argv, { purpose, stdinFile, cwd, timeoutSecs }) -> { command, args }
 *
 * layerState asks `claude-account.js env-check` (spawns no claude, never prints a token):
 *   legacy   registry absent (`unconfigured`) or `accounts.mode` off (`mode_off`): the caller keeps its
 *            current path byte-for-byte
 *   active   a registry exists and every enabled alias passed the 5.1 checks: the caller must spawn the
 *            child ONLY through wrapClaude (claude-account.js run), never with its own credentials
 *   invalid  registry present but broken (env-check exit != 0): fail closed, the caller spawns nothing
 *            and exits non-zero. The detail is the one stderr line of env-check.
 * The token is read by claude-account.js only; this module never opens a token or credentials file.
 *
 * Node >= 20.10, built-ins only.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ACCOUNT_CLI = path.join(__dirname, '..', 'claude-account.js');

function layerState(opts) {
  const o = opts || {};
  const r = spawnSync(process.execPath, [ACCOUNT_CLI, 'env-check', '--purpose', o.purpose || 'env-check'], {
    env: o.env || process.env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) {
    const line = String((r.error && r.error.code) || r.stderr || `exit ${r.status}`).split('\n')[0].slice(0, 200);
    return { state: 'invalid', detail: line };
  }
  const first = String(r.stdout || '').trim().split(/\s+/)[0];
  if (first === 'unconfigured' || first === 'mode_off') return { state: 'legacy', detail: first };
  return { state: 'active', detail: 'ok' };
}

/** The command line that runs `<bin> <argv...>` through the account layer. */
function wrapClaude(bin, argv, opts) {
  const o = opts || {};
  const args = [ACCOUNT_CLI, 'run', '--purpose', o.purpose];
  if (o.stdinFile) args.push('--stdin', o.stdinFile);
  if (o.cwd) args.push('--cwd', o.cwd);
  if (o.timeoutSecs) args.push('--timeout', String(o.timeoutSecs));
  args.push('--', bin, ...argv);
  return { command: process.execPath, args };
}

module.exports = { ACCOUNT_CLI, layerState, wrapClaude };
