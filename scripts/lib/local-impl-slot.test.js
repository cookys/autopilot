'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { decide, contextBytes } = require('./local-impl-slot');

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

test('slot JSON must carry an integer free and a boolean draining', async () => {
  const env = readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":1}\'' });
  const missing = await decide({ env, promptFile: '', cwd: os.tmpdir() });
  assert.equal(missing.choose, false);
  assert.equal(missing.reason, 'no_free_slot');
  assert.equal(missing.detail, 'slot_query_failed:malformed');
  const typed = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":1,"draining":"true"}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(typed.detail, 'slot_query_failed:malformed');
  assert.equal(typed.reason, 'no_free_slot');
});

test('a failing slot command falls back to cloud', async () => {
  const failed = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'echo nope; exit 1' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(failed.reason, 'no_free_slot');
  assert.equal(failed.detail, 'slot_query_failed:unreachable');
  assert.equal(failed.choose, false);
  assert.equal(failed.local_slots.source, 'cmd');
});

test('an empty AUTOPILOT_LOCAL_SLOTS_CMD selects the probe, not config.local_slots_cmd', async () => {
  const cfg = path.join(os.tmpdir(), `slot-cfg-${process.pid}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ local_slots_cmd: 'printf %s \'{"free":0,"draining":false}\'' }));
  const decided = await decide({
    env: readyEnv({
      AUTOPILOT_CONFIG_FILE: cfg,
      AUTOPILOT_LOCAL_SLOTS_CMD: '',
      AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'http://127.0.0.1:9/v1',
    }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(decided.reason, 'no_free_slot');
  assert.equal(decided.detail, 'slot_query_failed:unreachable');
  assert.equal(decided.local_slots.source, 'gateway');
  fs.unlinkSync(cfg);
});

test('a slot command that ignores SIGTERM still dies inside the deadline', { timeout: 8000 }, async () => {
  const started = Date.now();
  const decided = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: "trap '' TERM; sleep 30" }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  const elapsed = Date.now() - started;
  assert.equal(decided.reason, 'no_free_slot');
  assert.equal(decided.detail, 'slot_query_failed:timeout');
  assert.ok(elapsed < 7000, `elapsed ${elapsed}`);
});

test('free 0 and draining true stay capacity fallbacks', async () => {
  const free0 = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":0,"draining":false}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(free0.reason, 'no_free_slot');
  assert.equal(free0.detail, 'all_full');
  assert.equal(free0.local_slots.source, 'cmd');
  const draining = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: 'printf %s \'{"free":2,"draining":true}\'' }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(draining.reason, 'draining');
});

function serve(status, body, delayMs) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (delayMs) {
        setTimeout(() => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(body);
        }, delayMs);
        return;
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function envAt(srv, extra = {}) {
  const port = srv.address().port;
  return readyEnv({
    AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: `http://127.0.0.1:${port}/v1`,
    ...extra,
  });
}

test('one up backend with free_for_caller 2 chooses local', async () => {
  const body = JSON.stringify({
    models: [{ alias: 'qwen' }],
    endpoints: [{
      id: 'gpu-a', state: 'up', cap: { effective: 2 }, in_flight: 0, queued: 0,
      free: 2, free_for_caller: 2, models: { qwen: {} },
    }],
  });
  const srv = await serve(200, body);
  try {
    const decided = await decide({ env: envAt(srv), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.choose, true);
    assert.equal(decided.local_slots.backend, 'gpu-a');
    assert.equal(decided.local_slots.free, 2);
    assert.equal(decided.local_slots.source, 'gateway');
  } finally { srv.close(); }
});

test('all up backends full fall back all_full', async () => {
  const body = JSON.stringify({
    endpoints: [
      { id: 'gpu-a', state: 'up', free_for_caller: 0, models: { qwen: {} } },
      { id: 'gpu-b', state: 'up', free_for_caller: 0, models: { qwen: {} } },
    ],
  });
  const srv = await serve(200, body);
  try {
    const decided = await decide({ env: envAt(srv), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.choose, false);
    assert.equal(decided.reason, 'no_free_slot');
    assert.equal(decided.detail, 'all_full');
  } finally { srv.close(); }
});

test('a slow slots server falls back within 3s', async () => {
  const srv = await serve(200, '{"endpoints":[]}', 5000);
  try {
    const started = Date.now();
    const decided = await decide({ env: envAt(srv), promptFile: '', cwd: os.tmpdir() });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `elapsed ${elapsed}`);
    assert.equal(decided.reason, 'no_free_slot');
    assert.equal(decided.detail, 'slot_query_failed:timeout');
    assert.equal(decided.local_slots.source, 'gateway');
  } finally { srv.close(); }
});

test('malformed body and HTTP 500 are slot query failures', async () => {
  const bad = await serve(200, 'not-json');
  try {
    const decided = await decide({ env: envAt(bad), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.detail, 'slot_query_failed:malformed');
  } finally { bad.close(); }
  const err = await serve(500, '{"endpoints":[]}');
  try {
    const decided = await decide({ env: envAt(err), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.detail, 'slot_query_failed:http_500');
    assert.equal(decided.reason, 'no_free_slot');
  } finally { err.close(); }
});

test('only draining backends fall back draining', async () => {
  const body = JSON.stringify({
    endpoints: [{ id: 'gpu-a', state: 'draining', free_for_caller: 2, models: { qwen: {} } }],
  });
  const srv = await serve(200, body);
  try {
    const decided = await decide({ env: envAt(srv), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.reason, 'draining');
    assert.equal(decided.choose, false);
  } finally { srv.close(); }
});

test('a non-integer free_for_caller is not eligible or replaced by free', async () => {
  const body = JSON.stringify({
    endpoints: [
      { id: 'gpu-a', state: 'up', free_for_caller: '2', models: { qwen: {} } },
      { id: 'gpu-b', state: 'up', free_for_caller: null, free: 2, models: { qwen: {} } },
    ],
  });
  const srv = await serve(200, body);
  try {
    const decided = await decide({ env: envAt(srv), promptFile: '', cwd: os.tmpdir() });
    assert.equal(decided.detail, 'slot_query_failed:no_backend');
  } finally { srv.close(); }
});

test('an explicitly empty slots URL disables the gateway query', async () => {
  const body = JSON.stringify({
    endpoints: [{ id: 'gpu-a', state: 'up', free_for_caller: 1, models: { qwen: {} } }],
  });
  const srv = await serve(200, body);
  try {
    const decided = await decide({
      env: envAt(srv, { AUTOPILOT_LOCAL_SLOTS_URL: '' }), promptFile: '', cwd: os.tmpdir(),
    });
    assert.equal(decided.choose, false);
    assert.equal(decided.detail, 'slot_query_failed:unreachable');
  } finally { srv.close(); }
});

test('local_slots_cmd may print the gateway JSON', async () => {
  const payload = JSON.stringify({
    endpoints: [{ id: 'gpu-cmd', state: 'up', free_for_caller: 1, models: { qwen: {} } }],
  });
  const decided = await decide({
    env: readyEnv({ AUTOPILOT_LOCAL_SLOTS_CMD: `printf %s '${payload}'` }),
    promptFile: '',
    cwd: os.tmpdir(),
  });
  assert.equal(decided.choose, true);
  assert.equal(decided.local_slots.source, 'cmd');
  assert.equal(decided.local_slots.backend, 'gpu-cmd');
});
