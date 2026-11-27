'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { createBudget } = require('./replay-budget.js');

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
const DEFAULT_TOTAL_CAP = 80_000_000;

function isModelMessagesPath(urlPath) {
  const p = String(urlPath || '').split('?')[0];
  return p === '/v1/messages' || p === '/v1/messages/';
}

function emptyUsage() {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

function usageFromBody(text) {
  const usage = emptyUsage();
  if (!text) return usage;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/"usage"\s*:\s*\{[^}]*\}/);
    if (!match) return usage;
    try {
      parsed = { usage: JSON.parse(match[0].slice(match[0].indexOf('{'))) };
    } catch {
      return usage;
    }
  }
  const u = parsed && parsed.usage;
  if (!u || typeof u !== 'object') return usage;
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  usage.input = num(u.input_tokens ?? u.input);
  usage.output = num(u.output_tokens ?? u.output);
  usage.cache_read = num(u.cache_read_input_tokens ?? u.cache_read);
  usage.cache_write = num(u.cache_creation_input_tokens ?? u.cache_write);
  return usage;
}

function usageTokens(usage) {
  return usage.input + usage.output + usage.cache_read + usage.cache_write;
}

function readAuthToken(authFile) {
  const token = fs.readFileSync(authFile, 'utf8').trim();
  if (!token) throw new Error('auth file is empty');
  return token;
}

/**
 * Unix-socket HTTP proxy. Reads the credential itself; never logs or returns it.
 * Forwards only POST/GET /v1/messages. Reserves eventMax tokens before forwarding.
 */
function startReplayProxy(opts = {}) {
  const socketPath = opts.socketPath || process.env.REPLAY_PROXY_SOCKET;
  if (!socketPath) throw new Error('socketPath is required');
  const upstream = new URL(opts.upstream || process.env.REPLAY_PROXY_UPSTREAM || DEFAULT_UPSTREAM);
  const authFile = opts.authFile || process.env.REPLAY_PROXY_AUTH_FILE;
  if (!authFile) throw new Error('auth file is required');
  const authToken = readAuthToken(authFile);
  const totalCap = Number(opts.totalCap ?? opts.manifest?.total_cap ?? DEFAULT_TOTAL_CAP);
  const perArmCap = Number(opts.perArmCap ?? opts.manifest?.per_arm_cap ?? totalCap);
  const eventMax = Number(opts.eventMax ?? opts.manifest?.event_max ?? 200_000);
  if (![totalCap, perArmCap, eventMax].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('caps must be finite and nonnegative');
  }
  const auditPath = opts.auditPath || null;
  let arm = opts.arm || 'default';
  const armSpent = new Map();
  let calls = 0;
  let openReservation = null;
  // Shared accumulator: total_limit is the manifest cap. estimate defaults to the
  // same cap so settle halts once spent exceeds the cap (also the 1.5× estimate rule).
  const budget = opts.budget || createBudget({
    total_limit: totalCap,
    estimate: Number(opts.estimate ?? totalCap),
  });

  function report() {
    const snap = budget.report();
    return {
      calls,
      halted: snap.halted,
      spent: snap.spent,
      reserved: snap.reserved,
      totalCap,
      perArmCap,
      eventMax,
      arm,
      arms: Object.fromEntries(armSpent),
    };
  }

  function audit(status, usage, forwarded, requestPath) {
    if (!auditPath) return;
    let line = JSON.stringify({
      path: requestPath || '/v1/messages',
      status,
      forwarded: Boolean(forwarded),
      usage,
    });
    if (authToken && line.includes(authToken)) line = line.split(authToken).join('[redacted]');
    fs.appendFileSync(auditPath, `${line}\n`, { mode: 0o600 });
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
  }

  function reserve(forArm) {
    if (report().halted || openReservation) return { ok: false, reason: 'halted' };
    const armUsed = armSpent.get(forArm) || 0;
    if (armUsed + eventMax > perArmCap) return { ok: false, reason: 'arm_cap' };
    const token = budget.reserve(eventMax);
    if (!token) return { ok: false, reason: 'total_cap' };
    openReservation = { arm: forArm, token };
    return { ok: true };
  }

  function settle(usage) {
    if (!openReservation) return;
    const tokens = usageTokens(usage);
    budget.settle(openReservation.token, tokens);
    armSpent.set(openReservation.arm, (armSpent.get(openReservation.arm) || 0) + tokens);
    openReservation = null;
    calls += 1;
  }

  const server = http.createServer((req, res) => {
    const requestPath = String(req.url || '').split('?')[0];
    if (!isModelMessagesPath(req.url)) {
      audit(403, emptyUsage(), false, requestPath);
      sendJson(res, 403, { error: { type: 'forbidden', message: 'path_not_allowed' } });
      return;
    }
    const heldArm = arm;
    const gate = reserve(heldArm);
    if (!gate.ok) {
      audit(429, emptyUsage(), false, '/v1/messages');
      sendJson(res, 429, { error: { type: 'replay_budget', message: gate.reason } });
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const headers = {
        'content-type': req.headers['content-type'] || 'application/json',
        'content-length': body.length,
        'x-api-key': authToken,
        'anthropic-version': '2023-06-01',
      };
      const lib = upstream.protocol === 'https:' ? https : http;
      const ureq = lib.request(
        {
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
          method: req.method || 'POST',
          path: `${upstream.pathname.replace(/\/$/, '')}${req.url}`,
          headers,
        },
        (ures) => {
          const parts = [];
          ures.on('data', (c) => parts.push(c));
          ures.on('end', () => {
            const raw = Buffer.concat(parts);
            const usage = usageFromBody(raw.toString('utf8'));
            const status = ures.statusCode || 502;
            settle(usage);
            audit(status, usage, true, '/v1/messages');
            res.writeHead(status, {
              'content-type': ures.headers['content-type'] || 'application/json',
              'content-length': raw.length,
              connection: 'close',
            });
            res.end(raw);
          });
        }
      );
      ureq.on('error', () => {
        settle(emptyUsage());
        audit(502, emptyUsage(), true, '/v1/messages');
        sendJson(res, 502, { error: { type: 'upstream', message: 'upstream_error' } });
      });
      ureq.end(body);
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    server.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch { /* socket mode is best-effort */ }
      resolve({
        socketPath,
        server,
        report,
        setArm(next) { arm = String(next || 'default'); },
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = {
  DEFAULT_UPSTREAM,
  DEFAULT_TOTAL_CAP,
  isModelMessagesPath,
  usageFromBody,
  startReplayProxy,
};
