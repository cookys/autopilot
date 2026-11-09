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
  const r1 = rowOf({ runner: 'grok', model: 'm', status: 'timed_out' });
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
  assert.strictEqual(A({ runner: 'claude-native', claudeAccount: 'acct-93b0088a' }), 'acct-93b0088a');
  assert.strictEqual(A({ runner: 'claude-native' }), null);
  assert.strictEqual(A({ runner: 'codex', codexAccount: 'codex-186293cb' }), 'codex-186293cb');
  assert.strictEqual(A({ runner: 'codex' }), null);
  assert.strictEqual(A({ runner: 'grok' }), 'grok');
  assert.strictEqual(A({}), null);
  // negative control: a local endpoint must not be reported under its endpoint name
  assert.notStrictEqual(A({ runner: 'cc-shim', endpoint: 'qwen_local', endpointLocal: true, courier: 'n/cuda' }), 'qwen_local');
});

test('fallbacks and served_by from explicit values', () => {
  const r = U.normalizeRow(U.rowFromResult({ runner: 'cc-shim', model: 'want', status: 'ok' }, ctx({
    endpoint: 'qwen_local', endpointLocal: true, served_runner: 'claude-native', served_model: 'got', claudeAccount: 'acct-93b0088a',
    fallbacks: [{ runner: 'cc-shim', model: 'want', endpoint: 'qwen_local', endpointLocal: true, courier: 'n/cuda', reason: 'unreachable' }],
  })));
  assert.deepStrictEqual(r.served_by, { runner: 'claude-native', model: 'got', account: 'acct-93b0088a' });
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

test('runAppend: codex run gets codex-<hash of CODEX_HOME>, not AUTOPILOT_ACCOUNT', () => {
  const dir = mk();
  const live = path.join(dir, 'live');
  fs.mkdirSync(live, { mode: 0o700 });
  const resFile = path.join(dir, 'res.json');
  fs.writeFileSync(resFile, JSON.stringify({ runner: 'codex', model: 'm', status: 'committed', run_id: 'rc1' }));
  const bin = path.join(dir, 'fleet');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "address: a/b/c\\nnamespace: nsx\\ncourier: cx\\n"\n', { mode: 0o755 });
  const env = Object.assign({}, process.env, { AUTOPILOT_LIVE_DIR: live, FLEET_BIN: bin, AUTOPILOT_ACCOUNT: 'work', HOME: dir, CODEX_HOME: path.join(dir, 'codexhome') });
  fs.mkdirSync(path.join(dir, 'codexhome'));
  delete env.AUTOPILOT_DISPATCH_USAGE;
  const cli = path.join(__dirname, 'dispatch-usage.js');
  const r = spawnSync(process.execPath, [cli, 'append', '--from-result', resFile, '--role', 'implementer', '--ended-at', '1793000000'], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const row = JSON.parse(fs.readFileSync(path.join(live, 'dispatch-usage-202610.jsonl'), 'utf8').trim());
  assert.strictEqual(row.account, `codex-${require('./account-alias.js').sha8(fs.realpathSync(path.join(dir, 'codexhome')))}`);
  // no codex dir: unknown, null
  const none = spawnSync(process.execPath, [cli, 'append', '--from-result', resFile, '--role', 'implementer', '--run-id', 'rc2', '--ended-at', '1793000001'], { env: Object.assign({}, env, { CODEX_HOME: path.join(dir, 'absent') }), encoding: 'utf8' });
  assert.strictEqual(none.status, 0, none.stderr);
  const last = fs.readFileSync(path.join(live, 'dispatch-usage-202610.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.strictEqual(last.run_id, 'rc2');
  assert.strictEqual(last.account, null);
});

test('served_by.account: null from the rail stays null when a served runner is set; absent served_by defaults to the seat', () => {
  // consult cloud fallback from an endpoint seat (glm) to claude with no alias
  const r = U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'cc-shim', model: 'm', account: 'glm', served_by: { runner: 'claude', model: 'm2', account: null } });
  assert.deepStrictEqual(r.served_by, { runner: 'claude', model: 'm2', account: null });
  const d = U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'cc-shim', model: 'm', account: 'glm' });
  assert.deepStrictEqual(d.served_by, { runner: 'cc-shim', model: 'm', account: 'glm' });
});

// ---- start row -------------------------------------------------------------------------------------------
const FIX_EMAIL = 'start-row-fixture@example.com';
const FIX_ORG = '00000000-0000-4000-8000-0000000000aa';

function startEnv(dir) {
  const live = path.join(dir, 'live');
  fs.mkdirSync(live, { mode: 0o700 });
  const cfg = path.join(dir, 'cfg');
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ oauthAccount: { organizationUuid: FIX_ORG, emailAddress: FIX_EMAIL } }));
  const env = Object.assign({}, process.env, { AUTOPILOT_LIVE_DIR: live, FLEET_BIN: '/bin/false', HOME: dir, CLAUDE_CONFIG_DIR: cfg });
  delete env.AUTOPILOT_DISPATCH_USAGE;
  delete env.AUTOPILOT_ACCOUNT;
  return { live, cfg, env };
}

test('start then finished row: same run_id, start is running with unknown end and usage, the finished row wins, no email or uuid written', () => {
  const dir = mk();
  const { live, env } = startEnv(dir);
  const cli = path.join(__dirname, 'dispatch-usage.js');
  const s = spawnSync(process.execPath, [cli, 'start', '--role', 'implementer', '--run-id', 'run-s1', '--runner', 'claude-native', '--model', 'm',
    '--started-at', '1793000000', '--provider-session-id', 'sess-1', '--upstream-task-id', 'task-9', '--requester-member', 'ns/cour/mem'], { env, encoding: 'utf8' });
  assert.strictEqual(s.status, 0, s.stderr);
  const resFile = path.join(dir, 'res.json');
  fs.writeFileSync(resFile, JSON.stringify({ runner: 'claude-native', model: 'm', status: 'committed', run_id: 'run-s1', usage: { input_tokens: 3, output_tokens: 4 } }));
  const f = spawnSync(process.execPath, [cli, 'append', '--from-result', resFile, '--role', 'implementer', '--started-at', '1793000000', '--ended-at', '1793000030', '--provider-session-id', 'sess-1'], { env, encoding: 'utf8' });
  assert.strictEqual(f.status, 0, f.stderr);
  const file = path.join(live, 'dispatch-usage-202610.jsonl');
  const text = fs.readFileSync(file, 'utf8');
  const rows = text.trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows.length, 2);
  const [a, b] = rows;
  assert.strictEqual(a.run_id, 'run-s1');
  assert.strictEqual(a.status, 'running');
  assert.strictEqual(a.ended_at, null);
  assert.strictEqual(a.started_at, 1793000000);
  assert.strictEqual(a.usage_source, 'none');
  for (const k of U.USAGE_KEYS) assert.strictEqual(a.usage[k], null, k);
  assert.strictEqual(a.provider_session_id, 'sess-1');
  assert.strictEqual(a.upstream.task_id, 'task-9');
  assert.strictEqual(a.requester.member, 'ns/cour/mem');
  assert.match(a.account, /^acct-[0-9a-f]{8}$/);
  assert.strictEqual(a.account, b.account);
  assert.strictEqual(b.status, 'committed');
  assert.strictEqual(b.run_id, a.run_id);
  // the reader takes the last row per run_id: the finished row wins
  const byRun = new Map();
  for (const r of rows) byRun.set(r.run_id, r);
  assert.strictEqual(byRun.get('run-s1').status, 'committed');
  assert.ok(!text.includes(FIX_EMAIL) && !text.includes(FIX_ORG), 'neither the email nor the organization uuid is written');
  // negative control: the scan can see them when they are present
  assert.ok(`${text}${FIX_EMAIL}`.includes(FIX_EMAIL));
});

test('start row: month file from started_at, validation, off switch, CLI exit 0', () => {
  assert.strictEqual(U.validateRow(U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'grok', status: 'running', started_at: 5, ended_at: null })), null);
  assert.strictEqual(U.validateRow(U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'grok', status: 'running', ended_at: null })), 'running_row_needs_started_at');
  assert.strictEqual(U.validateRow(U.normalizeRow({ run_id: 'r', role: 'implementer', runner: 'grok', status: 'running', started_at: 5, ended_at: 9 })), 'running_row_has_ended_at');
  const dir = mk();
  const { live, env } = startEnv(dir);
  const cli = path.join(__dirname, 'dispatch-usage.js');
  // 1798761599 = 2026-12-31 23:59:59 UTC: the start row lands in the December file
  spawnSync(process.execPath, [cli, 'start', '--role', 'reviewer', '--run-id', 'r-dec', '--runner', 'grok', '--started-at', '1798761599'], { env, encoding: 'utf8' });
  assert.deepStrictEqual(fs.readdirSync(live), ['dispatch-usage-202612.jsonl']);
  const noRunner = spawnSync(process.execPath, [cli, 'start', '--role', 'reviewer', '--run-id', 'r-x'], { env, encoding: 'utf8' });
  assert.strictEqual(noRunner.status, 0);
  assert.match(noRunner.stderr, /warn: runner_missing/);
  const off = spawnSync(process.execPath, [cli, 'start', '--role', 'reviewer', '--run-id', 'r-off', '--runner', 'grok', '--started-at', '1793000000'], { env: Object.assign({}, env, { AUTOPILOT_DISPATCH_USAGE: 'off' }), encoding: 'utf8' });
  assert.strictEqual(off.status, 0);
  assert.deepStrictEqual(fs.readdirSync(live), ['dispatch-usage-202612.jsonl']);
});

test('account in the ledger: invalid AUTOPILOT_ACCOUNT falls through, valid one is used as is, missing .claude.json falls to the config dir hash', () => {
  const dir = mk();
  const { live, cfg, env } = startEnv(dir);
  const cli = path.join(__dirname, 'dispatch-usage.js');
  const start = (id, e) => spawnSync(process.execPath, [cli, 'start', '--role', 'reviewer', '--run-id', id, '--runner', 'cc-shim', '--started-at', '1793000000'], { env: e, encoding: 'utf8' });
  const acct = (id) => fs.readFileSync(path.join(live, 'dispatch-usage-202610.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).find((r) => r.run_id === id).account;
  start('a1', Object.assign({}, env, { AUTOPILOT_ACCOUNT: 'ci-runner-2' }));
  assert.strictEqual(acct('a1'), 'ci-runner-2');
  start('a2', Object.assign({}, env, { AUTOPILOT_ACCOUNT: 'Ops@x' }));
  assert.strictEqual(acct('a2'), `acct-${require('./account-alias.js').sha8(`${FIX_ORG}\n${FIX_EMAIL}`)}`);
  fs.rmSync(path.join(cfg, '.claude.json'));
  start('a3', env);
  assert.strictEqual(acct('a3'), `acct-${require('./account-alias.js').sha8(fs.realpathSync(cfg))}`);
});

test('sample fixture for the fleet reader: a start and a finished row per rail, all valid, the finished row wins', () => {
  const rows = fs.readFileSync(path.join(__dirname, 'fixtures', 'dispatch-usage-samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows.length, 8);
  const last = new Map();
  for (const r of rows) {
    assert.strictEqual(U.validateRow(r), null, r.run_id);
    last.set(r.run_id, r);
  }
  assert.strictEqual(last.size, 4);
  for (let i = 0; i < rows.length; i += 2) {
    assert.strictEqual(rows[i].status, 'running');
    assert.strictEqual(rows[i].ended_at, null);
    assert.strictEqual(rows[i].usage_source, 'none');
    assert.strictEqual(rows[i + 1].run_id, rows[i].run_id);
    assert.notStrictEqual(last.get(rows[i].run_id).status, 'running');
  }
});

test('month split: a run starting in December and ending in January keeps every row in the start-month file', () => {
  const dir = mk();
  const startedAt = 1798761569; // 2026-12-31 23:59:29 UTC
  const start = U.normalizeRow({ run_id: 'run-split', role: 'implementer', runner: 'grok', status: 'running', started_at: startedAt, ended_at: null });
  const fin = rowOf({ runner: 'grok', model: 'm', status: 'committed', run_id: 'run-split' }, { run_id: 'run-split', ended_at: 1798761630, wall_secs: 61 });
  assert.strictEqual(fin.started_at, startedAt);
  const a = U.appendRow(start, { dir });
  const b = U.appendRow(fin, { dir });
  assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
  assert.strictEqual(path.basename(a.file), 'dispatch-usage-202612.jsonl');
  assert.strictEqual(path.basename(b.file), 'dispatch-usage-202612.jsonl');
  assert.deepStrictEqual(fs.readdirSync(dir), ['dispatch-usage-202612.jsonl']); // no 202701 file
  const rows = fs.readFileSync(a.file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[rows.length - 1].status, 'committed'); // last row wins
});
