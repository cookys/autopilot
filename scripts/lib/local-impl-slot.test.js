'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { decide, contextBytes } = require('./local-impl-slot');

function fixtureDecision(endpoints) {
  const env = readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: `printf '%s\\n' '${JSON.stringify({ endpoints })}'` });
  return require('./local-impl-slot').acquireLocalSlot({ env, cfg: {} });
}

test('gateway selection prefers free qwen over GLM', async () => {
  const d = await fixtureDecision([{ id: 'qwen-a', state: 'up', free: 1 }, { id: 'glm-a', models: ['GLM-4'], state: 'up', free: 2 }]);
  assert.equal(d.family, 'qwen');
  assert.equal(d.endpoint, 'qwen_local');
});

test('gateway selection falls back to GLM when qwen is full', async () => {
  const d = await fixtureDecision([{ id: 'qwen-a', state: 'up', free: 0 }, { id: 'glm-a', models: ['GLM-4'], state: 'up', free: 2 }]);
  assert.equal(d.family, 'glm');
  assert.equal(d.endpoint, 'glm_local');
  assert.deepEqual(d.local_fallback_from, { family: 'qwen', reason: 'no_free_slot' });
});

test('gateway selection keeps no_free_slot when both families are full', async () => {
  const d = await fixtureDecision([{ id: 'qwen-a', state: 'up', free: 0 }, { id: 'glm-a', models: ['GLM-4'], state: 'up', free: 0 }]);
  assert.equal(d.fallback.reason, 'no_free_slot');
});

test('gateway selection accepts a free GLM endpoint when qwen is absent', async () => {
  const d = await fixtureDecision([{ id: 'glm-a', models: ['GLM-4'], state: 'up', free: 1 }]);
  assert.equal(d.family, 'glm');
  assert.equal(d.endpoint, 'glm_local');
});

test('decision reserves the GLM backend and preserves fallback provenance', async () => {
  const { srv, requests } = await leaseServer();
  try {
    const env = leaseEnv(srv.address().port, { AUTOPILOT_ENDPOINT_GLM_LOCAL_URL: `http://127.0.0.1:${srv.address().port}/v1`, AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN: 'fake-test-token', AUTOPILOT_LOCAL_SLOTS_CMD: `printf '%s\\n' '${JSON.stringify({ endpoints: [{ id: 'qwen-a', state: 'up', free: 0 }, { id: 'glm-a', models: ['GLM-4'], state: 'up', free: 1 }] })}'` });
    const d = await decide({ env, promptFile: '', cwd: os.tmpdir() });
    assert.equal(d.choose, true);
    assert.equal(d.family, 'glm');
    assert.equal(d.endpoint, 'glm_local');
    assert.deepEqual(d.local_fallback_from, { family: 'qwen', reason: 'no_free_slot' });
    assert.equal(JSON.parse(requests[0].body).model, 'glm');
    assert.equal(JSON.parse(requests[0].body).backend, 'glm-a');
  } finally { srv.close(); }
});

function readyEnv(extra = {}) {
  const env = {
    ...process.env,
    AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'http://127.0.0.1:9/v1',
    AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN: 'fake-test-token',
    AUTOPILOT_CONFIG_FILE: path.join(os.tmpdir(), 'local-impl-slot-missing-config.json'),
  };
  delete env.AUTOPILOT_LOCAL_SLOTS_CMD;
  delete env.AUTOPILOT_LOCAL_SLOTS_URL;
  return { ...env, ...extra };
}

test('scope header stops at the next pipe and counts absolute and dotdot names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-scope-'));
  const big = path.join(dir, 'big.bin');
  const dotted = path.join(dir, 'big..bin');
  const outside = path.join(dir, 'outside.bin');
  fs.writeFileSync(big, 'x'.repeat(50));
  fs.writeFileSync(dotted, 'y'.repeat(40));
  fs.writeFileSync(outside, 'z'.repeat(30));
  const prompt = path.join(dir, 'prompt.txt');
  fs.writeFileSync(prompt, `Scope: big.bin | Size: M\nScope: ${outside}, big..bin\n`);
  const n = contextBytes(prompt, dir);
  const promptBytes = fs.statSync(prompt).size;
  assert.equal(n, promptBytes + 50 + 40 + 30);
});

function leaseServer(status = 201, body = '{"lease_id":"lease-test"}') {
  const requests = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, requests })));
}

function leaseEnv(port, extra = {}) {
  return readyEnv({ AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: `http://127.0.0.1:${port}/v1`, AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN: 'fake-test-token', ...extra });
}

test('lease grant 201 chooses local and validates lease id without exposing token', async () => {
  const { srv, requests } = await leaseServer();
  try {
    const result = await decide({ env: leaseEnv(srv.address().port), promptFile: '', cwd: os.tmpdir() });
    assert.equal(result.choose, true);
    assert.equal(result.local_lease.id, 'lease-test');
    assert.equal(result.local_lease.granted, true);
    assert.equal(result.local_lease.status, 201);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/v1/local/lease');
    assert.equal(requests[0].auth, 'Bearer fake-test-token');
    assert.equal(JSON.stringify(result).includes('fake-test-token'), false);
  } finally { srv.close(); }
});

test('lease capacity statuses fall back with stable detail', async () => {
  for (const [status, detail] of [[429, 'lease_429'], [409, 'lease_409']]) {
    const { srv } = await leaseServer(status, '{}');
    try {
      const result = await decide({ env: leaseEnv(srv.address().port), promptFile: '', cwd: os.tmpdir() });
      assert.equal(result.choose, false);
      assert.equal(result.reason, 'no_free_slot');
      assert.equal(result.detail, detail);
      assert.equal(result.local_lease.status, status);
    } finally { srv.close(); }
  }
});

test('malformed lease response fails closed', async () => {
  const { srv } = await leaseServer(201, '{"other":"value"}');
  try {
    const result = await decide({ env: leaseEnv(srv.address().port), promptFile: '', cwd: os.tmpdir() });
    assert.equal(result.choose, false);
    assert.equal(result.detail, 'lease_query_failed:malformed');
  } finally { srv.close(); }
});

test('gateway down returns quickly without blocking', async () => {
  const started = Date.now();
  const result = await decide({ env: leaseEnv(1), promptFile: '', cwd: os.tmpdir() });
  assert.equal(result.choose, false);
  assert.match(result.detail, /^lease_query_failed:/);
  assert.ok(Date.now() - started < 5000);
});
