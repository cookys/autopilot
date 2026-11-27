'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startReplayProxy } = require('./replay-api-proxy.js');
const { createRealModelRunner } = require('./replay-model-runner.js');

const secret = 'dummy-proxy-test-credential';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-proxy-test-'));
const authFile = path.join(root, 'auth');
fs.writeFileSync(authFile, secret, { mode: 0o600 });
let hits = 0;
let receivedAuth;
const upstream = http.createServer((req, res) => {
  hits++;
  receivedAuth = req.headers['x-api-key'];
  req.resume();
  req.on('end', () => res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 3, output_tokens: 2 } })));
});
function request(socketPath, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: requestPath, method: 'POST' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end('{}');
  });
}
async function main() {
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const auditPath = path.join(root, 'audit');
  const proxy = await startReplayProxy({ socketPath: path.join(root, 'proxy.sock'), upstream: base, authFile, auditPath, totalCap: 100, perArmCap: 100, eventMax: 10 });
  const capped = await startReplayProxy({ socketPath: path.join(root, 'cap.sock'), upstream: base, authFile, totalCap: 9, perArmCap: 100, eventMax: 10 });
  try {
    assert.equal(await request(capped.socketPath, '/v1/messages'), 429);
    assert.equal(hits, 0);
    console.log('PASS: cap refuses before forwarding');
    assert.equal(await request(proxy.socketPath, '/v1/models'), 403);
    assert.equal(hits, 0);
    console.log('PASS: non-model path is forbidden');
    const manifest = { pool_whitelist: ['test-pool'], model: 'fake' };
    const runner = createRealModelRunner({ manifest, proxySocket: proxy.socketPath, captureSandboxVisible: true });
    const result = await runner.run({ arm: 'test', event: { id: 'one', prompt: 'hello' }, contextMessages: [], poolId: 'test-pool' });
    assert.equal(result.httpStatus, 200);
    assert.equal(receivedAuth, secret);
    assert.equal(hits, 1);
    console.log('PASS: auth is forwarded upstream');
    assert.ok(!fs.readFileSync(auditPath, 'utf8').includes(secret));
    assert.ok(!result.sandboxVisible.includes(secret));
    console.log('PASS: auth absent from audit and sandbox output');
    console.log('\n4 tests passed.');
  } finally {
    await capped.close();
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
