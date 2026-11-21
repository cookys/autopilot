#!/usr/bin/env node
'use strict';
// local-impl-slot.js — free-slot and context-fit decision for the implicit local implementer.
// operator via PM 01M7XHF4. Prints one JSON line:
//   {"choose":true,"local_slots":{...}} or {"choose":false,"reason":"...","detail":"...","local_slots":...}
// Cloud fallback reasons: no_free_slot | draining | context_too_large.
// A failed slot query falls back to cloud (slot_query_failed:*). It does not stop the dispatch.
// Config: local_slots_cmd, local_slots_url, local_context_bytes (default 400000) via configPath.
// AUTOPILOT_LOCAL_SLOTS_CMD, including an empty string, replaces the config command.
// AUTOPILOT_LOCAL_SLOTS_URL, including an empty string, replaces config local_slots_url.
// No command: HTTP GET <origin>/v1/local/slots (origin from qwen_local), 2s, no token.
// acquireLocalSlot is the only slot query. A later lease API replaces that function.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { configPath } = require('./config-path');

const DEFAULT_BYTES = 400000;
const HTTP_TIMEOUT_MS = 2000;

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

function endpointInfo(env) {
  const r = spawnSync('bash', [path.join(__dirname, '..', 'resolve-endpoint.sh'), 'qwen_local'], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000,
  });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('{'));
  if (!line) return { ready: false, baseUrl: '' };
  try {
    const o = JSON.parse(line);
    return { ready: !!(o && o.ready === true), baseUrl: o && typeof o.base_url === 'string' ? o.base_url : '' };
  } catch { return { ready: false, baseUrl: '' }; }
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

function namesQwen(ep) {
  if (!ep || typeof ep !== 'object') return false;
  const models = ep.models;
  if (models && typeof models === 'object' && !Array.isArray(models)) {
    for (const k of Object.keys(models)) {
      if (/qwen/i.test(k)) return true;
    }
  }
  if (Array.isArray(models)) {
    for (const m of models) {
      if (typeof m === 'string' && /qwen/i.test(m)) return true;
      if (m && typeof m === 'object') {
        const id = m.id || m.name || m.alias;
        if (typeof id === 'string' && /qwen/i.test(id)) return true;
      }
    }
  }
  if (typeof ep.id === 'string' && /qwen/i.test(ep.id)) return true;
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

function interpretGateway(o, source) {
  const endpoints = Array.isArray(o.endpoints) ? o.endpoints : null;
  if (!endpoints) return null;
  const named = endpoints.filter(namesQwen);
  const ups = [];
  for (const ep of named) {
    if (ep.state !== 'up') continue;
    const free = freeOf(ep);
    if (free === null) continue;
    ups.push({ id: typeof ep.id === 'string' ? ep.id : null, free });
  }
  if (ups.length) {
    ups.sort((a, b) => b.free - a.free);
    const best = ups[0];
    if (best.free > 0) {
      return {
        local: true, backend: best.id, free: best.free, fallback: null, source, detail: 'free',
      };
    }
    return {
      local: false,
      backend: best.id,
      free: 0,
      fallback: { reason: 'no_free_slot', detail: 'all_full' },
      source,
      detail: 'all_full',
    };
  }
  if (named.length && named.every((ep) => ep.state === 'draining')) {
    return {
      local: false,
      backend: null,
      free: null,
      fallback: { reason: 'draining', detail: 'draining' },
      source,
      detail: 'draining',
    };
  }
  return queryFailed(source, 'no_backend');
}

function interpretPayload(o, source) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (Array.isArray(o.endpoints) || Array.isArray(o.models)) return interpretGateway(o, source);
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
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5000,
  });
  if (r.error || r.signal || r.status === 124 || r.status === 137 || r.status == null) return queryFailed('cmd', 'timeout');
  if (r.status !== 0) return queryFailed('cmd', 'unreachable');
  const line = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find((s) => s.startsWith('{'));
  if (!line) return queryFailed('cmd', 'malformed');
  let o;
  try { o = JSON.parse(line); } catch { return queryFailed('cmd', 'malformed'); }
  return interpretPayload(o, 'cmd') || queryFailed('cmd', 'malformed');
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

async function slotsFromHttp(urlStr) {
  const res = await httpGet(urlStr, HTTP_TIMEOUT_MS);
  if (!res || res.error === 'timeout') return queryFailed('gateway', 'timeout');
  if (res.error) return queryFailed('gateway', 'unreachable');
  if (res.status !== 200) {
    const code = Number.isInteger(res.status) ? res.status : 0;
    return queryFailed('gateway', `http_${code}`);
  }
  let o;
  try { o = JSON.parse(res.body); } catch { return queryFailed('gateway', 'malformed'); }
  return interpretPayload(o, 'gateway') || queryFailed('gateway', 'malformed');
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
  return slotsFromHttp(url);
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
  if (!info.ready) {
    return { choose: false, reason: 'no_free_slot', detail: 'endpoint_not_ready', local_slots: null };
  }
  const cfg = readConfig(env);
  const limit = Number.isFinite(Number(cfg.local_context_bytes)) && Number(cfg.local_context_bytes) > 0
    ? Number(cfg.local_context_bytes) : DEFAULT_BYTES;
  const bytes = contextBytes(promptFile, cwd);
  if (bytes > limit) {
    return { choose: false, reason: 'context_too_large', detail: String(bytes), local_slots: null };
  }
  const slot = await acquireLocalSlot({ env, cfg, endpoint: info });
  const view = slotView(slot);
  if (slot.local) return { choose: true, local_slots: view };
  const fb = slot.fallback || { reason: 'no_free_slot', detail: 'slot_query_failed:malformed' };
  return { choose: false, reason: fb.reason, detail: fb.detail, local_slots: view };
}

async function main() {
  const i = process.argv.indexOf('--prompt-file');
  const promptFile = i >= 0 ? process.argv[i + 1] : '';
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  process.stdout.write(`${JSON.stringify(await decide({ promptFile, cwd }))}\n`);
}

if (require.main === module) main();

module.exports = { decide, contextBytes, acquireLocalSlot, DEFAULT_BYTES };
