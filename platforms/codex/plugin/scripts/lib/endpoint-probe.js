#!/usr/bin/env node
'use strict';
// endpoint-probe.js — the pre-dispatch probe of a named local endpoint (--endpoint <name>).
//
// One GET <base>/models with a 2 second total budget, before any worker or worktree is opened, so a
// host that is gone costs 2 seconds, not the worker's connect timeout. Node built-ins only; the token
// is read from the env var the resolver names and is never printed.
//
//   node scripts/lib/endpoint-probe.js --endpoint <name> --model <id> [--timeout-ms 2000]
//
// Prints one JSON line: {endpoint, decision, class, status, ms, reason, url_host}.
//   decision ok            200 and the model id is listed
//   decision unreachable   no answer in time, refused, other non-200, or 200 without the model id
//                          (class endpoint_unreachable)
//   decision busy          503 or 429 (class endpoint_busy)
//   decision inconclusive  401/403: the probe cannot tell, the worker run classifies auth itself
//   decision skipped       TLS endpoints (hosted vendors, /models not part of their contract),
//                          or an endpoint the resolver does not call ready
// Exit 0 always when it printed a line; 2 on a usage error.
//
// The base is resolved like the other adapters: a trailing /v1 is kept, otherwise /v1 is added,
// then /models.

const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function modelsUrl(base) {
  const clean = String(base).replace(/\/+$/, '');
  return clean.endsWith('/v1') ? `${clean}/models` : `${clean}/v1/models`;
}

function listedModels(body) {
  let doc;
  try { doc = JSON.parse(body); } catch { return null; }
  const rows = doc && Array.isArray(doc.data) ? doc.data : (doc && Array.isArray(doc.models) ? doc.models : null);
  if (!rows) return null;
  const ids = [];
  for (const row of rows) {
    if (typeof row === 'string') ids.push(row);
    else if (row && typeof row === 'object') {
      for (const k of ['id', 'name', 'model']) if (typeof row[k] === 'string') ids.push(row[k]);
    }
  }
  return ids;
}

function done(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

const endpoint = arg('endpoint');
const model = arg('model');
const budget = Number(arg('timeout-ms') || 2000);
if (!endpoint || !model || !Number.isFinite(budget) || budget <= 0) {
  process.stderr.write('endpoint-probe: --endpoint and --model are required\n');
  process.exit(2);
}
const base = { endpoint, decision: 'skipped', class: '', status: null, ms: 0, reason: '', url_host: '' };

let resolved;
try {
  resolved = JSON.parse(execFileSync(path.join(__dirname, '..', 'resolve-endpoint.sh'), [endpoint], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
} catch (_error) {
  done({ ...base, reason: 'endpoint not ready (resolver)' });
}
if (!resolved || resolved.ready !== true || !resolved.base_url) done({ ...base, reason: 'endpoint not ready (resolver)' });
if (resolved.transport_security === 'tls') done({ ...base, reason: 'tls endpoint: probe skipped' });

const url = new URL(modelsUrl(resolved.base_url));
const token = resolved.token_env ? (process.env[resolved.token_env] || '') : '';
const started = Date.now();
const result = (decision, cls, status, reason) => ({
  ...base, decision, class: cls, status, ms: Date.now() - started, reason, url_host: url.host,
});

const lib = url.protocol === 'https:' ? https : http;
const headers = { accept: 'application/json' };
if (token) { headers.authorization = `Bearer ${token}`; headers['x-api-key'] = token; }
const req = lib.request(url, { method: 'GET', headers }, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('error', (e) => done(result('unreachable', 'endpoint_unreachable', res.statusCode, `read error: ${e.code || e.message}`)));
  res.on('end', () => {
    const code = res.statusCode;
    if (code === 503 || code === 429) {
      const retry = res.headers['retry-after'];
      done(result('busy', 'endpoint_busy', code, `HTTP ${code}${retry ? ` retry-after ${retry}` : ''}`));
    }
    if (code === 401 || code === 403) done(result('inconclusive', '', code, `HTTP ${code}: probe cannot tell`));
    if (code !== 200) done(result('unreachable', 'endpoint_unreachable', code, `HTTP ${code} from /models`));
    const ids = listedModels(Buffer.concat(chunks).toString('utf8'));
    if (ids === null) done(result('unreachable', 'endpoint_unreachable', code, '200 but /models is not a model list'));
    if (!ids.includes(model)) done(result('unreachable', 'endpoint_unreachable', code, `model ${model} is not in the /models list`));
    done(result('ok', '', code, ''));
  });
});
req.on('error', (e) => done(result('unreachable', 'endpoint_unreachable', null, `${e.code || e.message}`)));
setTimeout(() => {
  req.destroy();
  done(result('unreachable', 'endpoint_unreachable', null, `no answer within ${budget} ms`));
}, budget).unref();
req.end();
