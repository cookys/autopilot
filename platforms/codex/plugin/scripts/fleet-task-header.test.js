#!/usr/bin/env node
'use strict';
// Unit tests for scripts/lib/fleet-task-header.js (synthetic config + env only).
// Run: node --test scripts/fleet-task-header.test.js < /dev/null

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  HEADER_NAME,
  SOURCE_ENV,
  GATEWAY_ENV,
  GATEWAY_CONFIG_KEY,
  parseGatewayAllowlist,
  readGatewayAllowlist,
  resolveFleetTask,
  headerLine,
  warnLine,
} = require('./lib/fleet-task-header');

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-task-hdr-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('parseGatewayAllowlist: non-string non-array yields empty list', () => {
  assert.deepEqual(parseGatewayAllowlist(42), []);
  assert.deepEqual(parseGatewayAllowlist({}), []);
});

test('parseGatewayAllowlist: deduplicates after normalization', () => {
  assert.deepEqual(parseGatewayAllowlist('glm, GLM , glm'), ['glm']);
});

test('readGatewayAllowlist: config.json when env unset', () => {
  const home = path.join(TMP, 'cfg-home');
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.autopilot', 'config.json'),
    JSON.stringify({ [GATEWAY_CONFIG_KEY]: ['Qwen_Local', ''] }),
  );
  const env = { HOME: home };
  assert.deepEqual(readGatewayAllowlist({ env, home }), ['qwen_local']);
});

test('resolveFleetTask + headerLine + warnLine', () => {
  const env = { [GATEWAY_ENV]: 'testep' };
  const ok = resolveFleetTask(ULID, 'testep', { env });
  assert.deepEqual(ok, { ok: true, id: ULID });
  assert.equal(headerLine(ok.id), `${HEADER_NAME}: ${ULID}`);
  assert.equal(headerLine(''), '');
  const bad = resolveFleetTask('not-a-ulid', 'testep', { env });
  assert.deepEqual(bad, { ok: false, id: '' });
  assert.equal(headerLine(bad.id), '');
  assert.equal(warnLine('dispatch-review'), `dispatch-review: ${SOURCE_ENV} is not a ULID; ${HEADER_NAME} not sent`);
});

test('CLI entry: invalid ULID on allowlisted endpoint writes warn to stderr, no stdout header', () => {
  const lib = path.join(__dirname, 'lib', 'fleet-task-header.js');
  const r = spawnSync(process.execPath, [lib, '--rail', 'r', '--endpoint', 'testep'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      HOME: TMP,
      TMPDIR: TMP,
      [GATEWAY_ENV]: 'testep',
      [SOURCE_ENV]: 'bad-id',
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not a ULID/);
});

test('CLI entry: valid ULID prints header line', () => {
  const lib = path.join(__dirname, 'lib', 'fleet-task-header.js');
  const r = spawnSync(process.execPath, [lib, '--rail', 'r', '--endpoint', 'testep'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      HOME: TMP,
      TMPDIR: TMP,
      [GATEWAY_ENV]: 'testep',
      [SOURCE_ENV]: ULID,
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${HEADER_NAME}: ${ULID}\n`);
});