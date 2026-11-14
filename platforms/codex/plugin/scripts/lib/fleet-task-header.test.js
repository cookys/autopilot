#!/usr/bin/env node
'use strict';
// S2 round 2 unit tests for scripts/lib/fleet-task-header.js: the fleet-gateway allowlist
// decision (env AUTOPILOT_FLEET_GATEWAY_ENDPOINTS / config.json fleet_gateway_endpoints)
// next to the ULID check. Parsing covers spaces, empty items and unknown names; resolution
// covers no-endpoint, not-allowlisted (no header, no warning), different endpoint,
// case-insensitivity, and the gateway+invalid-id warning.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  GATEWAY_ENV,
  GATEWAY_CONFIG_KEY,
  parseGatewayAllowlist,
  readGatewayAllowlist,
  resolveFleetTask,
} = require('./fleet-task-header.js');

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

test('parseGatewayAllowlist: comma string — spaces trimmed, case folded, empty items dropped', () => {
  assert.deepEqual(parseGatewayAllowlist('TESTEP, glm ,,qwen_local'), ['testep', 'glm', 'qwen_local']);
  assert.deepEqual(parseGatewayAllowlist('  '), []);
  assert.deepEqual(parseGatewayAllowlist(''), []);
  assert.deepEqual(parseGatewayAllowlist(undefined), []);
  assert.deepEqual(parseGatewayAllowlist(null), []);
});

test('parseGatewayAllowlist: config.json array form parses the same way', () => {
  assert.deepEqual(parseGatewayAllowlist(['TESTEP', ' glm ', '']), ['testep', 'glm']);
});

test('parseGatewayAllowlist: an unknown name is kept but never matches a legal run', () => {
  // 'no-such-endpoint' (hyphen: not a name resolve-endpoint.sh accepts) sits unused in the
  // allowlist and never admits an endpoint.
  assert.deepEqual(parseGatewayAllowlist('no-such-endpoint'), ['no-such-endpoint']);
  assert.deepEqual(resolveFleetTask(ULID, 'glm', { env: { [GATEWAY_ENV]: 'no-such-endpoint' } }), { ok: true, id: '' });
});

test('readGatewayAllowlist: env wins; set-but-empty means none; config array is read', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-task-header-home-'));
  const cfgDir = path.join(home, '.autopilot');
  fs.mkdirSync(cfgDir);
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ [GATEWAY_CONFIG_KEY]: ['TESTEP'] }));
  const env = { HOME: home };
  assert.deepEqual(readGatewayAllowlist({ env, home }), ['testep']);
  assert.deepEqual(readGatewayAllowlist({ env: { ...env, [GATEWAY_ENV]: 'GLM' }, home }), ['glm']);
  assert.deepEqual(readGatewayAllowlist({ env: { ...env, [GATEWAY_ENV]: '' }, home }), []);
  fs.rmSync(home, { recursive: true, force: true });
});

test('resolveFleetTask: header only for a named, allowlisted endpoint with a ULID', () => {
  const env = { [GATEWAY_ENV]: 'testep' };
  assert.deepEqual(resolveFleetTask(ULID, 'testep', { env }), { ok: true, id: ULID });
  assert.deepEqual(resolveFleetTask(ULID, 'TESTEP', { env }), { ok: true, id: ULID }); // case-insensitive
  assert.deepEqual(resolveFleetTask(ULID, 'qwen_local', { env: { [GATEWAY_ENV]: 'QWEN_LOCAL' } }), { ok: true, id: ULID });
  assert.deepEqual(resolveFleetTask(ULID, '', { env }), { ok: true, id: '' }); // no endpoint name
  assert.deepEqual(resolveFleetTask(ULID, undefined, { env }), { ok: true, id: '' });
  assert.deepEqual(resolveFleetTask(ULID, 'glm', { env }), { ok: true, id: '' }); // not allowlisted
  assert.deepEqual(resolveFleetTask('', 'testep', { env }), { ok: true, id: '' }); // id unset
  assert.deepEqual(resolveFleetTask(undefined, 'testep', { env }), { ok: true, id: '' });
  assert.deepEqual(resolveFleetTask('01ABC\nX-Evil: 1', 'testep', { env }), { ok: false, id: '' }); // gateway + bad id -> warn
  assert.deepEqual(resolveFleetTask('01ABC\nX-Evil: 1', 'glm', { env }), { ok: true, id: '' }); // non-gateway -> no warning
});

test('CLI: --endpoint gates the header line on stdout', () => {
  const self = path.join(__dirname, 'fleet-task-header.js');
  const run = (args, env) => execFileSync('node', [self, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  const base = { [GATEWAY_ENV]: 'testep', AUTOPILOT_UPSTREAM_TASK_ID: ULID };
  assert.equal(run(['--rail', 'r', '--endpoint', 'testep'], base), `X-Fleet-Task: ${ULID}\n`);
  assert.equal(run(['--rail', 'r', '--endpoint', 'glm'], base), ''); // not allowlisted
  assert.equal(run(['--rail', 'r'], base), ''); // no endpoint name
});
