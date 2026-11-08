#!/usr/bin/env node
'use strict';
// dispatch_usage/1 writer: normalization, null-not-zero, validation, same-run rows, month file, no token in the file,
// account mapping. Tempdir only (AUTOPILOT_LIVE_DIR / opts.dir); never the real live dir.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('./dispatch-usage.js');

const FAKE_TOKEN = 'FAKE-sk-ant-oat01-NOTAREALTOKEN';
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dusage-'));
const ctx = (extra) => Object.assign({ role: 'implementer', run_id: 'run-1', ended_at: 1793000000, wall_secs: 20, courier: 'ns/cour', provider_session_id: null }, extra || {});
const rowOf = (result, c) => U.normalizeRow(U.rowFromResult(result, ctx(c)));

test('normalize: fixed shape, started_at derived from ended_at - wall_secs', () => {
  const r = rowOf({ runner: 'grok', model: 'm1', status: 'committed', usage: { input_tokens: 5, output_tokens: 7 }, branch: 'b', base: 'main', commit: 'abc' });
  assert.strictEqual(r.schema, 'dispatch_usage/1');
  assert.strictEqual(r.started_at, 1793000000 - 20);
  assert.deepStrictEqual(r.usage, { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: null, cache_creation_input_tokens: null, reasoning_tokens: null });
  assert.strictEqual(r.usage_source, 'provider_response');
  assert.deepStrictEqual(r.served_by, { runner: 'grok', model: 'm1', account: 'grok' });
  assert.deepStrictEqual(r.fallbacks, []);
  assert.strictEqual(U.validateRow(r), null);
});

test('unknown is null, never 0', () => {
  const r = rowOf({ runner: 'grok', model: 'm1', usage: null });
  assert.strictEqual(r.usage_source, 'none');
  for (const k of U.USAGE_KEYS) assert.strictEqual(r.usage[k], null, k);
  assert.strictEqual(r.timed_out, null);
  assert.strictEqual(r.error_category, null);
  assert.strictEqual(r.requester.lane, null);
  assert.strictEqual(r.upstream.task_id, null);
  assert.strictEqual(U.validateRow(r), null);
});

test('usage keys: aliases fold, non-integers and negatives become null', () => {
  const u = U.normalizeUsage({ input_tokens: -1, output_tokens: '7', cache_read_tokens: 3, reasoning_tokens: 2 });
  assert.deepStrictEqual(u, { input_tokens: null, output_tokens: null, cache_read_input_tokens: 3, cache_creation_input_tokens: null, reasoning_tokens: 2 });
});

test('validation rejects each broken row (negative controls)', () => {
  const good = rowOf({ runner: 'grok', model: 'm', usage: { input_tokens: 1 } });
  assert.strictEqual(U.validateRow(good), null);
  const broken = [
    ['bad_schema', (r) => { r.schema = 'x'; }],
    ['run_id_missing', (r) => { r.run_id = null; }],
    ['bad_role', (r) => { r.role = 'boss'; }],
    ['runner_missing', (r) => { r.runner = null; }],
    ['ended_at_not_epoch_int', (r) => { r.ended_at = 1.5; }],
    ['started_at_not_epoch_int', (r) => { r.started_at = '1'; }],
    ['bad_usage_source', (r) => { r.usage_source = 'guess'; }],
    ['usage_input_tokens_not_int_or_null', (r) => { r.usage.input_tokens = 0.5; }],
    ['usage_present_but_source_none', (r) => { r.usage_source = 'none'; }],
    ['usage_source_set_but_usage_empty', (r) => { r.usage.input_tokens = null; }],
    ['bad_account', (r) => { r.account = 'has space'; }],
    ['fallbacks_not_array', (r) => { r.fallbacks = {}; }],
  ];
  for (const [reason, mutate] of broken) {
    const r = JSON.parse(JSON.stringify(good));
    mutate(r);
    assert.strictEqual(U.validateRow(r), reason);
  }
  // the dedupe key: a claude-family row that claims provider usage must carry the child session id
  const cc = rowOf({ runner: 'cc-shim', model: 'm', usage: { input_tokens: 1 } });
  assert.strictEqual(U.validateRow(cc), 'claude_family_missing_provider_session_id');
  const ccOk = rowOf({ runner: 'cc-shim', model: 'm', usage: { input_tokens: 1 } }, { provider_session_id: '11111111-2222-3333-4444-555555555555' });
  assert.strictEqual(U.validateRow(ccOk), null);
});

test('role outside the enum folds to other', () => {
  assert.strictEqual(rowOf({ runner: 'grok', model: 'm' }, { role: 'whatever' }).role, 'other');
  assert.strictEqual(rowOf({ runner: 'grok', model: 'm' }, { role: 'plan-review' }).role, 'plan-review');
});

test('append: month file name, one line per row, same run twice gives two rows (last wins for the reader)', () => {
  const dir = mk();
  const r1 = rowOf({ runner: 'grok', model: 'm', status: 'running' });
  const r2 = rowOf({ runner: 'grok', model: 'm', status: 'committed', usage: { input_tokens: 9 } });
  const a = U.appendRow(r1, { dir });
  const b = U.appendRow(r2, { dir });
  assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
  assert.strictEqual(path.basename(a.file), 'dispatch-usage-202610.jsonl'); // 1793000000 = 2026-10-26 UTC
  const lines = fs.readFileSync(a.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[1].status, 'committed');
  assert.strictEqual(lines[1].usage.input_tokens, 9);
  assert.strictEqual(U.ledgerFileName(1798761600), 'dispatch-usage-202701.jsonl'); // 2027-01-01 00:00 UTC
  assert.strictEqual(U.ledgerFileName(1798761599), 'dispatch-usage-202612.jsonl');
  assert.strictEqual(fs.statSync(a.file).mode & 0o077, 0, 'file is private');
});

test('append refuses an invalid row and writes nothing; never throws on an unwritable dir', () => {
  const dir = mk();
  const bad = rowOf({ runner: 'grok', model: 'm' }, { role: 'implementer', run_id: null });
  const r = U.appendRow(bad, { dir });
  assert.deepStrictEqual(r, { ok: false, error: 'run_id_missing' });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  const w = U.appendRow(rowOf({ runner: 'grok', model: 'm' }), { dir: path.join(dir, 'no', 'such') });
  assert.strictEqual(w.ok, false);
  assert.match(w.error, /^write_failed/);
});

test('no token in the file: a result carrying a fake token in error/log fields is not copied', () => {
  const dir = mk();
  const result = { runner: 'grok', model: 'm', status: 'runner_failed', usage: { input_tokens: 1 }, error: `Bearer ${FAKE_TOKEN}`, agent_log: `/x/${FAKE_TOKEN}`, error_category: 'quota' };
  const row = rowOf(result);
  const a = U.appendRow(row, { dir });
  const text = fs.readFileSync(a.file, 'utf8');
  assert.ok(!text.includes(FAKE_TOKEN));
  assert.strictEqual(JSON.parse(text).error_category, 'quota');
  // negative control: the scan really sees a token when a row does carry one
  const leaky = Object.assign({}, row, { error_category: FAKE_TOKEN });
  const b = U.appendRow(leaky, { dir });
  assert.ok(fs.readFileSync(b.file, 'utf8').includes(FAKE_TOKEN), 'control: the scan is able to find a token');
});

test('account mapping', () => {
  const A = U.accountFor;
  assert.strictEqual(A({ runner: 'cc-shim', endpoint: 'glm' }), 'glm');
  assert.strictEqual(A({ runner: 'cc-shim', endpoint: 'qwen_local', endpointLocal: true, courier: 'cookys/cuda' }), 'local:cuda');
  assert.strictEqual(A({ runner: 'cc-shim', endpoint: 'qwen_local', endpointLocal: true, courier: null }), null);
  assert.strictEqual(A({ runner: 'claude-native', claudeAlias: 'a1' }), 'claude:a1');
  assert.strictEqual(A({ runner: 'claude-native' }), null);
  assert.strictEqual(A({ runner: 'codex', codexAlias: 'c2' }), 'codex:c2');
  assert.strictEqual(A({ runner: 'codex' }), null);
  assert.strictEqual(A({ runner: 'grok' }), 'grok');
  assert.strictEqual(A({}), null);
  // negative control: a local endpoint must not be reported under its endpoint name
  assert.notStrictEqual(A({ runner: 'cc-shim', endpoint: 'qwen_local', endpointLocal: true, courier: 'n/cuda' }), 'qwen_local');
});

test('fallbacks and served_by from explicit values', () => {
  const r = U.normalizeRow(U.rowFromResult({ runner: 'cc-shim', model: 'want', status: 'ok' }, ctx({
    endpoint: 'qwen_local', endpointLocal: true, served_runner: 'claude-native', served_model: 'got', claudeAlias: 'a1',
    fallbacks: [{ runner: 'cc-shim', model: 'want', endpoint: 'qwen_local', endpointLocal: true, courier: 'n/cuda', reason: 'unreachable' }],
  })));
  assert.deepStrictEqual(r.served_by, { runner: 'claude-native', model: 'got', account: 'claude:a1' });
  assert.deepStrictEqual(r.fallbacks, [{ runner: 'cc-shim', model: 'want', account: 'local:cuda', reason: 'unreachable' }]);
  assert.strictEqual(r.account, 'local:cour');
});

test('CLI: appends one row, exit 0 even when it cannot write, off switch writes nothing', () => {
  const dir = mk();
  const resFile = path.join(dir, 'res.json');
  fs.writeFileSync(resFile, JSON.stringify({ runner: 'grok', model: 'm', status: 'committed', run_id: 'r9', usage: { input_tokens: 3, output_tokens: 4 } }));
  const live = path.join(dir, 'live');
  fs.mkdirSync(live, { mode: 0o700 });
  const bin = path.join(dir, 'fleet');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "address: a/b/c\\nnamespace: nsx\\ncourier: cx\\n"\n', { mode: 0o755 });
  const env = Object.assign({}, process.env, { AUTOPILOT_LIVE_DIR: live, FLEET_BIN: bin, AUTOPILOT_DISPATCH_LANE: 'lane-x', AUTOPILOT_UPSTREAM_TASK_ID: 't-1' });
  delete env.AUTOPILOT_DISPATCH_USAGE;
  const cli = path.join(__dirname, 'dispatch-usage.js');
  const run = (args, e) => spawnSync(process.execPath, [cli, 'append', ...args], { env: e || env, encoding: 'utf8' });
  const r = run(['--from-result', resFile, '--role', 'implementer', '--wall-secs', '12', '--ended-at', '1793000000']);
  assert.strictEqual(r.status, 0, r.stderr);
  const file = path.join(live, 'dispatch-usage-202610.jsonl');
  const row = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.strictEqual(row.run_id, 'r9');
  assert.strictEqual(row.courier, 'nsx/cx');
  assert.strictEqual(row.requester.lane, 'lane-x');
  assert.strictEqual(row.upstream.task_id, 't-1');
  assert.strictEqual(row.started_at, 1793000000 - 12);
  // invalid: warns, exit 0, no new row
  const noId = path.join(dir, 'noid.json');
  fs.writeFileSync(noId, JSON.stringify({ runner: 'grok', model: 'm', status: 'x' }));
  const bad = run(['--from-result', noId, '--role', 'implementer', '--ended-at', '1793000001']);
  assert.strictEqual(bad.status, 0);
  assert.match(bad.stderr, /warn: run_id_missing/);
  const off = run(['--from-result', resFile, '--role', 'implementer', '--ended-at', '1793000002'], Object.assign({}, env, { AUTOPILOT_DISPATCH_USAGE: 'off' }));
  assert.strictEqual(off.status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1, 'neither the invalid nor the off run added a row');
  const missing = run(['--from-result', path.join(dir, 'nope.json'), '--role', 'implementer']);
  assert.strictEqual(missing.status, 0);
  assert.match(missing.stderr, /dispatch-usage: warn/);
});

test('usage_json (raw, missing keys null) wins over the result usage a rail zero-filled', () => {
  const zeroFilled = { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const raw = { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: null, cache_creation_input_tokens: null };
  const row = rowOf({ runner: 'cc-shim', model: 'm', status: 'ok', run_id: 'r1', usage: zeroFilled }, { usage_json: raw });
  assert.strictEqual(row.usage.cache_read_input_tokens, null);
  assert.strictEqual(row.usage.cache_creation_input_tokens, null);
  assert.strictEqual(row.usage.input_tokens, 120);
  // without usage_json the result usage is used as before
  const plain = rowOf({ runner: 'cc-shim', model: 'm', status: 'ok', run_id: 'r1', usage: zeroFilled }, {});
  assert.strictEqual(plain.usage.cache_read_input_tokens, 0);
});

test('runAppend: codex run with AUTOPILOT_ACCOUNT and no endpoint gets codex:<alias>', () => {
  const dir = mk();
  const live = path.join(dir, 'live');
  fs.mkdirSync(live, { mode: 0o700 });
  const resFile = path.join(dir, 'res.json');
  fs.writeFileSync(resFile, JSON.stringify({ runner: 'codex', model: 'm', status: 'committed', run_id: 'rc1' }));
  const bin = path.join(dir, 'fleet');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "address: a/b/c\\nnamespace: nsx\\ncourier: cx\\n"\n', { mode: 0o755 });
  const env = Object.assign({}, process.env, { AUTOPILOT_LIVE_DIR: live, FLEET_BIN: bin, AUTOPILOT_ACCOUNT: 'work' });
  delete env.AUTOPILOT_DISPATCH_USAGE;
  const cli = path.join(__dirname, 'dispatch-usage.js');
  const r = spawnSync(process.execPath, [cli, 'append', '--from-result', resFile, '--role', 'implementer', '--ended-at', '1793000000'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const row = JSON.parse(fs.readFileSync(path.join(live, 'dispatch-usage-202610.jsonl'), 'utf8').trim());
  assert.strictEqual(row.account, 'codex:work');
});

test('served_by.account: null from the rail stays null when a served runner is set; absent served_by defaults to the seat', () => {
  // consult cloud fallback from an endpoint seat (glm) to claude with no alias
  const r = U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'cc-shim', model: 'm', account: 'glm', served_by: { runner: 'claude', model: 'm2', account: null } });
  assert.deepStrictEqual(r.served_by, { runner: 'claude', model: 'm2', account: null });
  const d = U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'cc-shim', model: 'm', account: 'glm' });
  assert.deepStrictEqual(d.served_by, { runner: 'cc-shim', model: 'm', account: 'glm' });
});
