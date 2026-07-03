'use strict';
// load-endpoints-env.js — Node twin of scripts/load-endpoints-env.sh.
// Populates the Anthropic-compatible endpoint credential env vars from the by-user BASE file
// plus (opt-in) a per-repo OVERLAY, so the JS reviewer (dispatch-anthropic-review.js) and the
// `autopilot endpoints` CLI honor the same one-credential-home + overlay contract.
//
// Node built-ins ONLY (fs, os, path, child_process) — must run under a dep-minimal sandbox.
//
// SECRET HYGIENE: never returns or logs a token VALUE — `loaded`/entries expose KEY names +
// values only to the in-process caller, never to a log. Same safety gate + allowlist +
// line-parser (never eval) as the shell twin. Keying is delegated to the shell twin's
// `--repo-key` so the bash + JS overlay resolution can never drift.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
  return /^AUTOPILOT_ENDPOINT_([A-Za-z0-9_]+)_(URL|TOKEN)$/.test(key);
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

// repoKey(cwd) -> the per-repo overlay key, or null. Delegates to the shell twin's `--repo-key`
// (single source of truth for keying — bash + JS can never drift). Returns null when not a git
// repo / bash|git unavailable (⇒ overlay simply does not apply).
function repoKey(cwd) {
  try {
    const sh = path.join(__dirname, '..', 'load-endpoints-env.sh');
    const r = spawnSync('bash', [sh, '--repo-key'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    if (r.status !== 0 || !r.stdout) return null;
    const key = r.stdout.trim();
    return key || null;
  } catch (_err) {
    return null;
  }
}

// parseEndpointsFile(file, opts) -> { rejected, reason?, entries } — perms-gate + line-parse ONE
// credential file. `entries` is a plain object of allowlisted KEY -> value (empty when rejected).
// NEVER executes file contents. Mirrors the shell twin's _autopilot_endpoints_load_file gate.
function parseEndpointsFile(file, opts) {
  opts = opts || {};
  const warn = opts.warn || ((m) => process.stderr.write(m + '\n'));
  const entries = {};
  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch (_err) {
    return { rejected: false, reason: 'absent', entries }; // no file ⇒ nothing to parse
  }
  if (lst.isSymbolicLink()) {
    warn(`load-endpoints-env: refusing symlink credential file: ${file}`);
    return { rejected: true, reason: 'symlink', entries };
  }
  if (!lst.isFile()) {
    warn(`load-endpoints-env: not a regular file, skipping: ${file}`);
    return { rejected: true, reason: 'not-regular', entries };
  }
  const hasUid = typeof process.getuid === 'function';
  if (hasUid) {
    if (lst.uid !== process.getuid()) {
      warn(`load-endpoints-env: refusing credential file not owned by you: ${file}`);
      return { rejected: true, reason: 'not-owner', entries };
    }
    const mode = lst.mode & 0o777;
    if (mode & 0o022) {
      warn(`load-endpoints-env: refusing group/other-writable credential file (chmod 600 ${file})`);
      return { rejected: true, reason: 'writable', entries };
    }
    if (mode & 0o044) {
      warn(`load-endpoints-env: WARNING credential file is group/other-readable (chmod 600 ${file} recommended)`);
    }
  } else {
    // Can't verify ownership/perms (e.g. no getuid) ⇒ fail closed, matching the shell twin's
    // "cannot determine permissions, refusing". Credential loading is unix-first by design.
    warn(`load-endpoints-env: refusing credential file (cannot verify permissions on this platform): ${file}`);
    return { rejected: true, reason: 'perms-unverifiable', entries };
  }

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (_err) {
    warn(`load-endpoints-env: cannot read credential file: ${file}`);
    return { rejected: true, reason: 'read-error', entries };
  }
  for (const raw of content.split('\n')) {
    let line = raw.replace(/^\s+/, '');
    if (line === '' || line[0] === '#') continue;
    if (/^export\s+/.test(line)) line = line.replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
    if (!keyAllowed(key)) continue;
    entries[key] = stripOneQuoteLayer(line.slice(eq + 1));
  }
  return { rejected: false, entries };
}

// loadEndpointsEnv({ path?, env?, warn?, cwd? }) -> { loaded: string[], rejected: bool, reason? }
// Loads the (opt-in) per-repo overlay FIRST then the by-user base into `env` (default
// process.env), existing-env-wins. Precedence: process env > overlay > base. A missing base is a
// success no-op. Overlay is gated on the endpoints.d/ dir existing (zero cost otherwise).
function loadEndpointsEnv(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const warn = opts.warn || ((m) => process.stderr.write(m + '\n'));
  const cwd = opts.cwd || process.cwd();
  const base = opts.path
    || env.AUTOPILOT_ENDPOINTS_ENV
    || path.join(os.homedir(), '.autopilot', 'endpoints.env');

  const loaded = [];
  const fill = (entries) => {
    for (const [k, v] of Object.entries(entries)) {
      if (!env[k]) { env[k] = v; loaded.push(k); }
    }
  };

  // Gate + parse the BASE FIRST. A present-but-rejected base fails closed — load NOTHING (not
  // even a valid overlay), so `rejected:true` guarantees no secret entered `env` (panel finding).
  const b = parseEndpointsFile(base, { warn });
  if (b.rejected) return { loaded, rejected: true, reason: b.reason };

  // Opt-in per-repo overlay — only if the endpoints.d/ dir exists (else a pure no-op). Loaded
  // BEFORE the base values so the overlay wins.
  const overlaydir = path.join(path.dirname(base), 'endpoints.d');
  let overlayDirExists = false;
  try { overlayDirExists = fs.statSync(overlaydir).isDirectory(); } catch (_e) { overlayDirExists = false; }
  if (overlayDirExists) {
    const key = repoKey(cwd);
    if (key) {
      const overlayfile = path.join(overlaydir, `${key}.env`);
      const ov = parseEndpointsFile(overlayfile, { warn }); // best-effort; warns on rejection
      fill(ov.entries);
    }
  }

  // Base values (already gated above).
  fill(b.entries);
  return { loaded, rejected: false };
}

module.exports = { loadEndpointsEnv, keyAllowed, parseEndpointsFile, repoKey };
