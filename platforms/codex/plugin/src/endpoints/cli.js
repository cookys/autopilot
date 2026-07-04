'use strict';
// src/endpoints/cli.js — `autopilot endpoints` control surface. Agent-legible + human-friendly
// view/setup for the endpoint-credential system (base ~/.autopilot/endpoints.env + opt-in
// per-repo overlay ~/.autopilot/endpoints.d/<key>.env). Node built-ins only.
//
// SECRET HYGIENE: list/which/doctor NEVER print a token VALUE — only booleans + which layer.
// `set` reads a token from STDIN only (never argv, so it can't leak via process listings) and
// writes it mode-600. Reuses the loader lib's parse + keying (single source of truth).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseEndpointsFile, repoKey, loadEndpointsEnv } = require('../../scripts/lib/load-endpoints-env');

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const NAME_RE = /^[A-Za-z0-9_]+$/;
// A value written into the line-based env file must contain NO control chars — a `\n`/`\r`
// would inject an extra `KEY=VALUE` credential assignment (or corrupt the file) on the next
// line. Reject the whole ASCII control range; a real URL/token has none.
// NOTE: the credential file is a LINE-PARSER target and is NEVER sourced by autopilot (see
// load-endpoints-env.sh), so shell metacharacters in a value are stored + read back LITERALLY
// and never executed. We therefore only forbid the control chars that break the line FORMAT;
// we do not reject `$ ; # ' "` in a token (that would reject legitimate provider tokens to
// defend against a `source`-the-file anti-pattern the design explicitly forbids).
const CONTROL_RE = /[\x00-\x1f]/;

// url grammar, mirrored from resolve-endpoint.sh is_url_safe: no whitespace/control/quote/
// backslash, and https:// (or http:// only for loopback). Keeps `set` consistent with what
// resolve-endpoint will accept as `ready`.
function isUrlSafe(u) {
  if (!u || /[\s\x00-\x1f"\\]/.test(u)) return false;
  if (/^https:\/\//.test(u)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u)) return true;
  return false;
}

function basePath(env) {
  return env.AUTOPILOT_ENDPOINTS_ENV || path.join(os.homedir(), '.autopilot', 'endpoints.env');
}
function overlayDir(env) {
  return path.join(path.dirname(basePath(env)), 'endpoints.d');
}

// Parse base + (opt-in) overlay into per-layer entries. warn is swallowed for --json cleanliness.
function readLayers(env, cwd, warn) {
  const warnFn = warn || (() => {});
  const base = parseEndpointsFile(basePath(env), { warn: warnFn });
  let overlay = { rejected: false, entries: {} };
  let overlayFile = null;
  let overlayDirExists = false;
  try { overlayDirExists = fs.statSync(overlayDir(env)).isDirectory(); } catch (_e) { overlayDirExists = false; }
  if (overlayDirExists) {
    const key = repoKey(cwd);
    if (key) {
      overlayFile = path.join(overlayDir(env), `${key}.env`);
      overlay = parseEndpointsFile(overlayFile, { warn: warnFn });
    }
  }
  return { base, overlay, overlayFile, baseFile: basePath(env), overlayDirExists };
}

// Collect endpoint NAMEs and non-secret presence/layer. Overlay wins (added last).
function collectNames(layers) {
  const names = {};
  const add = (entries, layer) => {
    for (const k of Object.keys(entries)) {
      const m = /^AUTOPILOT_ENDPOINT_([A-Za-z0-9_]+)_(URL|TOKEN)$/.exec(k);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (!names[name]) names[name] = { name, url_present: false, token_present: false, url_layer: null, token_layer: null };
      const present = !!entries[k];
      if (m[2] === 'URL' && present) { names[name].url_present = true; names[name].url_layer = layer; }
      if (m[2] === 'TOKEN' && present) { names[name].token_present = true; names[name].token_layer = layer; }
    }
  };
  add(layers.base.entries, 'base');
  add(layers.overlay.entries, 'overlay'); // overlay overrides layer attribution
  return names;
}

function endpointLayer(rec) {
  // where the resolved value predominantly comes from (overlay wins if it contributes)
  if (rec.url_layer === 'overlay' || rec.token_layer === 'overlay') return 'overlay';
  return 'base';
}

function selectedEndpoint(cwd, field) {
  // reviewer_endpoint / implementer_endpoint for THIS repo, via the config resolver (DRY).
  try {
    const r = spawnSync('bash', [path.join(SCRIPTS, 'resolve-review-loop.sh'), '--field', field], {
      cwd, encoding: 'utf8', timeout: 8000,
    });
    if (r.status !== 0 || !r.stdout) return '';
    return r.stdout.trim();
  } catch (_e) { return ''; }
}

function cmdInit(io) {
  const r = spawnSync('bash', [path.join(SCRIPTS, 'load-endpoints-env.sh'), '--init'], { stdio: 'inherit' });
  return { status: r.status === 0 ? 0 : 1 };
}

function cmdList(io, jsonMode) {
  // Surface a perms-rejection warning in non-json mode so a silently-empty list isn't mistaken
  // for "no endpoints configured" when the real cause is a rejected base/overlay (panel finding).
  const layers = readLayers(io.env, io.cwd, jsonMode ? null : (m) => io.stderr.write(m + '\n'));
  const names = collectNames(layers);
  const rows = Object.values(names).map((r) => ({
    name: r.name,
    url_present: r.url_present,
    token_present: r.token_present,
    layer: endpointLayer(r),
    ready: r.url_present && r.token_present,
  })).sort((a, b) => a.name.localeCompare(b.name));
  if (jsonMode) {
    io.stdout.write(JSON.stringify({ base_file: layers.baseFile, overlay_file: layers.overlayFile, endpoints: rows }) + '\n');
  } else if (rows.length === 0) {
    io.stdout.write('no endpoints defined (run: autopilot endpoints set <name> --url <url> --token-stdin)\n');
  } else {
    for (const r of rows) {
      io.stdout.write(`${r.ready ? '✓' : '✗'} ${r.name}  url=${r.url_present ? 'yes' : 'MISSING'} token=${r.token_present ? 'yes' : 'MISSING'} [${r.layer}]\n`);
    }
  }
  return { status: 0 };
}

function cmdWhich(io, jsonMode) {
  const layers = readLayers(io.env, io.cwd, jsonMode ? null : (m) => io.stderr.write(m + '\n'));
  const names = collectNames(layers);
  const roles = ['reviewer_endpoint', 'implementer_endpoint'];
  const out = roles.map((role) => {
    const name = selectedEndpoint(io.cwd, role);
    if (!name) return { role, name: '', selected: false, note: 'unset — uses raw ANTHROPIC_BASE_URL/AUTH_TOKEN env if any' };
    const rec = names[name.toLowerCase()];
    if (!rec) return { role, name, selected: true, defined: false, resolves: false, note: 'selected but no credential defined in base/overlay' };
    return {
      role, name, selected: true, defined: true,
      url_present: rec.url_present, token_present: rec.token_present,
      layer: endpointLayer(rec), resolves: rec.url_present && rec.token_present,
    };
  });
  const key = repoKey(io.cwd);
  let repoKeySource = null;
  if (key) {
    repoKeySource = key.startsWith('path_') ? 'path-fallback' : 'remote';
  }
  if (jsonMode) {
    const response = { repo_key: key, selections: out };
    if (key) {
      response.repo_key_source = repoKeySource;
    }
    io.stdout.write(JSON.stringify(response) + '\n');
  } else {
    for (const o of out) {
      if (!o.selected) { io.stdout.write(`${o.role}: (unset)\n`); continue; }
      if (!o.defined) { io.stdout.write(`${o.role}: ${o.name} — ⚠ ${o.note}\n`); continue; }
      io.stdout.write(`${o.role}: ${o.name}  ${o.resolves ? '✓ resolves' : '✗ ' + (o.url_present ? '' : 'url ') + (o.token_present ? '' : 'token ') + 'MISSING'} [${o.layer}]\n`);
    }
    if (repoKeySource === 'path-fallback') {
      io.stdout.write('Warning: repo-key is path-fallback (moving the working tree changes the key)\n');
    }
  }
  return { status: 0 };
}

function upsertLine(content, key, value) {
  const lines = content.length ? content.replace(/\n$/, '').split('\n') : [];
  const re = new RegExp(`^(export\\s+)?${key}=`);
  let found = false;
  const next = lines.map((l) => {
    if (re.test(l.replace(/^\s+/, ''))) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) next.push(`${key}=${value}`);
  return next.join('\n') + '\n';
}

function cmdSet(io, rest) {
  const name = rest[0];
  if (!name || !NAME_RE.test(name)) { io.stderr.write('ERROR: endpoints set <name> — name must be [A-Za-z0-9_]\n'); return { status: 2 }; }
  let url = null; let tokenStdin = false; let toRepo = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--url') { url = rest[++i]; if (!url) { io.stderr.write('ERROR: --url requires a value\n'); return { status: 2 }; } if (!isUrlSafe(url)) { io.stderr.write('ERROR: --url must be https:// (or http://localhost) with no whitespace/quotes\n'); return { status: 2 }; } }
    else if (a === '--token-stdin') { tokenStdin = true; }
    else if (a === '--repo') { toRepo = true; }
    else { io.stderr.write(`ERROR: unknown endpoints set option: ${a}\n`); return { status: 2 }; }
  }
  if (!url && !tokenStdin) { io.stderr.write('ERROR: nothing to set (pass --url and/or --token-stdin)\n'); return { status: 2 }; }
  // NEVER accept a token on argv — only via stdin.
  let token = null;
  if (tokenStdin) {
    try { token = (io.readStdin ? io.readStdin() : fs.readFileSync(0, 'utf8')).replace(/\r?\n$/, ''); }
    catch (_e) { io.stderr.write('ERROR: --token-stdin: could not read a token from STDIN\n'); return { status: 2 }; }
    if (!token) { io.stderr.write('ERROR: --token-stdin: empty token on STDIN\n'); return { status: 2 }; }
    if (CONTROL_RE.test(token)) { io.stderr.write('ERROR: --token-stdin: token must not contain control characters (newline injection)\n'); return { status: 2 }; }
  }
  // Target file: base, or the per-repo overlay. Every filesystem op below is wrapped so an
  // EACCES/EISDIR/ENOENT surfaces as a clean `stderr + {status:2}` instead of an uncaught throw
  // (the runEndpointsCli contract — panel finding). The error string carries err.code/path only,
  // never the token value.
  try {
    let target;
    if (toRepo) {
      const key = repoKey(io.cwd);
      if (!key) { io.stderr.write('ERROR: --repo: not inside a git repo (cannot key the overlay)\n'); return { status: 2 }; }
      if (key.startsWith('path_')) {
        io.stderr.write('Warning: repo has no git remote. Overlay is keyed to the checkout PATH and will stop applying if the tree moves.\n');
      }
      target = path.join(overlayDir(io.env), `${key}.env`);
    } else {
      target = basePath(io.env);
    }
    // Ensure the holding dir is mode 700 even if it PRE-EXISTS (mkdir's mode only applies on
    // creation, so a pre-existing ~/.autopilot at 0755 would leak endpoint filenames — panel).
    const tdir = path.dirname(target);
    fs.mkdirSync(tdir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(tdir, 0o700); } catch (_e) { /* best-effort dir hardening */ }
    // Refuse a symlink OR any non-regular existing target (never write through one / into a dir).
    let st = null;
    try { st = fs.lstatSync(target); } catch (_e) { st = null; } // absent is fine
    if (st) {
      if (st.isSymbolicLink()) { io.stderr.write(`ERROR: refusing to write through a symlink: ${target}\n`); return { status: 2 }; }
      if (!st.isFile()) { io.stderr.write(`ERROR: target is not a regular file: ${target}\n`); return { status: 2 }; }
    }
    let content = st ? fs.readFileSync(target, 'utf8') : '';
    const upper = name.toUpperCase();
    const setKeys = [];
    if (url) { content = upsertLine(content, `AUTOPILOT_ENDPOINT_${upper}_URL`, url); setKeys.push(`${upper}_URL`); }
    if (token) { content = upsertLine(content, `AUTOPILOT_ENDPOINT_${upper}_TOKEN`, token); setKeys.push(`${upper}_TOKEN`); }
    // ATOMIC write (tmp in the same dir + rename) so a crash mid-write can't leave the secret
    // file partial/corrupt — panel finding. tmp is created mode 600 under umask 077.
    const prevMask = process.umask(0o077);
    const tmp = `${target}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(tmp, content, { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, target);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_e2) { /* nothing to clean */ }
      throw e;
    } finally { process.umask(prevMask); }
    io.stdout.write(`endpoints: set ${setKeys.join(', ')} in ${target} (mode 600)\n`); // never echoes the token value
    return { status: 0 };
  } catch (err) {
    io.stderr.write(`ERROR: endpoints set failed: ${(err && err.code) || (err && err.message) || 'io error'}\n`);
    return { status: 2 };
  }
}

function cmdDoctor(io, jsonMode) {
  const layers = readLayers(io.env, io.cwd, (m) => { if (!jsonMode) io.stderr.write(m + '\n'); });
  const issues = [];
  if (layers.base.rejected) issues.push(`base file rejected: ${layers.base.reason} (${layers.baseFile})`);
  if (layers.overlay.rejected) issues.push(`overlay file rejected: ${layers.overlay.reason} (${layers.overlayFile})`);
  const names = collectNames(layers);
  const eps = Object.values(names).map((r) => {
    const problems = [];
    if (!r.url_present) problems.push('url missing');
    if (!r.token_present) problems.push('token missing');
    return { name: r.name, ok: problems.length === 0, problems };
  });
  for (const e of eps) if (!e.ok) issues.push(`${e.name}: ${e.problems.join(', ')}`);
  const healthy = issues.length === 0;
  if (jsonMode) {
    io.stdout.write(JSON.stringify({ healthy, base_file: layers.baseFile, overlay_file: layers.overlayFile, endpoints: eps, issues }) + '\n');
  } else {
    io.stdout.write(`base:    ${layers.baseFile}${layers.base.rejected ? ' — REJECTED (' + layers.base.reason + ')' : ''}\n`);
    io.stdout.write(`overlay: ${layers.overlayFile || '(none for this repo)'}${layers.overlay.rejected ? ' — REJECTED (' + layers.overlay.reason + ')' : ''}\n`);
    if (healthy) io.stdout.write('✓ all defined endpoints resolve (url + token present)\n');
    else for (const i of issues) io.stdout.write(`✗ ${i}\n`);
  }
  return { status: healthy ? 0 : 1 };
}

function cmdTest(io, rest) {
  const name = rest[0];
  const jsonMode = rest.includes('--json');
  if (!name || !NAME_RE.test(name)) {
    if (jsonMode) {
      io.stdout.write(JSON.stringify({ outcome: 'not_configured' }) + '\n');
    } else {
      io.stderr.write('ERROR: endpoints test <name> — name must be [A-Za-z0-9_]\n');
    }
    return { status: 2 };
  }

  // Load endpoints env first
  loadEndpointsEnv({ env: io.env, cwd: io.cwd, warn: () => {} });

  const upper = name.toUpperCase();
  const urlKey = `AUTOPILOT_ENDPOINT_${upper}_URL`;
  const tokenKey = `AUTOPILOT_ENDPOINT_${upper}_TOKEN`;
  const url = io.env[urlKey];
  const token = io.env[tokenKey];

  if (!url || !token) {
    if (jsonMode) {
      io.stdout.write(JSON.stringify({ outcome: 'not_configured' }) + '\n');
    } else {
      io.stdout.write('not_configured\n');
    }
    return { status: 2 };
  }

  const childCode = `
const { URL } = require('url');
const url = process.env.TEST_URL;
const token = process.env.TEST_TOKEN;
const timeoutMs = Number(process.env.AUTOPILOT_TEST_TIMEOUT_MS) || 15000;

function resolveEndpointUrl(baseUrl) {
  let clean = baseUrl;
  while (clean.endsWith('/')) {
    clean = clean.slice(0, -1);
  }
  if (clean.endsWith('/v1/messages')) return clean;
  if (clean.endsWith('/v1')) return clean + '/messages';
  return clean + '/v1/messages';
}

let parsedUrl;
try {
  parsedUrl = new URL(resolveEndpointUrl(url));
} catch (err) {
  console.log(JSON.stringify({ outcome: 'not_configured', status: 2 }));
  process.exit(0);
}

const payload = JSON.stringify({
  model: 'claude-3-haiku-20240307',
  max_tokens: 1,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
});

const transport = parsedUrl.protocol === 'http:' ? require('http') : require('https');
const startTime = Date.now();

const req = transport.request(
  {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      authorization: 'Bearer ' + token,
      'anthropic-version': '2023-06-01',
      connection: 'close',
    },
  },
  (res) => {
    let responseClosed = false;
    const chunks = [];
    res.on('data', (chunk) => {
      if (chunks.reduce((acc, c) => acc + c.length, 0) < 1024) {
        chunks.push(chunk);
      }
    });
    res.on('end', () => {
      if (responseClosed) return;
      responseClosed = true;
      const latency = Date.now() - startTime;
      const statusCode = res.statusCode;
      if (statusCode >= 200 && statusCode < 300) {
        console.log(JSON.stringify({ outcome: 'ok', latency, status: 0 }));
      } else if (statusCode === 401 || statusCode === 403) {
        console.log(JSON.stringify({ outcome: 'auth_failed', latency, status: 1 }));
      } else if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
        // Retryable / server-side conditions are NOT credential failures
        console.log(JSON.stringify({ outcome: 'network_failed', http_status: statusCode, latency, status: 1 }));
      } else {
        console.log(JSON.stringify({ outcome: 'auth_failed', http_status: statusCode, latency, status: 1 }));
      }
      process.exit(0);
    });
    res.on('error', (err) => {
      if (responseClosed) return;
      responseClosed = true;
      console.log(JSON.stringify({ outcome: 'network_failed', latency: Date.now() - startTime, status: 1 }));
      process.exit(0);
    });
  }
);

const timer = setTimeout(() => {
  req.destroy(new Error('timeout'));
}, timeoutMs);

req.on('error', (err) => {
  clearTimeout(timer);
  const latency = Date.now() - startTime;
  console.log(JSON.stringify({ outcome: 'network_failed', latency, status: 1 }));
  process.exit(0);
});

req.on('close', () => clearTimeout(timer));
req.write(payload);
req.end();
`;

  const r = spawnSync(process.execPath, ['-'], {
    input: childCode,
    env: Object.assign({}, io.env, {
      TEST_URL: url,
      TEST_TOKEN: token,
    }),
    encoding: 'utf8',
    timeout: 18000,
  });

  let res;
  if (r.status === 0 && r.stdout) {
    try {
      res = JSON.parse(r.stdout.trim());
    } catch (e) {
      res = { outcome: 'network_failed', status: 1 };
    }
  } else {
    res = { outcome: 'network_failed', status: 1 };
  }

  if (jsonMode) {
    const obj = { outcome: res.outcome };
    if (res.http_status) obj.http_status = res.http_status;
    if (res.latency !== undefined) obj.latency_ms = res.latency;
    io.stdout.write(JSON.stringify(obj) + '\n');
  } else {
    if (res.latency !== undefined) {
      const details = res.http_status ? ` (HTTP ${res.http_status})` : '';
      io.stdout.write(`${res.outcome}${details} (${res.latency}ms)\n`);
    } else {
      io.stdout.write(`${res.outcome}\n`);
    }
  }
  return { status: res.status };
}

function printHelp(io) {
  io.stdout.write(`Usage: autopilot endpoints <cmd>
  init                          scaffold ~/.autopilot/endpoints.env from the template
  list [--json]                 list defined endpoints (name, url/token present, layer)
  which [--json]                for THIS repo: which endpoints reviewer/implementer select + resolve
  set <name> --url <u> [--token-stdin] [--repo]
                                write url (+ token via STDIN only) to base or the per-repo overlay
  test <name> [--json]          sends one tiny live request; costs tokens (verify auth + latency)
  doctor [--json]               diagnose file perms + unresolved endpoints (no network)
Tokens are NEVER printed and NEVER read from argv.
`);
}

function runEndpointsCli(args, io) {
  io = io || {};
  io.env = io.env || process.env;
  io.cwd = io.cwd || process.cwd();
  io.stdout = io.stdout || process.stdout;
  io.stderr = io.stderr || process.stderr;
  const sub = args[0];
  const rest = args.slice(1);
  const jsonMode = rest.includes('--json');
  switch (sub) {
    case 'init': return cmdInit(io);
    case 'list': return cmdList(io, jsonMode);
    case 'which': return cmdWhich(io, jsonMode);
    case 'set': return cmdSet(io, rest);
    case 'test': return cmdTest(io, rest);
    case 'doctor': return cmdDoctor(io, jsonMode);
    case 'help': case '-h': case '--help': printHelp(io); return { status: 0 };
    default:
      io.stderr.write(`ERROR: unknown endpoints subcommand: ${sub || '<missing>'}\n`);
      printHelp(io);
      return { status: 2 };
  }
}

module.exports = { runEndpointsCli };
