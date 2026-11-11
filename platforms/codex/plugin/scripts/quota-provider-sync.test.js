'use strict';
// G40 provider quota adapters (scripts/quota-provider-sync.js). Fixtures and an injected fake fetch only: no network,
// no real token. Run: node --test scripts/quota-provider-sync.test.js
// Fixture assumptions (match the header of the adapter): minimax remaining_percent is 0..100; glm percentage is 0..100 used.
// Negative controls: every `planted` test loads a MUTATED copy of the adapter and must go red where the real one is green.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, 'quota-provider-sync.js');
const real = require('./quota-provider-sync');
const observation = require('./lib/account-observation');

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const FAKE_TOKEN = 'FAKE-token-for-tests';

function mutant(pairs) {
  let src = fs.readFileSync(SRC, 'utf8');
  for (const [from, to] of pairs) {
    assert.strictEqual(src.split(from).length - 1, 1, `plant anchor must match exactly once: ${from}`);
    src = src.replace(from, () => to);
  }
  const m = new Module(SRC, module);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(__dirname);
  m._compile(src, SRC);
  return m.exports;
}

function tmpLive() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qps-'));
  fs.chmodSync(d, 0o700);
  return d;
}
function readRow(liveDir, provider, alias) {
  const r = observation.readView(liveDir, provider, alias);
  return r && r.view ? r.view.rows[0].record : null;
}
function fakeFetch(status, body, seen) {
  return async (url, init) => {
    if (seen) { seen.url = url; seen.init = init; }
    return { status, json: async () => { if (body === 'BADJSON') throw new Error('x'); return body; } };
  };
}
const mm = (over) => ({ model_name: 'M', current_interval_remaining_percent: 80, end_time: NOW_S + 3600,
  current_weekly_remaining_percent: 50, weekly_end_time: NOW_S + 86400, usage_count: 0, total_count: 0, ...over });
const glm = (limits) => ({ data: { limits } });
const g5 = (pct, t) => ({ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: pct, nextResetTime: t === undefined ? (NOW_S + 3600) * 1000 : t });
const gw = (pct) => ({ type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: pct, nextResetTime: (NOW_S + 86400) * 1000 });

async function run(mod, provider, body, status, extra) {
  const liveDir = tmpLive();
  const seen = {};
  const env = provider === 'glm' ? { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN } : { MINIMAX_API_KEY: FAKE_TOKEN };
  const r = await mod.syncProvider(provider, { liveDir, env, fetch: fakeFetch(status === undefined ? 200 : status, body, seen), nowMs: () => NOW, ...(extra || {}) });
  return { r, liveDir, seen };
}

test('minimax: normal body writes 2 windows, used = 1 - remaining/100, source probe, ms end_time handled', async () => {
  const { r, liveDir, seen } = await run(real, 'minimax', { model_remains: [mm({ end_time: (NOW_S + 3600) * 1000 })] });
  assert.deepStrictEqual([r.wrote, r.reason], [true, null]);
  assert.deepStrictEqual(r.shape, { models: 1, dropped: { rolling_5h: null, weekly: null } });
  const rec = readRow(liveDir, 'minimax', 'minimax');
  assert.strictEqual(rec.token_state, 'ok');
  assert.strictEqual(Number.isInteger(rec.token_state_at), true);
  assert.strictEqual(rec.token_state_at, NOW_S);
  assert.strictEqual('shape' in rec, false);
  const w5 = rec.windows.find((w) => w.kind === 'rolling_5h');
  const wk = rec.windows.find((w) => w.kind === 'weekly');
  assert.ok(Math.abs(w5.utilization - 0.2) < 1e-9);
  assert.ok(Math.abs(wk.utilization - 0.5) < 1e-9);
  assert.strictEqual(w5.resets_at, NOW_S + 3600);
  assert.strictEqual(w5.source, 'probe');
  assert.strictEqual(w5.observed_at, NOW_S);
  assert.strictEqual(seen.url, 'https://www.minimax.io/v1/token_plan/remains');
  assert.strictEqual(seen.init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.ok(seen.init.signal, 'a timeout signal is passed');
});
test('minimax: the namespace token wins over MINIMAX_API_KEY; custom alias is the mirror key', async () => {
  const liveDir = tmpLive(); const seen = {};
  const r = await real.syncProvider('minimax', { alias: 'mm2', liveDir, nowMs: () => NOW, fetch: fakeFetch(200, { model_remains: [mm()] }, seen),
    env: { AUTOPILOT_ENDPOINT_MINIMAX_TOKEN: 'FAKE-ns', MINIMAX_API_KEY: 'FAKE-native' } });
  assert.strictEqual(r.wrote, true);
  assert.strictEqual(seen.init.headers.Authorization, 'Bearer FAKE-ns');
  assert.ok(readRow(liveDir, 'minimax', 'mm2'));
});
test('minimax: several models, the tightest per window wins and is named in the result', async () => {
  const { r, liveDir } = await run(real, 'minimax', { model_remains: [mm({ model_name: 'A', current_interval_remaining_percent: 90 }), mm({ model_name: 'B', current_interval_remaining_percent: 10, current_weekly_remaining_percent: 70 })] });
  assert.strictEqual(r.tightest.rolling_5h, 'B');
  assert.strictEqual(r.tightest.weekly, 'A');
  const rec = readRow(liveDir, 'minimax', 'minimax');
  assert.ok(Math.abs(rec.windows.find((w) => w.kind === 'rolling_5h').utilization - 0.9) < 1e-9);
});
test('minimax: remaining slightly below 0 clamps to 1 with clamped; far out of range is rejected', async () => {
  const a = await run(real, 'minimax', { model_remains: [mm({ current_interval_remaining_percent: -5 })] });
  assert.strictEqual(a.r.wrote, true);
  const w = readRow(a.liveDir, 'minimax', 'minimax').windows.find((x) => x.kind === 'rolling_5h');
  assert.deepStrictEqual([w.utilization, w.clamped], [1, true]);
  for (const bad of [-60, 150]) {
    const b = await run(real, 'minimax', { model_remains: [mm({ current_interval_remaining_percent: bad })] });
    assert.deepStrictEqual([b.r.wrote, b.r.reason], [false, 'quota_invalid']);
    assert.strictEqual(readRow(b.liveDir, 'minimax', 'minimax'), null);
  }
});
test('minimax: a 0..1 fraction misread as percent still stays inside the clamp (remaining 0.3 -> used 0.997)', async () => {
  const { r } = await run(real, 'minimax', { model_remains: [mm({ current_interval_remaining_percent: 0.3 })] });
  assert.strictEqual(r.wrote, true);
});
test('minimax: missing fields, expired windows, non-2xx, bad JSON write nothing and give a code', async () => {
  const cases = [
    [{ model_remains: [{ usage_count: 0 }] }, 200, 'fields_missing'],
    [{ other: 1 }, 200, 'fields_missing'],
    [{ model_remains: [mm({ end_time: NOW_S - 10, weekly_end_time: NOW_S - 10 })] }, 200, 'quota_windows_expired'],
    [{ model_remains: [mm()] }, 500, 'http_status'],
    ['BADJSON', 200, 'json_invalid'],
  ];
  for (const [body, status, reason] of cases) {
    const { r, liveDir } = await run(real, 'minimax', body, status);
    assert.deepStrictEqual([r.wrote, r.reason], [false, reason], reason);
    assert.strictEqual(readRow(liveDir, 'minimax', 'minimax'), null);
  }
});
test('minimax: an expired weekly keeps the live 5 h window only', async () => {
  const { r, liveDir } = await run(real, 'minimax', { model_remains: [mm({ weekly_end_time: NOW_S - 1 })] });
  assert.strictEqual(r.wrote, true);
  assert.deepStrictEqual(r.shape, { models: 1, dropped: { rolling_5h: null, weekly: 'expired' } });
  assert.deepStrictEqual(readRow(liveDir, 'minimax', 'minimax').windows.map((w) => w.kind), ['rolling_5h']);
});

test('glm: normal body maps unit 3/number 5 to rolling_5h and unit 6/number 1 to weekly, bare token header, assumed flagged', async () => {
  const { r, liveDir, seen } = await run(real, 'glm', glm([g5(25), gw(40), { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 99, nextResetTime: 1 }]));
  assert.deepStrictEqual([r.wrote, r.reason, r.assumed], [true, null, true]);
  assert.deepStrictEqual(r.shape, {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, used_window: 'weekly', dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: 'TIME_LIMIT', unit: 5, number: 1, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
    ],
  });
  const rec = readRow(liveDir, 'glm', 'glm');
  assert.strictEqual(rec.token_state, 'ok');
  assert.strictEqual(Number.isInteger(rec.token_state_at), true);
  assert.strictEqual(rec.token_state_at, NOW_S);
  assert.strictEqual('shape' in rec, false);
  assert.strictEqual(rec.windows.length, 2);
  assert.ok(Math.abs(rec.windows.find((w) => w.kind === 'rolling_5h').utilization - 0.25) < 1e-9);
  assert.strictEqual(rec.windows.find((w) => w.kind === 'weekly').resets_at, NOW_S + 86400);
  assert.strictEqual(seen.init.headers.Authorization, FAKE_TOKEN, 'no Bearer for glm');
  assert.strictEqual(seen.url, 'https://api.z.ai/api/monitor/usage/quota/limit');
});
test('success row: token_state is ok and token_state_at is integer epoch seconds (floors sub-second nowMs)', async () => {
  for (const [provider, body] of [['minimax', { model_remains: [mm()] }], ['glm', glm([g5(20)])]]) {
    const { r, liveDir } = await run(real, provider, body, 200, { nowMs: () => NOW + 789 });
    assert.strictEqual(r.wrote, true);
    const rec = readRow(liveDir, provider, provider);
    assert.strictEqual(rec.token_state, 'ok');
    assert.strictEqual(Number.isInteger(rec.token_state_at), true);
    assert.strictEqual(rec.token_state_at, NOW_S);
  }
});
test('glm shape: 5h TOKENS_LIMIT with past nextResetTime marks dropped expired in result.shape and writes only weekly', async () => {
  const { r, liveDir } = await run(real, 'glm', glm([g5(25, (NOW_S - 10) * 1000), gw(40)]));
  assert.strictEqual(r.wrote, true);
  assert.deepStrictEqual(r.shape, {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: 'expired', keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, used_window: 'weekly', dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
    ],
  });
  const rec = readRow(liveDir, 'glm', 'glm');
  assert.deepStrictEqual(rec.windows.map((w) => w.kind), ['weekly']);
  assert.strictEqual(rec.token_state, 'ok');
  assert.strictEqual(rec.token_state_at, NOW_S);
  assert.strictEqual('shape' in rec, false);
});
test('glm shape: response without unit 3/number 5 lists limits with used_window null; fields_missing and scalar rules', async () => {
  const unmappedOnly = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 1, number: 2, percentage: 10, nextResetTime: (NOW_S + 3600) * 1000 },
    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 50, nextResetTime: (NOW_S + 3600) * 1000 },
  ]));
  assert.deepStrictEqual([unmappedOnly.r.wrote, unmappedOnly.r.reason], [false, 'fields_missing']);
  assert.deepStrictEqual(unmappedOnly.r.shape, {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 1, number: 2, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: 'TIME_LIMIT', unit: 5, number: 1, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
    ],
  });

  const weeklyPlusUnmapped = await run(real, 'glm', glm([
    gw(30),
    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 50, nextResetTime: (NOW_S + 3600) * 1000 },
  ]));
  assert.strictEqual(weeklyPlusUnmapped.r.wrote, true);
  assert.deepStrictEqual(weeklyPlusUnmapped.r.shape, {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, used_window: 'weekly', dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: 'TIME_LIMIT', unit: 5, number: 1, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
    ],
  });

  const longType = 'L'.repeat(40);
  const edge = real.convertGlm(glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5 },
    { type: longType, unit: true, number: { nested: 1 } },
  ]), NOW);
  assert.strictEqual(edge.ok, false);
  assert.deepStrictEqual(edge.shape, {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: 'fields_missing', keys: ['number', 'type', 'unit'], missing: ['percentage', 'nextResetTime'], pct_from: null, reset_assumed: false },
      { type: 'L'.repeat(32), unit: null, number: null, used_window: null, dropped: null, keys: ['number', 'type', 'unit'], missing: ['percentage', 'nextResetTime'], pct_from: null, reset_assumed: false },
    ],
  });

  const mmExp = real.convertMinimax({ model_remains: [mm({ end_time: NOW_S - 5, weekly_end_time: NOW_S - 5 }), mm({ end_time: NOW_S - 2, weekly_end_time: NOW_S - 2 })] }, NOW);
  assert.deepStrictEqual([mmExp.ok, mmExp.reason], [false, 'quota_windows_expired']);
  assert.deepStrictEqual(mmExp.shape, { models: 2, dropped: { rolling_5h: 'expired', weekly: 'expired' } });
});
test('minimax: 401 marks the token invalid (empty-window L1 row, token_state_at in seconds, no token in the row); 500 stays http_status with no row', async () => {
  const { r, liveDir } = await run(real, 'minimax', { model_remains: [mm()] }, 401);
  assert.deepStrictEqual([r.wrote, r.reason], [false, 'token_invalid']);
  const rec = readRow(liveDir, 'minimax', 'minimax');
  assert.strictEqual(rec.token_state, 'invalid');
  assert.strictEqual(rec.token_state_at, NOW_S);
  assert.deepStrictEqual(rec.windows, []);
  assert.strictEqual(JSON.stringify(rec).includes(FAKE_TOKEN), false);
  assert.strictEqual(JSON.stringify(r).includes(FAKE_TOKEN), false);
  const five = await run(real, 'minimax', { model_remains: [mm()] }, 500);
  assert.deepStrictEqual([five.r.wrote, five.r.reason], [false, 'http_status']);
  assert.strictEqual(readRow(five.liveDir, 'minimax', 'minimax'), null);
});
test('glm: out-of-range percentage, missing fields, expired, non-2xx, bad JSON write nothing', async () => {
  const cases = [
    [glm([g5(250)]), 200, 'quota_invalid'],
    [glm([g5(-1)]), 200, 'quota_invalid'],
    [glm([{ type: 'TOKENS_LIMIT', unit: 3, number: 5 }]), 200, 'fields_missing'],
    [glm([{ type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 1, nextResetTime: 1 }]), 200, 'fields_missing'],
    [{ data: {} }, 200, 'fields_missing'],
    [glm([g5(10, (NOW_S - 5) * 1000)]), 200, 'quota_windows_expired'],
    [glm([g5(10)]), 503, 'http_status'],
    ['BADJSON', 200, 'json_invalid'],
  ];
  for (const [body, status, reason] of cases) {
    const { r, liveDir } = await run(real, 'glm', body, status);
    assert.deepStrictEqual([r.wrote, r.reason], [false, reason], reason);
    assert.strictEqual(readRow(liveDir, 'glm', 'glm'), null);
  }
});
test('glm: 101% clamps to 1 with clamped', async () => {
  const { r, liveDir } = await run(real, 'glm', glm([g5(101)]));
  assert.strictEqual(r.wrote, true);
  const w = readRow(liveDir, 'glm', 'glm').windows[0];
  assert.deepStrictEqual([w.utilization, w.clamped], [1, true]);
});

test('transport: no token, unknown provider, a throwing fetch and a hung request never throw and never leak the token', async () => {
  const liveDir = tmpLive();
  assert.strictEqual((await real.syncProvider('glm', { liveDir, env: {}, fetch: fakeFetch(200, {}) })).reason, 'token_missing');
  assert.strictEqual((await real.syncProvider('nope', { liveDir, env: {} })).reason, 'provider_unknown');
  assert.strictEqual((await real.syncProvider('toString', { liveDir, env: {} })).reason, 'provider_unknown');
  const boom = async () => { throw new Error(`connect ${FAKE_TOKEN}`); };
  const r = await real.syncProvider('glm', { liveDir, env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN }, fetch: boom });
  assert.strictEqual(r.reason, 'request_failed');
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN));
  assert.strictEqual(real.TIMEOUT_MS, 10000);
});

test('CLI: unknown provider exits 1 with the code and no token on stderr; usage errors exit 2', () => {
  const { spawnSync } = require('child_process');
  const env = { PATH: process.env.PATH, AUTOPILOT_LIVE_DIR: tmpLive(), AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN };
  const a = spawnSync(process.execPath, [SRC, 'sync-provider', '--provider', 'nope'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(a.status, 1);
  assert.match(a.stderr, /provider_unknown/);
  const b = spawnSync(process.execPath, [SRC, 'sync-provider', '--provider', 'glm'], { env: { ...env, AUTOPILOT_ENDPOINT_GLM_TOKEN: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(b.status, 1);
  assert.match(b.stderr, /token_missing/);
  assert.ok(!(a.stdout + a.stderr + b.stdout + b.stderr).includes(FAKE_TOKEN));
  const c = spawnSync(process.execPath, [SRC], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(c.status, 2);
});
test('CLI: main() prints shape on stdout/stderr and shape + stdout/stderr never contain the token', () => {
  const { spawnSync } = require('child_process');
  const stubDir = tmpLive();
  const preload = path.join(stubDir, 'preload-fetch.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    'globalThis.fetch = async () => {',
    '  const mode = process.env.QPS_STUB_MODE;',
    '  const tok = process.env.QPS_STUB_TOK;',
    '  const fut = Date.now() + 3600000;',
    '  if (mode === "glm-ok") {',
    '    return { status: 200, json: async () => ({ secret: tok, data: { limits: [',
    '      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 20, nextResetTime: fut },',
    '      { type: tok, unit: 9, number: 1, percentage: 50, nextResetTime: fut },',
    '    ] } }) };',
    '  }',
    '  if (mode === "glm-unmapped") {',
    '    return { status: 200, json: async () => ({ secret: tok, data: { limits: [',
    '      { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 50, nextResetTime: fut },',
    '    ] } }) };',
    '  }',
    '  return { status: 200, json: async () => ({ secret: tok, model_remains: [',
    '    { model_name: tok, current_interval_remaining_percent: 80, end_time: fut, current_weekly_remaining_percent: 50, weekly_end_time: fut },',
    '  ] }) };',
    '};',
  ].join('\n'), 'utf8');

  const glmOk = spawnSync(process.execPath, ['--require', preload, SRC, 'sync-provider', '--provider', 'glm'], {
    env: { PATH: process.env.PATH, AUTOPILOT_LIVE_DIR: tmpLive(), AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN, QPS_STUB_MODE: 'glm-ok', QPS_STUB_TOK: FAKE_TOKEN },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(glmOk.status, 0);
  const expectedGlmShape = JSON.stringify({
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
      { type: null, unit: 9, number: 1, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false },
    ],
  });
  assert.strictEqual(glmOk.stdout, `sync-provider glm/glm: wrote shape=${expectedGlmShape}\n`);
  assert.strictEqual(glmOk.stderr, '');
  assert.strictEqual((glmOk.stdout + glmOk.stderr).includes(FAKE_TOKEN), false);

  const mmOk = spawnSync(process.execPath, ['--require', preload, SRC, 'sync-provider', '--provider', 'minimax'], {
    env: { PATH: process.env.PATH, AUTOPILOT_LIVE_DIR: tmpLive(), MINIMAX_API_KEY: FAKE_TOKEN, QPS_STUB_MODE: 'mm-ok', QPS_STUB_TOK: FAKE_TOKEN },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(mmOk.status, 0);
  const expectedMmShape = JSON.stringify({ models: 1, dropped: { rolling_5h: null, weekly: null } });
  assert.strictEqual(mmOk.stdout, `sync-provider minimax/minimax: wrote shape=${expectedMmShape}\n`);
  assert.strictEqual(mmOk.stderr, '');
  assert.strictEqual((mmOk.stdout + mmOk.stderr).includes(FAKE_TOKEN), false);

  const glmMiss = spawnSync(process.execPath, ['--require', preload, SRC, 'sync-provider', '--provider', 'glm'], {
    env: { PATH: process.env.PATH, AUTOPILOT_LIVE_DIR: tmpLive(), AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN, QPS_STUB_MODE: 'glm-unmapped', QPS_STUB_TOK: FAKE_TOKEN },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(glmMiss.status, 1);
  const expectedMissShape = JSON.stringify({
    limits: [{ type: 'TIME_LIMIT', unit: 5, number: 1, used_window: null, dropped: null, keys: ['nextResetTime', 'number', 'percentage', 'type', 'unit'], missing: [], pct_from: null, reset_assumed: false }],
  });
  assert.strictEqual(glmMiss.stderr, `sync-provider glm/glm: fields_missing shape=${expectedMissShape}\n`);
  assert.strictEqual(glmMiss.stdout, '');
  assert.strictEqual((glmMiss.stdout + glmMiss.stderr).includes(FAKE_TOKEN), false);
});

test('rate limit: a 30 minute old mirror row means no request (too_soon); a 62 minute old one queries again', async () => {
  for (const [provider, body] of [['minimax', { model_remains: [mm()] }], ['glm', glm([g5(10)])]]) {
    const liveDir = tmpLive();
    const env = provider === 'glm' ? { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN } : { MINIMAX_API_KEY: FAKE_TOKEN };
    const first = await real.syncProvider(provider, { liveDir, env, fetch: fakeFetch(200, body), nowMs: () => NOW });
    assert.strictEqual(first.wrote, true);
    let calls = 0;
    const counting = async (...a) => { calls++; return fakeFetch(200, body)(...a); };
    const soon = await real.syncProvider(provider, { liveDir, env, fetch: counting, nowMs: () => NOW + 1800e3 });
    assert.deepStrictEqual([soon.wrote, soon.reason, calls], [false, 'too_soon', 0], provider);
    const later = await real.syncProvider(provider, { liveDir, env, fetch: counting, nowMs: () => NOW + 3700e3 });
    assert.strictEqual(calls, 1, provider);
    assert.notStrictEqual(later.reason, 'too_soon');
  }
});
test('the mirror file never contains the token (full flow, both providers, both token env names)', async () => {
  const SENTINEL = 'FAKE-SENTINEL-7f3a91c2d8e4b605';
  for (const [provider, body, env] of [
    ['minimax', { model_remains: [mm()] }, { AUTOPILOT_ENDPOINT_MINIMAX_TOKEN: SENTINEL }],
    ['minimax', { model_remains: [mm()] }, { MINIMAX_API_KEY: SENTINEL }],
    ['glm', glm([g5(10), gw(20)]), { AUTOPILOT_ENDPOINT_GLM_TOKEN: SENTINEL }],
  ]) {
    const liveDir = tmpLive();
    const r = await real.syncProvider(provider, { liveDir, env, fetch: fakeFetch(200, body), nowMs: () => NOW });
    assert.strictEqual(r.wrote, true);
    assert.ok(!JSON.stringify(r).includes(SENTINEL));
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } })(liveDir);
    assert.ok(files.some((f) => f.endsWith(`${provider}.json`)), 'the mirror file exists');
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(SENTINEL), f);
  }
});

// ---- negative controls: a mutated adapter must go red where the real one is green
test('planted: dropping the Bearer split, the clamp, the unit mapping or the ms conversion is red', async () => {
  const bearerBug = mutant([["bearer: false,", 'bearer: true,']]);
  const s1 = {}; await run(bearerBug, 'glm', glm([g5(10)]), 200).then((x) => Object.assign(s1, x));
  assert.notStrictEqual(s1.seen.init.headers.Authorization, FAKE_TOKEN);

  const noClamp = mutant([['const c = observation.clampUtilization(w.used);', 'const c = { ok: true, value: w.used, clamped: false };']]);
  const n = await run(noClamp, 'minimax', { model_remains: [mm({ current_interval_remaining_percent: -60 })] });
  assert.strictEqual(n.r.wrote, false); // validateRecord still stops it, but not with the clamp's own path:
  const ok = await run(noClamp, 'minimax', { model_remains: [mm({ current_interval_remaining_percent: -5 })] });
  assert.strictEqual(ok.r.reason, 'quota_invalid', 'without the clamp a 1.05 is rejected instead of clamped: differs from real');

  const noMs = mutant([['function toEpochSeconds(x) { return Math.floor(x > MS_THRESHOLD ? x / 1000 : x); }', 'function toEpochSeconds(x) { return Math.floor(x); }']]);
  const m = await run(noMs, 'minimax', { model_remains: [mm({ end_time: (NOW_S + 3600) * 1000 })] });
  assert.notStrictEqual(m.r.wrote, true);

  const wrongUnit = mutant([['l.unit === 3 && l.number === 5', 'l.unit === 6 && l.number === 5']]);
  const u = await run(wrongUnit, 'glm', glm([g5(10)]));
  assert.strictEqual(u.r.wrote, false);
});
test('planted: without the rate-limit check the 30 minute old mirror is queried (red)', async () => {
  const bug = mutant([["if (!claim.claimed) return out(false, 'too_soon');", '']]);
  const liveDir = tmpLive(); const env = { MINIMAX_API_KEY: FAKE_TOKEN };
  await bug.syncProvider('minimax', { liveDir, env, fetch: fakeFetch(200, { model_remains: [mm()] }), nowMs: () => NOW });
  let calls = 0;
  await bug.syncProvider('minimax', { liveDir, env, fetch: async (...a) => { calls++; return fakeFetch(200, { model_remains: [mm()] })(...a); }, nowMs: () => NOW + 1800e3 });
  assert.strictEqual(calls, 1, 'the mutant calls fetch where the real adapter does not');
});

// ---- g1 fix: the hourly cap counts ATTEMPTS, not only successful writes
const MM_ENV = { MINIMAX_API_KEY: FAKE_TOKEN };
function counter(status, body) { const c = { n: 0 }; c.fetch = async (...a) => { c.n++; return fakeFetch(status, body)(...a); }; return c; }
test('attempt cap: a failed query (500, bad JSON, missing fields, expired, hung) still blocks the next call for an hour', async () => {
  const cases = [[500, { model_remains: [mm()] }], [200, 'BADJSON'], [200, { other: 1 }], [200, { model_remains: [mm({ end_time: NOW_S - 10, weekly_end_time: NOW_S - 10 })] }]];
  for (const [status, body] of cases) {
    const liveDir = tmpLive();
    const first = counter(status, body);
    const r1 = await real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: first.fetch, nowMs: () => NOW });
    assert.strictEqual(r1.wrote, false);
    assert.strictEqual(first.n, 1);
    const second = counter(200, { model_remains: [mm()] });
    const r2 = await real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: second.fetch, nowMs: () => NOW + 1800e3 });
    assert.deepStrictEqual([r2.wrote, r2.reason, second.n], [false, 'too_soon', 0], String(status));
    const r3 = await real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: second.fetch, nowMs: () => NOW + 3601e3 });
    assert.strictEqual(second.n, 1, 'after an hour the next attempt goes out');
    assert.strictEqual(r3.wrote, true);
  }
  const liveDir = tmpLive(); // a throwing fetch (request_failed) counts as an attempt too
  await real.syncProvider('glm', { liveDir, env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN }, fetch: async () => { throw new Error('down'); }, nowMs: () => NOW });
  const c = counter(200, glm([g5(10)]));
  const r = await real.syncProvider('glm', { liveDir, env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN }, fetch: c.fetch, nowMs: () => NOW + 1800e3 });
  assert.deepStrictEqual([r.reason, c.n], ['too_soon', 0]);
});
test('planted: the old success-only cap (no attempt stamp) re-queries after a 500 (red)', async () => {
  const bug = mutant([["const claim = observation.claimAttempt(liveDir, provider, alias, { nowMs: startMs, minIntervalS: MIN_INTERVAL_S, lastObservedAt: lastAt });",
    'const claim = { ok: true, claimed: lastAt === null || startMs / 1000 - lastAt >= MIN_INTERVAL_S };']]);
  const liveDir = tmpLive();
  await bug.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: fakeFetch(500, {}), nowMs: () => NOW });
  const c = counter(200, { model_remains: [mm()] });
  await bug.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: c.fetch, nowMs: () => NOW + 1800e3 });
  assert.strictEqual(c.n, 1, 'the mutant queries again where the real adapter says too_soon');
});
test('attempt cap: a fresh mirror row alone (no stamp file) still blocks; dropping lastObservedAt is red', async () => {
  const liveDir = tmpLive();
  await real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: fakeFetch(200, { model_remains: [mm()] }), nowMs: () => NOW });
  fs.unlinkSync(path.join(liveDir, 'quota', 'minimax', 'minimax.attempt'));
  const c = counter(200, { model_remains: [mm()] });
  const r = await real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: c.fetch, nowMs: () => NOW + 1800e3 });
  assert.deepStrictEqual([r.reason, c.n], ['too_soon', 0]);
  const bug = mutant([['minIntervalS: MIN_INTERVAL_S, lastObservedAt: lastAt }', 'minIntervalS: MIN_INTERVAL_S }']]);
  const c2 = counter(200, { model_remains: [mm()] });
  await bug.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: c2.fetch, nowMs: () => NOW + 1800e3 });
  assert.strictEqual(c2.n, 1, 'the mutant ignores the mirror row');
});
test('attempt cap: two concurrent calls send one request; the mutant without the claim sends two', async () => {
  const run2 = async (mod) => {
    const liveDir = tmpLive(); const c = { n: 0 };
    const slow = async (...a) => { c.n++; await new Promise((r) => setTimeout(r, 20)); return fakeFetch(200, { model_remains: [mm()] })(...a); };
    const rs = await Promise.all([1, 2].map(() => mod.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: slow, nowMs: () => NOW })));
    return { c, rs };
  };
  const a = await run2(real);
  assert.strictEqual(a.c.n, 1);
  assert.strictEqual(a.rs.filter((x) => x.reason === 'too_soon').length, 1);
  assert.ok(a.rs.some((x) => x.reason === 'too_soon'));
  const bug = mutant([["if (!claim.claimed) return out(false, 'too_soon');", '']]);
  assert.strictEqual((await run2(bug)).c.n, 2);
});

// ---- g2 fix: a future timestamp blocks at most one interval
const stampFile = (liveDir) => path.join(liveDir, 'quota', 'minimax', 'minimax.attempt');
test('future attempt stamp: first call too_soon (stamp rewritten to now), claimable 3601 s later; the no-rewrite mutant stays blocked', async () => {
  const liveDir = tmpLive();
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', { nowMs: NOW, minIntervalS: 3600 }).claimed, true);
  fs.writeFileSync(stampFile(liveDir), `${NOW_S + 10 * 86400}\n`, { mode: 0o600 });
  const r = observation.claimAttempt(liveDir, 'minimax', 'minimax', { nowMs: NOW, minIntervalS: 3600 });
  assert.deepStrictEqual([r.ok, r.claimed, r.reason], [true, false, 'too_soon']);
  assert.strictEqual(fs.readFileSync(stampFile(liveDir), 'utf8').trim(), String(NOW_S));
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', { nowMs: NOW + 3601e3, minIntervalS: 3600 }).claimed, true);
  const bug = loadObservationMutant([['if (futureStamp) { writeStamp(); return', 'if (futureStamp) { return']]);
  fs.writeFileSync(stampFile(liveDir), `${NOW_S + 10 * 86400}\n`, { mode: 0o600 });
  bug.claimAttempt(liveDir, 'minimax', 'minimax', { nowMs: NOW, minIntervalS: 3600 });
  const later = observation.claimAttempt(liveDir, 'minimax', 'minimax', { nowMs: NOW + 3601e3, minIntervalS: 3600 });
  assert.strictEqual(later.claimed, false, 'the mutant leaves the future stamp, still blocking after an hour');
});
test('future mirror observed_at does not block past one interval; the mutant without the ignore stays blocked', () => {
  const liveDir = tmpLive();
  const args = (t) => ({ nowMs: NOW + t * 1e3, minIntervalS: 3600, lastObservedAt: NOW_S + 10 * 86400 });
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', args(0)).claimed, true);
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', args(60)).reason, 'too_soon');
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', args(3601)).claimed, true);
  const bug = loadObservationMutant([['Number.isFinite(o.lastObservedAt) && o.lastObservedAt <= nowS ?', 'Number.isFinite(o.lastObservedAt) ?']]);
  const l2 = tmpLive();
  assert.strictEqual(bug.claimAttempt(l2, 'minimax', 'minimax', args(0)).claimed, false);
  assert.strictEqual(bug.claimAttempt(l2, 'minimax', 'minimax', args(3601)).claimed, false, 'the mutant blocks forever');
});

// the lock: loaded copy of account-observation with the lock check removed
function loadObservationMutant(pairs) {
  const f = path.join(__dirname, 'lib', 'account-observation.js');
  let src = fs.readFileSync(f, 'utf8');
  for (const [from, to] of pairs) {
    assert.strictEqual(src.split(from).length - 1, 1, `plant anchor must match exactly once: ${from}`);
    src = src.replace(from, () => to);
  }
  const m = new Module(f, module);
  m.filename = f;
  m.paths = Module._nodeModulePaths(path.dirname(f));
  m._compile(src, f);
  return m.exports;
}
test('attempt cap: while another process holds the per-alias lock nothing is claimed (busy); a mutant without the lock check claims', () => {
  const { holdOsLock, installLeakCheck } = require('./lib/account-fixtures/os-lock-holder');
  const liveDir = tmpLive();
  const args = { nowMs: NOW, minIntervalS: 3600, waitMs: 60 };
  assert.strictEqual(observation.claimAttempt(liveDir, 'minimax', 'minimax', args).claimed, true);
  fs.unlinkSync(path.join(liveDir, 'quota', 'minimax', 'minimax.attempt'));
  const h = holdOsLock(path.join(liveDir, 'quota', 'minimax', 'minimax.oslock'));
  try {
    const r = observation.claimAttempt(liveDir, 'minimax', 'minimax', args);
    assert.deepStrictEqual([r.ok, r.claimed, r.reason], [true, false, 'busy']);
    assert.ok(!fs.existsSync(path.join(liveDir, 'quota', 'minimax', 'minimax.attempt')));
    const bug = loadObservationMutant([["if (!held) return { ok: true, claimed: false, reason: 'busy' };", '']]);
    assert.strictEqual(bug.claimAttempt(liveDir, 'minimax', 'minimax', args).claimed, true, 'the mutant claims under a held lock');
  } finally { h.release(); }
  installLeakCheck(() => {});
});

// ---- g1 fix: the attempt stamp file is covered by the file scan
function allFiles(liveDir) {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } })(liveDir);
  return files;
}
test('attempt stamp: the .attempt file holds one integer, is 0600 and never contains the token (all failure paths too)', async () => {
  const SENTINEL = 'FAKE-SENTINEL-attempt-5c1d9e';
  for (const [status, body] of [[200, { model_remains: [mm()] }], [500, {}], [200, 'BADJSON']]) {
    const liveDir = tmpLive();
    await real.syncProvider('minimax', { liveDir, env: { MINIMAX_API_KEY: SENTINEL }, fetch: fakeFetch(status, body), nowMs: () => NOW });
    const stamp = path.join(liveDir, 'quota', 'minimax', 'minimax.attempt');
    assert.strictEqual(fs.readFileSync(stamp, 'utf8'), `${NOW_S}\n`);
    assert.strictEqual(fs.statSync(stamp).mode & 0o777, 0o600);
    for (const f of allFiles(liveDir)) assert.ok(!fs.readFileSync(f).includes(SENTINEL), f);
  }
});
test('planted: a token written into the attempt stamp file is caught by the file scan (the real helper is clean)', () => {
  const SENTINEL = 'FAKE-SENTINEL-attempt-5c1d9e';
  const leaks = (liveDir) => allFiles(liveDir).filter((f) => fs.readFileSync(f).includes(SENTINEL));
  const clean = tmpLive();
  assert.strictEqual(observation.claimAttempt(clean, 'glm', 'glm', { nowMs: NOW, minIntervalS: 3600, leak: SENTINEL }).claimed, true);
  assert.deepStrictEqual(leaks(clean), []);
  const bug = loadObservationMutant([['fs.writeSync(fd, `${Math.floor(nowS)}\\n`)', 'fs.writeSync(fd, `${Math.floor(nowS)} ${o.leak}\\n`)']]);
  const dirty = tmpLive();
  assert.strictEqual(bug.claimAttempt(dirty, 'glm', 'glm', { nowMs: NOW, minIntervalS: 3600, leak: SENTINEL }).claimed, true);
  assert.strictEqual(leaks(dirty).length, 1, 'the scan finds the planted token in the .attempt file');
});

// ---- g1 fix: a hung fetch that honours the AbortSignal
test('hung fetch: never resolves, honours the abort signal; request_failed, no file written, does not hang (timeout injected)', async () => {
  const hang = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const bounded = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG'), 3000))]);
  const liveDir = tmpLive();
  const r = await bounded(real.syncProvider('minimax', { liveDir, env: MM_ENV, fetch: hang, nowMs: () => NOW, timeoutMs: 50 }));
  assert.notStrictEqual(r, 'HUNG');
  assert.deepStrictEqual([r.wrote, r.reason], [false, 'request_failed']);
  assert.strictEqual(readRow(liveDir, 'minimax', 'minimax'), null);
  assert.ok(!fs.existsSync(path.join(liveDir, 'quota', 'minimax', 'minimax.json')));
  assert.strictEqual(real.TIMEOUT_MS, 10000, 'the default stays 10 s');
  const bug = mutant([['signal: AbortSignal.timeout(Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS),', '']]);
  const hang2 = (url, init) => new Promise((_, reject) => { if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const rb = await bounded(bug.syncProvider('minimax', { liveDir: tmpLive(), env: MM_ENV, fetch: hang2, nowMs: () => NOW, timeoutMs: 50 }));
  assert.strictEqual(rb, 'HUNG', 'without the signal the call hangs');
});
test('planted: a token-shaped or unknown field in the mirror record is refused by validateRecord (not a file-scan test; see the attempt-stamp one)', async () => {
  const leak = mutant([['refusal: null, token_state', "refusal: null, token_state_leak: token, token_state"]]);
  const liveDir = tmpLive();
  const r = await leak.syncProvider('glm', { liveDir, env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: FAKE_TOKEN }, fetch: fakeFetch(200, glm([g5(10)])), nowMs: () => NOW });
  assert.strictEqual(r.wrote, false, 'a token-shaped or unknown field never reaches the mirror');
});
test('planted: used = remaining (forgetting 1 - x) gives a different utilization than the real adapter', async () => {
  const bug = mutant([['function usedFromRemainingPct(p) { return 1 - p / 100; }', 'function usedFromRemainingPct(p) { return p / 100; }']]);
  const { liveDir } = await run(bug, 'minimax', { model_remains: [mm()] });
  const u = readRow(liveDir, 'minimax', 'minimax').windows.find((w) => w.kind === 'rolling_5h').utilization;
  assert.ok(Math.abs(u - 0.2) > 0.1);
});
test('planted: reverting token_state ok / token_state_at on 2xx success back to unknown/null is red', async () => {
  const checkOkTokenState = (rec) => {
    assert.strictEqual(rec.token_state, 'ok');
    assert.strictEqual(Number.isInteger(rec.token_state_at), true);
    assert.strictEqual(rec.token_state_at, NOW_S);
  };
  for (const [provider, body] of [['minimax', { model_remains: [mm()] }], ['glm', glm([g5(10)])]]) {
    const okRun = await run(real, provider, body);
    checkOkTokenState(readRow(okRun.liveDir, provider, provider));
  }
  const reverted = mutant([["token_state: 'ok', token_state_at: Math.floor(nowMs / 1000)", "token_state: 'unknown', token_state_at: null"]]);
  for (const [provider, body] of [['minimax', { model_remains: [mm()] }], ['glm', glm([g5(10)])]]) {
    const badRun = await run(reverted, provider, body);
    const badRec = readRow(badRun.liveDir, provider, provider);
    assert.throws(() => checkOkTokenState(badRec));
  }
});
test('planted: dropping expired tracking from finish() breaks result.shape dropped expired (red)', async () => {
  const noExp = mutant([["if (w.resets_at * 1000 <= nowMs) { expired[kind] = 'expired'; continue; }", 'if (w.resets_at * 1000 <= nowMs) continue;']]);
  const gReal = await run(real, 'glm', glm([g5(25, (NOW_S - 10) * 1000), gw(40)]));
  const gBug = await run(noExp, 'glm', glm([g5(25, (NOW_S - 10) * 1000), gw(40)]));
  assert.strictEqual(gReal.r.shape.limits[0].dropped, 'expired');
  assert.notStrictEqual(gBug.r.shape.limits[0].dropped, 'expired');
});

// ---- shape-slice-before-scrub fix: scrub full string before slicing so a prefixed long token never leaks
function assertNoToken16(text, tok) {
  assert.ok(tok.length > 32);
  for (let i = 0; i + 16 <= tok.length; i++) {
    assert.strictEqual(text.includes(tok.slice(i, i + 16)), false, `16-char token substring at ${i} leaked`);
  }
}
test('shape-slice-before-scrub: limit type with short prefix + token > 32 chars leaks no 16-char token substring in shape or stdout', async () => {
  const { spawnSync } = require('child_process');
  const LONG_TOK = 'FAKE-sentinel-9a8b7c6d5e4f3a2b1c0d9e8f7a';
  const body = glm([
    g5(20),
    { type: `x${LONG_TOK}`, unit: 9, number: 1, percentage: 50, nextResetTime: (NOW_S + 3600) * 1000 },
  ]);
  const r = await real.syncProvider('glm', {
    liveDir: tmpLive(),
    env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: LONG_TOK },
    fetch: fakeFetch(200, body),
    nowMs: () => NOW,
  });
  assert.strictEqual(r.wrote, true);
  assert.strictEqual(r.shape.limits[1].type, null);
  assertNoToken16(JSON.stringify(r.shape), LONG_TOK);
  assertNoToken16(JSON.stringify(r), LONG_TOK);

  const prefixOnly = await real.syncProvider('glm', {
    liveDir: tmpLive(),
    env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: LONG_TOK },
    fetch: fakeFetch(200, glm([{ type: `x${LONG_TOK.slice(0, 32)}`, unit: 9, number: 1, percentage: 50, nextResetTime: (NOW_S + 3600) * 1000 }])),
    nowMs: () => NOW,
  });
  assert.strictEqual(prefixOnly.shape.limits[0].type, null);
  assertNoToken16(JSON.stringify(prefixOnly.shape), LONG_TOK);

  const mmRes = await real.syncProvider('minimax', {
    liveDir: tmpLive(),
    env: { MINIMAX_API_KEY: LONG_TOK },
    fetch: fakeFetch(200, { model_remains: [mm({ model_name: `${'m'.repeat(40)}${LONG_TOK}` })] }),
    nowMs: () => NOW,
  });
  assert.strictEqual(mmRes.wrote, true);
  assert.strictEqual(mmRes.tightest.rolling_5h, null);
  assertNoToken16(JSON.stringify(mmRes), LONG_TOK);

  const stubDir = tmpLive();
  const preload = path.join(stubDir, 'preload-prefixed-tok.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    'globalThis.fetch = async () => {',
    '  const tok = process.env.QPS_STUB_TOK;',
    '  const fut = Date.now() + 3600000;',
    '  return { status: 200, json: async () => ({ data: { limits: [',
    '    { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 20, nextResetTime: fut },',
    '    { type: "x" + tok, unit: 9, number: 1, percentage: 50, nextResetTime: fut },',
    '  ] } }) };',
    '};',
  ].join('\n'), 'utf8');
  const cli = spawnSync(process.execPath, ['--require', preload, SRC, 'sync-provider', '--provider', 'glm'], {
    env: { PATH: process.env.PATH, AUTOPILOT_LIVE_DIR: tmpLive(), AUTOPILOT_ENDPOINT_GLM_TOKEN: LONG_TOK, QPS_STUB_TOK: LONG_TOK },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(cli.status, 0);
  assert.match(cli.stdout, /^sync-provider glm\/glm: wrote shape=/);
  assertNoToken16(cli.stdout, LONG_TOK);
  assertNoToken16(cli.stderr, LONG_TOK);
});
test('planted: reverting sliceClean to slice before scrub leaks a 16-char token substring in shape (red)', async () => {
  const LONG_TOK = 'FAKE-sentinel-9a8b7c6d5e4f3a2b1c0d9e8f7a';
  const body = glm([
    g5(20),
    { type: `x${LONG_TOK}`, unit: 9, number: 1, percentage: 50, nextResetTime: (NOW_S + 3600) * 1000 },
  ]);
  const reverted = mutant([[
    'const clean = scrubSecret(s, secret);\n  return clean === null ? null : clean.slice(0, max);',
    'return scrubSecret(s.slice(0, max), secret);',
  ]]);
  const badR = await reverted.syncProvider('glm', {
    liveDir: tmpLive(),
    env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: LONG_TOK },
    fetch: fakeFetch(200, body),
    nowMs: () => NOW,
  });
  assert.throws(() => assertNoToken16(JSON.stringify(badR.shape), LONG_TOK), /16-char token substring/);
  const badMm = await reverted.syncProvider('minimax', {
    liveDir: tmpLive(),
    env: { MINIMAX_API_KEY: LONG_TOK },
    fetch: fakeFetch(200, { model_remains: [mm({ model_name: `${'m'.repeat(40)}${LONG_TOK}` })] }),
    nowMs: () => NOW,
  });
  assert.throws(() => assertNoToken16(JSON.stringify(badMm), LONG_TOK), /16-char token substring/);
});

// ---- glm partial-entry diagnostics, percentage fallback, and unstarted-window reset fallback
test('glm (a): 5h entry with percentage 0 and no nextResetTime writes rolling_5h at now+5h with reset_assumed true; weekly 0% uses now+7d', async () => {
  const { r, liveDir } = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0 },
  ]), 200, { nowMs: () => NOW + 789 });
  assert.deepStrictEqual([r.wrote, r.reason, r.assumed], [true, null, true]);
  assert.deepStrictEqual(r.shape, {
    limits: [{
      type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: null,
      keys: ['number', 'percentage', 'type', 'unit'], missing: ['nextResetTime'],
      pct_from: null, reset_assumed: true,
    }],
  });
  const rec = readRow(liveDir, 'glm', 'glm');
  assert.strictEqual(rec.windows.length, 1);
  const w5 = rec.windows[0];
  assert.strictEqual(w5.kind, 'rolling_5h');
  assert.strictEqual(w5.utilization, 0);
  assert.strictEqual(w5.resets_at, NOW_S + 5 * 3600);
  assert.strictEqual('reset_assumed' in w5, false);

  const wkOnly = await run(real, 'glm', glm([{ type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 0 }]));
  assert.strictEqual(wkOnly.r.wrote, true);
  assert.strictEqual(wkOnly.r.shape.limits[0].reset_assumed, true);
  assert.deepStrictEqual(wkOnly.r.shape.limits[0].missing, ['nextResetTime']);
  assert.strictEqual(readRow(wkOnly.liveDir, 'glm', 'glm').windows[0].resets_at, NOW_S + 7 * 86400);
});

test('glm (b): 5h entry with percentage 12 and no nextResetTime stays fields_missing and writes nothing', async () => {
  for (const extra of [{}, { nextResetTime: null }, { nextResetTime: 'soon' }]) {
    const { r, liveDir } = await run(real, 'glm', glm([
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12, ...extra },
    ]));
    assert.deepStrictEqual([r.wrote, r.reason], [false, 'fields_missing']);
    assert.strictEqual(r.shape.limits[0].used_window, 'rolling_5h');
    assert.strictEqual(r.shape.limits[0].dropped, 'fields_missing');
    assert.strictEqual(r.shape.limits[0].reset_assumed, false);
    assert.deepStrictEqual(r.shape.limits[0].missing, ['nextResetTime']);
    assert.strictEqual(readRow(liveDir, 'glm', 'glm'), null);
  }
});

test('glm (c): percentage fallback from currentValue/usage or remaining/usage (clamped 0..100, pct_from recorded, derived 0% assumes reset)', async () => {
  const { r, liveDir } = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, currentValue: 50, usage: 200, nextResetTime: (NOW_S + 3600) * 1000 },
  ]));
  assert.deepStrictEqual([r.wrote, r.reason], [true, null]);
  assert.deepStrictEqual(r.shape, {
    limits: [{
      type: 'TOKENS_LIMIT', unit: 3, number: 5, used_window: 'rolling_5h', dropped: null,
      keys: ['currentValue', 'nextResetTime', 'number', 'type', 'unit', 'usage'],
      missing: ['percentage'], pct_from: 'currentValue', reset_assumed: false,
    }],
  });
  const w5 = readRow(liveDir, 'glm', 'glm').windows.find((w) => w.kind === 'rolling_5h');
  assert.ok(Math.abs(w5.utilization - 0.25) < 1e-9);
  assert.strictEqual(w5.resets_at, NOW_S + 3600);

  const rem = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, remaining: 150, usage: 200, nextResetTime: (NOW_S + 3600) * 1000 },
  ]));
  assert.strictEqual(rem.r.wrote, true);
  assert.strictEqual(rem.r.shape.limits[0].pct_from, 'remaining');
  assert.deepStrictEqual(rem.r.shape.limits[0].missing, ['percentage']);
  assert.ok(Math.abs(readRow(rem.liveDir, 'glm', 'glm').windows[0].utilization - 0.25) < 1e-9);

  const both = real.convertGlm(glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, currentValue: 50, remaining: 10, usage: 200, nextResetTime: (NOW_S + 3600) * 1000 },
  ]), NOW);
  assert.strictEqual(both.ok, true);
  assert.strictEqual(both.shape.limits[0].pct_from, 'currentValue');
  assert.ok(Math.abs(both.windows[0].utilization - 0.25) < 1e-9);

  const over = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, currentValue: 500, usage: 200, nextResetTime: (NOW_S + 3600) * 1000 },
    { type: 'TOKENS_LIMIT', unit: 6, number: 1, remaining: 300, usage: 200, nextResetTime: (NOW_S + 86400) * 1000 },
  ]));
  assert.strictEqual(over.r.wrote, true);
  const overRec = readRow(over.liveDir, 'glm', 'glm');
  assert.strictEqual(overRec.windows.find((w) => w.kind === 'rolling_5h').utilization, 1);
  assert.strictEqual(overRec.windows.find((w) => w.kind === 'weekly').utilization, 0);

  const derivedZero = await run(real, 'glm', glm([
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, currentValue: 0, usage: 200 },
  ]));
  assert.strictEqual(derivedZero.r.wrote, true);
  assert.strictEqual(derivedZero.r.shape.limits[0].pct_from, 'currentValue');
  assert.strictEqual(derivedZero.r.shape.limits[0].reset_assumed, true);
  assert.deepStrictEqual(derivedZero.r.shape.limits[0].missing, ['percentage', 'nextResetTime']);
  assert.strictEqual(readRow(derivedZero.liveDir, 'glm', 'glm').windows[0].resets_at, NOW_S + 5 * 3600);
});

test('glm (d): neither percentage nor usable fallback fields stays fields_missing and missing includes percentage', async () => {
  const cases = [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, unknownField: 10, nextResetTime: (NOW_S + 3600) * 1000 },
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, unknownField: 10 },
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, currentValue: 10, usage: 0, nextResetTime: (NOW_S + 3600) * 1000 },
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, remaining: 10, usage: -5, nextResetTime: (NOW_S + 3600) * 1000 },
  ];
  for (const item of cases) {
    const { r, liveDir } = await run(real, 'glm', glm([item]));
    assert.deepStrictEqual([r.wrote, r.reason], [false, 'fields_missing']);
    assert.strictEqual(r.shape.limits[0].dropped, 'fields_missing');
    assert.strictEqual(r.shape.limits[0].pct_from, null);
    assert.strictEqual(r.shape.limits[0].missing.includes('percentage'), true);
    assert.strictEqual(readRow(liveDir, 'glm', 'glm'), null);
  }
});

test('glm (e): shape keys lists sorted own key names only (max 16, scrubbed + 32-char sliced) and never leaks token values', async () => {
  const LONG_TOK = 'FAKE-sentinel-9a8b7c6d5e4f3a2b1c0d9e8f7a';
  const manyProps = {};
  for (let i = 19; i >= 0; i--) manyProps[`field_${String(i).padStart(2, '0')}`] = `v-${LONG_TOK}-${i}`;
  const body = glm([
    {
      type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 20, nextResetTime: (NOW_S + 3600) * 1000,
      ...manyProps,
    },
    {
      type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 10, nextResetTime: (NOW_S + 3600) * 1000,
      [`a_${LONG_TOK}`]: 'ignored',
      [`b_${'k'.repeat(40)}`]: LONG_TOK,
      rawSecretValue: LONG_TOK,
      prefixedSecretValue: `x${LONG_TOK}`,
    },
  ]);
  const r = await real.syncProvider('glm', {
    liveDir: tmpLive(),
    env: { AUTOPILOT_ENDPOINT_GLM_TOKEN: LONG_TOK },
    fetch: fakeFetch(200, body),
    nowMs: () => NOW,
  });
  assert.strictEqual(r.wrote, true);
  assert.strictEqual(r.shape.limits[0].keys.length, 16);
  assert.deepStrictEqual(r.shape.limits[0].keys, r.shape.limits[0].keys.slice().sort());
  assert.strictEqual(r.shape.limits[1].keys[0], null, 'key containing token is scrubbed to null');
  assert.strictEqual(r.shape.limits[1].keys[1], `b_${'k'.repeat(30)}`, 'long key name is sliced to 32 chars');
  assertNoToken16(JSON.stringify(r.shape), LONG_TOK);
  assertNoToken16(JSON.stringify(r), LONG_TOK);

  const unScrubbedCall = real.convertGlm(glm([{
    type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0,
    carrierA: LONG_TOK, carrierB: `Bearer ${LONG_TOK}`,
  }]), NOW);
  assert.strictEqual(unScrubbedCall.ok, true);
  assert.deepStrictEqual(unScrubbedCall.shape.limits[0].keys, ['carrierA', 'carrierB', 'number', 'percentage', 'type', 'unit']);
  assertNoToken16(JSON.stringify(unScrubbedCall), LONG_TOK);
});

test('planted: breaking nextResetTime fallback (3) to also accept pct > 0 turns case (b) red; leaking values into keys is red', async () => {
  const checkCaseB = async (mod) => {
    const { r, liveDir } = await run(mod, 'glm', glm([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12 }]));
    assert.deepStrictEqual([r.wrote, r.reason], [false, 'fields_missing']);
    assert.strictEqual(r.shape.limits[0].dropped, 'fields_missing');
    assert.strictEqual(r.shape.limits[0].reset_assumed, false);
    assert.deepStrictEqual(r.shape.limits[0].missing, ['nextResetTime']);
    assert.strictEqual(readRow(liveDir, 'glm', 'glm'), null);
  };
  await checkCaseB(real);
  const acceptsUsedPct = mutant([['} else if (pct === 0) {', '} else if (pct >= 0) {']]);
  const badB = await run(acceptsUsedPct, 'glm', glm([{ type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12 }]));
  assert.strictEqual(badB.r.wrote, true, 'the broken fallback writes an invented reset for pct > 0');
  assert.strictEqual(badB.r.shape.limits[0].reset_assumed, true);
  await assert.rejects(() => checkCaseB(acceptsUsedPct));

  const LONG_TOK = 'FAKE-sentinel-9a8b7c6d5e4f3a2b1c0d9e8f7a';
  const leaksValues = mutant([['Object.keys(l).sort()', 'Object.values(l).map(String).sort()']]);
  const badKeys = leaksValues.convertGlm(glm([{
    type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0, carrier: LONG_TOK,
  }]), NOW);
  assert.throws(() => assertNoToken16(JSON.stringify(badKeys.shape), LONG_TOK), /16-char token substring/);
});

// ---- static scan: no secret file read, no token printed
const SECRET_READ = [/credentials/i, /\.claude\b/, /oauth/i, /\.config\/autopilot/, /endpoints\.env/, /readFile/, /require\(['"]fs['"]\)/];
const PRINTS_TOKEN = /console\.[a-z]+\([^)]*token|write\([^)]*token/i;
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}
function violations(src) {
  const code = stripComments(src);
  const hits = [];
  code.split('\n').forEach((l, i) => { for (const re of SECRET_READ) if (re.test(l)) hits.push(`${i + 1}:${re}`); if (PRINTS_TOKEN.test(l)) hits.push(`${i + 1}:prints-token`); });
  return hits;
}
test('static scan: the adapter reads no secret file, has no fs of its own and prints no token variable', () => {
  assert.deepStrictEqual(violations(fs.readFileSync(SRC, 'utf8')), []);
});
test('static scan: planted secret reads and token prints are red', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  for (const planted of [
    "const t = fs.readFileSync(path.join(home, '.autopilot', 'endpoints.env'), 'utf8');",
    "const c = readFile(path.join(home, '.claude', '.credentials.json'));",
    'console.error(token);',
    'process.stderr.write(`bad ${token}`);',
  ]) assert.ok(violations(`${src}\n${planted}\n`).length > 0, planted);
});
