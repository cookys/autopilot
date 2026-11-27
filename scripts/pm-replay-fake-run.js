#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startReplayProxy } = require('./lib/replay-api-proxy.js');
const { createRealModelRunner, probeBaseUrlDecision } = require('./lib/replay-model-runner.js');
const { runReplay, parseArgs } = require('./pm-replay-run.js');

const SECRET = 'dummy-replay-auth-do-not-use';

function parse(argv) {
  let log = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--log') log = argv[++i];
  }
  return { log };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function onceBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

async function main() {
  const args = parse(process.argv.slice(2));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-fake-home-'));
  const authFile = path.join(root, 'auth');
  fs.writeFileSync(authFile, `${SECRET}\n`, { mode: 0o600 });
  let hits = 0;
  let sawAuth = false;
  const upstream = http.createServer(async (req, res) => {
    hits += 1;
    sawAuth = req.headers['x-api-key'] === SECRET;
    await onceBody(req);
    const body = JSON.stringify({
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'fake-ok' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 },
    });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  const port = await listen(upstream);
  const socketPath = path.join(root, 'proxy.sock');
  const auditPath = path.join(root, 'audit.jsonl');
  const proxy = await startReplayProxy({
    socketPath,
    upstream: `http://127.0.0.1:${port}`,
    authFile,
    totalCap: 80_000_000,
    perArmCap: 80_000_000,
    eventMax: 1000,
    auditPath,
  });
  const manifest = {
    pool_whitelist: ['pool-fake'],
    total_cap: 80_000_000,
    per_arm_cap: 80_000_000,
    event_max: 1000,
    model: 'replay-fake',
    treatments: ['baseline', 'S2'],
    prefill_prefix: [{ role: 'user', content: 'prefill' }],
    events: [{ id: 'ev-1', prompt: 'hello from fake' }],
  };
  const decision = probeBaseUrlDecision();
  const runner = createRealModelRunner({
    manifest,
    proxySocket: socketPath,
    setArm: (arm) => proxy.setArm(arm),
    captureSandboxVisible: true,
  });
  const out = await runReplay({
    manifest,
    arm: 'baseline',
    poolId: 'pool-fake',
    modelRunner: runner,
  });
  const segment = out.results[0];
  const audit = fs.readFileSync(auditPath, 'utf8');

  const capSocket = path.join(root, 'cap.sock');
  const capAudit = path.join(root, 'cap-audit.jsonl');
  const hitsBeforeCap = hits;
  const capProxy = await startReplayProxy({
    socketPath: capSocket,
    upstream: `http://127.0.0.1:${port}`,
    authFile,
    totalCap: 30,
    perArmCap: 30,
    eventMax: 40,
    auditPath: capAudit,
  });
  const capStatus = await new Promise((resolve) => {
    const req = http.request({ socketPath: capSocket, path: '/v1/messages', method: 'POST' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.end('{}');
  });
  await capProxy.close();

  const otherStatus = await new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/v1/models', method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.end();
  });

  const refuse = parseArgs(['--real']);
  const sandboxBlob = segment && segment.sandboxVisible ? segment.sandboxVisible : '';
  delete segment.sandboxVisible;
  const report = {
    decision,
    executedCount: out.executedCount,
    output: segment && segment.output,
    httpStatus: segment && segment.httpStatus,
    usage: segment && segment.usage,
    capStatus,
    capForwarded: hits - hitsBeforeCap,
    otherStatus,
    authInAudit: audit.includes(SECRET) || fs.readFileSync(capAudit, 'utf8').includes(SECRET),
    authInSandbox: sandboxBlob.includes(SECRET),
    authForwarded: sawAuth,
    realWithoutPool: Boolean(refuse.real && !refuse.poolId),
    calls: proxy.report().calls,
  };
  await proxy.close();
  upstream.close();
  const text = JSON.stringify(report, null, 2);
  if (args.log) fs.writeFileSync(args.log, text);
  console.log(text);
  const ok = report.output === 'fake-ok'
    && report.httpStatus === 200
    && report.usage.input === 10
    && report.capStatus === 429
    && report.capForwarded === 0
    && report.otherStatus === 403
    && report.authInAudit === false
    && report.authInSandbox === false
    && report.authForwarded === true
    && report.realWithoutPool === true
    && decision.anthropicBaseUrlStripped === true;
  fs.rmSync(root, { recursive: true, force: true });
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
