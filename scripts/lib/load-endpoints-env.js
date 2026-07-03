'use strict';
// load-endpoints-env.js — Node twin of scripts/load-endpoints-env.sh.
// Populates the Anthropic-compatible endpoint credential env vars from the single
// canonical machine-local file, so the JS reviewer (dispatch-anthropic-review.js) honors
// the same one-credential-home contract even when invoked directly (not spawned by
// dispatch-review.sh, which would have loaded them via the shell twin).
//
// Node built-ins ONLY (fs, os, path) — must run under a dep-minimal sandbox.
//
// SECRET HYGIENE: never returns or logs a token VALUE — the returned `loaded` array holds
// only KEY names. Same safety gate + allowlist + line-parser (never eval) as the shell twin.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Allowlisted credential var NAMES (in sync with the shell twin + resolve-endpoint.sh).
function keyAllowed(key) {
  switch (key) {
    case 'ANTHROPIC_BASE_URL':
    case 'ANTHROPIC_AUTH_TOKEN':
    case 'ANTHROPIC_COMPATIBLE_BASE_URL':
    case 'ANTHROPIC_COMPATIBLE_AUTH_TOKEN':
    case 'MINIMAX_API_KEY':
    case 'AUTOPILOT_MINIMAX_BASE_URL':
      return true;
    default:
      break;
  }
  const m = /^AUTOPILOT_ENDPOINT_([A-Za-z0-9_]+)_(URL|TOKEN)$/.exec(key);
  return !!m;
}

function stripOneQuoteLayer(val) {
  if (val.length >= 2) {
    const a = val[0];
    const b = val[val.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return val.slice(1, -1);
    }
  }
  return val;
}

// loadEndpointsEnv({ path?, env?, warn? }) -> { loaded: string[], rejected: bool, reason?: string }
// Mutates `env` (default process.env). `warn` (default console.error) receives NON-SECRET
// diagnostics only. A missing file is a success no-op ({ loaded: [], rejected: false }).
function loadEndpointsEnv(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const warn = opts.warn || ((m) => process.stderr.write(m + '\n'));
  const envfile = opts.path
    || env.AUTOPILOT_ENDPOINTS_ENV
    || path.join(os.homedir(), '.autopilot', 'endpoints.env');

  let lst;
  try {
    lst = fs.lstatSync(envfile);
  } catch (_err) {
    return { loaded: [], rejected: false }; // no file ⇒ no-op success
  }
  if (lst.isSymbolicLink()) {
    warn(`load-endpoints-env: refusing symlink credential file: ${envfile}`);
    return { loaded: [], rejected: true, reason: 'symlink' };
  }
  if (!lst.isFile()) {
    warn(`load-endpoints-env: not a regular file, skipping: ${envfile}`);
    return { loaded: [], rejected: true, reason: 'not-regular' };
  }
  // Ownership + perms: only enforceable where the OS exposes uid/mode (POSIX). On a
  // platform without getuid (Windows) the gate can't be enforced — warn once and parse.
  const hasUid = typeof process.getuid === 'function';
  if (hasUid) {
    if (lst.uid !== process.getuid()) {
      warn(`load-endpoints-env: refusing credential file not owned by you: ${envfile}`);
      return { loaded: [], rejected: true, reason: 'not-owner' };
    }
    const mode = lst.mode & 0o777;
    if (mode & 0o022) {
      warn(`load-endpoints-env: refusing group/other-writable credential file (chmod 600 ${envfile})`);
      return { loaded: [], rejected: true, reason: 'writable' };
    }
    if (mode & 0o044) {
      warn(`load-endpoints-env: WARNING credential file is group/other-readable (chmod 600 ${envfile} recommended)`);
    }
  } else {
    warn('load-endpoints-env: WARNING cannot verify credential file permissions on this platform');
  }

  let content;
  try {
    content = fs.readFileSync(envfile, 'utf8');
  } catch (err) {
    warn(`load-endpoints-env: cannot read credential file: ${envfile}`);
    return { loaded: [], rejected: true, reason: 'read-error' };
  }

  const loaded = [];
  for (let raw of content.split('\n')) {
    let line = raw.replace(/^\s+/, '');
    if (line === '' || line[0] === '#') continue;
    if (/^export\s+/.test(line)) line = line.replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue; // no trailing space / stray chars in key
    if (!keyAllowed(key)) continue;
    let val = stripOneQuoteLayer(line.slice(eq + 1));
    // Existing non-empty env WINS — file only fills gaps.
    if (!env[key]) {
      env[key] = val;
      loaded.push(key);
    }
  }
  return { loaded, rejected: false };
}

module.exports = { loadEndpointsEnv, keyAllowed };
