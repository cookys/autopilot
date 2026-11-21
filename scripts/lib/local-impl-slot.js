#!/usr/bin/env node
'use strict';
// local-impl-slot.js — free-slot and context-fit decision for the implicit local implementer.
// operator via PM 01M7XHF4. Prints one JSON line:
//   {"choose":true,"local_slots":{...}} or {"choose":false,"reason":"...","detail":"...","local_slots":...}
// Cloud fallback reasons: no_free_slot | draining | context_too_large | local_ctx_over.
// A failed slot query falls back to cloud (slot_query_failed:*). It does not stop the dispatch.
// Config: local_slots_cmd, local_slots_url, local_context_bytes, local_context_tokens and
// local_output_reserve_tokens via configPath.
// AUTOPILOT_LOCAL_SLOTS_CMD, including an empty string, replaces the config command.
// AUTOPILOT_LOCAL_SLOTS_URL, including an empty string, replaces config local_slots_url.
// No command: HTTP GET <origin>/v1/local/slots (origin from qwen_local), 2s, no token.
// acquireLocalSlot is the only slot query. A later lease API replaces that function.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { configPath } = require('./config-path');

const DEFAULT_BYTES = 400000;
const DEFAULT_CONTEXT_TOKENS = 262144;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 32000;
const HTTP_TIMEOUT_MS = 2000;

function childEnv(env) {
  const result = { ...process.env, ...env };
  delete result.AUTOPILOT_TOKEN_SEAT;
  return result;
}

function readConfig(env) {
  const file = configPath({ env });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function scopePaths(promptFile) {
  let text = '';
  try { text = fs.readFileSync(promptFile, 'utf8'); } catch { return []; }
  const lines = text.split(/\n/, 8).map((l) => l.replace(/\r$/, ''));
  const re = /(?:^|\|)[ \t]*Scope:[ \t]*([^|]*)/gi;
  const out = [];
  for (const line of lines) {
    for (const m of line.matchAll(re)) {
      for (const part of m[1].split(/[,\n]/)) {
        const p = part.trim();
        if (p) out.push(p);
      }
    }
  }
  return out;
}

function contextBytes(promptFile, cwd) {
  let n = 0;
  try { n += fs.statSync(promptFile).size; } catch { /* missing prompt is zero */ }
  for (const rel of scopePaths(promptFile)) {
    const target = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
    try { n += fs.statSync(target).size; } catch { /* absent scope file counts 0 */ }
  }
  return n;
}

function estimateLocalContext(promptFile, cwd) {
  let prompt = '';
  let promptBytes = 0;
  try {
    const data = fs.readFileSync(promptFile);
    prompt = data.toString('utf8');
    promptBytes = data.length;
  } catch { /* missing prompt is zero */ }
  const files = new Map();
  const candidates = prompt.match(/[^\s`"'<>()[\]{}|,;]+/g) || [];
  const directories = new Set();
  const bareNames = new Set();
  for (let candidate of candidates) {
    candidate = candidate.replace(/^[`"']+|[`"'.,;!?]+$/g, '');
    const match = candidate.match(/^(.+\/[^/]+\.[A-Za-z0-9]+)(?::\d+(?::\d+)?)?$/);
    if (!match) {
      if (/^[^/]+\.[A-Za-z0-9]+$/.test(candidate)) bareNames.add(candidate);
      else if (candidate.includes('/')) directories.add(candidate.replace(/^\.\//, '').replace(/\/$/, ''));
      continue;
    }
    const rel = match[1].replace(/^\.\//, '');
    if (path.isAbsolute(rel)) continue;
    const target = path.resolve(cwd, rel);
    const relative = path.relative(path.resolve(cwd), target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const stat = fs.statSync(target);
      if (stat.isFile()) files.set(relative, { path: relative, bytes: stat.size });
    } catch { /* missing references do not contribute */ }
  }
  // Resolve a basename only when the prompt also names one directory that contains it.
  // This handles prose such as "mods/live ... live.test.ts" without searching the tree.
  for (const basename of bareNames) {
    const matches = [];
    for (const directory of directories) {
      const rel = path.join(directory, basename);
      const target = path.resolve(cwd, rel);
      const relative = path.relative(path.resolve(cwd), target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      try { if (fs.statSync(target).isFile()) matches.push(relative); } catch { /* absent pair */ }
    }
    if (matches.length === 1) {
      const target = path.resolve(cwd, matches[0]);
      files.set(matches[0], { path: matches[0], bytes: fs.statSync(target).size });
    }
  }
  const ordered = [...files.values()].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const totalBytes = promptBytes + ordered.reduce((sum, file) => sum + file.bytes, 0);
  return { est_tokens: Math.ceil(totalBytes / 3.5), total_bytes: totalBytes, files: ordered.slice(0, 5) };
}

function endpointInfo(env, endpoint = 'qwen_local') {
  const r = spawnSync('bash', [path.join(__dirname, '..', 'resolve-endpoint.sh'), endpoint], {
    env: childEnv(env), encoding: 'utf8', timeout: 15000,
  });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('{'));
  if (!line) return { ready: false, baseUrl: '', tokenEnv: '' };
  try {
    const o = JSON.parse(line);
    return { ready: !!(o && o.ready === true), baseUrl: o && typeof o.base_url === 'string' ? o.base_url : '', tokenEnv: o && typeof o.token_env === 'string' ? o.token_env : '' };
  } catch { return { ready: false, baseUrl: '', tokenEnv: '' }; }
}

function leaseUrl(baseUrl) {
  try { const u = new URL(baseUrl); return `${u.protocol}//${u.host}/v1/local/lease`; } catch { return ''; }
}

function leaseRequest(urlStr, method, token, body, timeoutMs = HTTP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { resolve({ error: 'unreachable' }); return; }
    if (!['http:', 'https:'].includes(u.protocol)) { resolve({ error: 'unreachable' }); return; }
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => finish({ error: 'unreachable' }));
    });
    const timer = setTimeout(() => { req.destroy(); finish({ error: 'timeout' }); }, timeoutMs);
    req.on('error', () => finish({ error: 'unreachable' }));
    req.end(body || undefined);
  });
}

async function acquireLocalLease(opts = {}) {
  const env = opts.env || process.env;
  const cfg = opts.cfg || readConfig(env);
  const info = opts.endpoint || endpointInfo(env);
  const base = leaseUrl(info.baseUrl);
  const token = info.tokenEnv && env[info.tokenEnv] ? String(env[info.tokenEnv]) : '';
  const fail = (detail, status = null, reason = 'no_free_slot') => ({ choose: false, reason, detail, local_slots: null,
    local_lease: { id: null, granted: false, status, heartbeats: 0, released: false, detail } });
  if (!info.ready || !base || !token) return fail('lease_query_failed:unreachable');
  const parsedTtl = Number.parseInt(env.AUTOPILOT_LOCAL_LEASE_TTL_S || '180', 10);
  const ttl = Number.isInteger(parsedTtl) && parsedTtl > 0 ? parsedTtl : 180;
  const body = { model: opts.family || 'qwen', ...(opts.backend ? { backend: opts.backend } : {}), est_context_tokens: 8192, ttl_s: ttl };
  const fleetTask = env.LOCAL_SLOT_FLEET_TASK_RAW !== undefined
    ? String(env.LOCAL_SLOT_FLEET_TASK_RAW).trim()
    : String(env.AUTOPILOT_FLEET_TASK || env.HETERO_FLEET_TASK_ID || '').trim();
  if (!fleetTask || fleetTask === 'none') return fail('fleet_task_missing', null, 'fleet_task_missing');
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(fleetTask)) {
    process.stderr.write(`dispatch-hetero: local slot skipped: Fleet-Task '${fleetTask}' is not a 26-char ULID (gateway requires it); write the full task id in the brief\n`);
    return fail(`fleet_task=${fleetTask}`, null, 'fleet_task_invalid');
  }
  body.fleet_task = fleetTask;
  const res = await leaseRequest(base, 'POST', token, JSON.stringify(body));
  if (res.error) return fail(`lease_query_failed:${res.error}`);
  if (res.status === 429 || res.status === 409) return fail(res.status === 429 ? 'lease_429' : 'lease_409', res.status);
  if (res.status !== 201) {
    let message = '';
    try {
      const doc = JSON.parse(res.body);
      const value = doc && (typeof doc.error === 'string' ? doc.error
        : doc.error && typeof doc.error.message === 'string' ? doc.error.message
          : doc.message || doc.detail);
      if (typeof value === 'string') message = value.slice(0, 200);
    } catch { /* response body may not be JSON */ }
    return fail(`lease_query_failed:http_${Number.isInteger(res.status) ? res.status : 'unknown'}${message ? `:${message}` : ''}`, res.status || null);
  }
  let doc; try { doc = JSON.parse(res.body); } catch { return fail('lease_query_failed:malformed', res.status); }
  if (!doc || typeof doc.lease_id !== 'string' || !doc.lease_id.trim()) return fail('lease_query_failed:malformed', res.status);
  return { choose: true, local_slots: null, local_lease: { id: doc.lease_id, granted: true, status: res.status, heartbeats: 0, released: false, detail: null }, lease_url: base, lease_token_env: info.tokenEnv };
}

function queryFailed(source, why) {
  const detail = `slot_query_failed:${why}`;
  return {
    local: false,
    backend: null,
    free: null,
    fallback: { reason: 'no_free_slot', detail },
    source,
    detail,
  };
}

function namesFamily(ep, family) {
  if (!ep || typeof ep !== 'object') return false;
  const models = ep.models;
  if (models && typeof models === 'object' && !Array.isArray(models)) {
    for (const k of Object.keys(models)) {
      if (new RegExp(family, 'i').test(k)) return true;
    }
  }
  if (Array.isArray(models)) {
    for (const m of models) {
      if (typeof m === 'string' && new RegExp(family, 'i').test(m)) return true;
      if (m && typeof m === 'object') {
        const id = m.id || m.name || m.alias;
        if (typeof id === 'string' && new RegExp(family, 'i').test(id)) return true;
      }
    }
  }
  if (typeof ep.id === 'string' && new RegExp(family, 'i').test(ep.id)) return true;
  return false;
}

function integerFree(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function freeOf(ep) {
  if (Object.prototype.hasOwnProperty.call(ep, 'free_for_caller')) {
    return integerFree(ep.free_for_caller);
  }
  return integerFree(ep.free);
}

function roundRobinFile(env) {
  if (env.AUTOPILOT_LOCAL_SLOT_RR_FILE) return env.AUTOPILOT_LOCAL_SLOT_RR_FILE;
  if (env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, 'autopilot', 'local-slot-rr.json');
  return path.join(os.tmpdir(), `autopilot-${typeof process.getuid === 'function' ? process.getuid() : 'unknown'}`, 'local-slot-rr.json');
}

function previousFamily(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state && (state.family === 'qwen' || state.family === 'glm') ? state.family : null;
  } catch { return null; }
}

function recordFamily(file, family) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ family })}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* an unavailable state file behaves like no prior choice */ }
}

function interpretGateway(o, source, env = process.env) {
  const endpoints = Array.isArray(o.endpoints) ? o.endpoints : null;
  if (!endpoints) return null;
  const familyResult = (family) => {
    const named = endpoints.filter((ep) => namesFamily(ep, family));
    const ups = [];
    for (const ep of named) {
      if (ep.state !== 'up') continue;
      const free = freeOf(ep);
      if (free !== null) ups.push({ id: typeof ep.id === 'string' ? ep.id : null, free });
    }
    ups.sort((a, b) => b.free - a.free);
    if (ups.length && ups[0].free > 0) return { local: true, family, endpoint: `${family}_local`, backend: ups[0].id, free: ups[0].free, fallback: null, source, detail: 'free' };
    if (ups.length) return { local: false, family, backend: ups[0].id, free: 0, fallback: { reason: 'no_free_slot', detail: 'all_full' }, source, detail: 'all_full' };
    if (named.length && named.every((ep) => ep.state === 'draining')) return { local: false, family, backend: null, free: null, fallback: { reason: 'draining', detail: 'draining' }, source, detail: 'draining' };
    return null;
  };
  const qwen = familyResult('qwen');
  const glm = familyResult('glm');
  const available = [qwen, glm].filter((result) => result && result.local);
  if (available.length === 2) {
    let selected;
    if (qwen.free > glm.free) {
      selected = qwen;
      selected.pick_reason = 'more_free';
    } else if (glm.free > qwen.free) {
      selected = glm;
      selected.pick_reason = 'more_free';
    } else {
      const file = roundRobinFile(env);
      selected = previousFamily(file) === 'qwen' ? glm : qwen;
      selected.pick_reason = 'tie_round_robin';
      recordFamily(file, selected.family);
    }
    return selected;
  }
  if (available.length === 1) {
    const selected = available[0];
    selected.pick_reason = 'only_free';
    if (selected.family === 'glm' && qwen && qwen.fallback) selected.local_fallback_from = { family: 'qwen', reason: qwen.fallback.reason };
    recordFamily(roundRobinFile(env), selected.family);
    return selected;
  }
  if (qwen && qwen.fallback) return qwen;
  if (glm && glm.fallback) return glm;
  return queryFailed(source, 'no_backend');
}

function interpretPayload(o, source, env = process.env) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (Array.isArray(o.endpoints) || Array.isArray(o.models)) return interpretGateway(o, source, env);
  const free = o.free;
  if (typeof free === 'number' && Number.isInteger(free) && typeof o.draining === 'boolean') {
    if (o.draining) {
      return {
        local: false,
        backend: null,
        free,
        fallback: { reason: 'draining', detail: 'draining' },
        source,
        detail: 'draining',
      };
    }
    if (free > 0) {
      return { local: true, backend: null, free, fallback: null, source, detail: 'free' };
    }
    return {
      local: false,
      backend: null,
      free: 0,
      fallback: { reason: 'no_free_slot', detail: 'all_full' },
      source,
      detail: 'all_full',
    };
  }
  return null;
}

function slotsFromCmd(cmd, env) {
  const r = spawnSync('timeout', ['--signal=KILL', '3', 'bash', '-c', cmd], {
    env: childEnv(env), encoding: 'utf8', timeout: 5000,
  });
  if (r.error || r.signal || r.status === 124 || r.status === 137 || r.status == null) return queryFailed('cmd', 'timeout');
  if (r.status !== 0) return queryFailed('cmd', 'unreachable');
  const line = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find((s) => s.startsWith('{'));
  if (!line) return queryFailed('cmd', 'malformed');
  let o;
  try { o = JSON.parse(line); } catch { return queryFailed('cmd', 'malformed'); }
  return interpretPayload(o, 'cmd', env) || queryFailed('cmd', 'malformed');
}

// Keep the query on this event loop so in-process gateway stubs and callers can
// continue servicing sockets while the decision waits for its response.
function httpGet(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { resolve({ error: 'unreachable' }); return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      resolve({ error: 'unreachable' });
      return;
    }
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: (u.pathname || '/') + u.search,
      method: 'GET',
      headers: { accept: 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => finish({ error: 'unreachable' }));
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish({ error: 'timeout' });
    }, timeoutMs);
    req.on('socket', (socket) => {
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        req.destroy();
        finish({ error: 'timeout' });
      });
    });
    req.on('error', () => finish({ error: 'unreachable' }));
    req.end();
  });
}

async function slotsFromHttp(urlStr, env = process.env) {
  const res = await httpGet(urlStr, HTTP_TIMEOUT_MS);
  if (!res || res.error === 'timeout') return queryFailed('gateway', 'timeout');
  if (res.error) return queryFailed('gateway', 'unreachable');
  if (res.status !== 200) {
    const code = Number.isInteger(res.status) ? res.status : 0;
    return queryFailed('gateway', `http_${code}`);
  }
  let o;
  try { o = JSON.parse(res.body); } catch { return queryFailed('gateway', 'malformed'); }
  return interpretPayload(o, 'gateway', env) || queryFailed('gateway', 'malformed');
}

function slotsUrl(cfg, env, baseUrl) {
  const fromEnv = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_LOCAL_SLOTS_URL');
  const raw = fromEnv ? String(env.AUTOPILOT_LOCAL_SLOTS_URL) : String(cfg.local_slots_url || '');
  const trimmed = raw.trim();
  if (fromEnv) return trimmed;
  if (trimmed) return trimmed;
  if (!baseUrl) return '';
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}/v1/local/slots`;
  } catch { return ''; }
}

// One place a later lease (reserve / heartbeat / release) can replace the query.
async function acquireLocalSlot(opts = {}) {
  const env = opts.env || process.env;
  const cfg = opts.cfg || readConfig(env);
  const cmd = (Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_LOCAL_SLOTS_CMD')
    ? String(env.AUTOPILOT_LOCAL_SLOTS_CMD)
    : String(cfg.local_slots_cmd || '')).trim();
  if (cmd) return slotsFromCmd(cmd, env);
  const info = opts.endpoint || endpointInfo(env);
  const url = slotsUrl(cfg, env, info.baseUrl);
  if (!url) return queryFailed('gateway', 'unreachable');
  return slotsFromHttp(url, env);
}

function slotView(slot) {
  return {
    source: slot.source,
    free: slot.free == null ? null : slot.free,
    backend: slot.backend || null,
    detail: slot.detail,
  };
}

async function decide(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const promptFile = opts.promptFile;
  const info = endpointInfo(env);
  const cfg = readConfig(env);
  const contextTokens = Number.isFinite(Number(cfg.local_context_tokens)) && Number(cfg.local_context_tokens) > 0
    ? Number(cfg.local_context_tokens) : DEFAULT_CONTEXT_TOKENS;
  const outputReserve = Number.isFinite(Number(cfg.local_output_reserve_tokens)) && Number(cfg.local_output_reserve_tokens) >= 0
    ? Number(cfg.local_output_reserve_tokens) : DEFAULT_OUTPUT_RESERVE_TOKENS;
  const tokenLimit = Math.max(0, contextTokens - outputReserve);
  const estimate = estimateLocalContext(promptFile, cwd);
  if (estimate.est_tokens > tokenLimit) {
    return { choose: false, reason: 'local_ctx_over', detail: `est_tokens=${estimate.est_tokens} limit=${tokenLimit}`,
      est_tokens: estimate.est_tokens, limit: tokenLimit, files: estimate.files, local_slots: null };
  }
  const limit = Number.isFinite(Number(cfg.local_context_bytes)) && Number(cfg.local_context_bytes) > 0
    ? Number(cfg.local_context_bytes) : DEFAULT_BYTES;
  const bytes = contextBytes(promptFile, cwd);
  if (bytes > limit) {
    return { choose: false, reason: 'context_too_large', detail: String(bytes), local_slots: null };
  }
  const cmd = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_LOCAL_SLOTS_CMD') ? String(env.AUTOPILOT_LOCAL_SLOTS_CMD).trim() : String(cfg.local_slots_cmd || '').trim();
  const explicitSlotsUrl = Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_LOCAL_SLOTS_URL') || String(cfg.local_slots_url || '').trim();
  if (!cmd && !explicitSlotsUrl) {
    if (!info.ready) return { choose: false, reason: 'no_free_slot', detail: 'endpoint_not_ready', local_slots: null };
    return acquireLocalLease({ env, cfg, endpoint: info, family: 'qwen' });
  }
  const slot = await acquireLocalSlot({ env, cfg, endpoint: info });
  if (!slot.local) return { choose: false, reason: slot.fallback.reason, detail: slot.fallback.detail, local_slots: slotView(slot), family: slot.family || null };
  const leaseInfo = slot.family === 'glm' ? endpointInfo(env, 'glm_local') : info;
  if (!leaseInfo.ready) return { choose: false, reason: 'no_free_slot', detail: 'endpoint_not_ready', family: slot.family, endpoint: slot.endpoint, local_slots: slotView(slot) };
  const lease = await acquireLocalLease({ env, cfg, endpoint: leaseInfo, family: slot.family, backend: slot.backend });
  return { ...lease, family: slot.family, endpoint: slot.endpoint, backend: slot.backend, free: slot.free,
    local_fallback_from: slot.local_fallback_from || null, local_slots: slotView(slot) };
}

async function main() {
  const op = process.argv.indexOf('--lease-operation');
  if (op >= 0) {
    const operation = process.argv[op + 1];
    const urlArg = process.argv.indexOf('--lease-url');
    const idArg = process.argv.indexOf('--lease-id');
    const baseUrl = `${String(urlArg >= 0 ? process.argv[urlArg + 1] : '').replace(/\/$/, '')}/${encodeURIComponent(idArg >= 0 ? process.argv[idArg + 1] : '')}`;
    const tokenEnvArg = process.argv.indexOf('--token-env');
    const token = tokenEnvArg >= 0 ? String(process.env[process.argv[tokenEnvArg + 1]] || '') : '';
    const releasing = operation === 'release';
    const result = await leaseRequest(releasing ? baseUrl : `${baseUrl}/heartbeat`, releasing ? 'DELETE' : 'POST', token, null);
    process.exit(!result.error && (releasing ? result.status === 204 : result.status === 200) ? 0 : 1);
  }
  const i = process.argv.indexOf('--prompt-file');
  const promptFile = i >= 0 ? process.argv[i + 1] : '';
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  process.stdout.write(`${JSON.stringify(await decide({ promptFile, cwd }))}\n`);
}

if (require.main === module) main();

module.exports = { decide, contextBytes, estimateLocalContext, acquireLocalSlot, acquireLocalLease, leaseRequest, DEFAULT_BYTES };
