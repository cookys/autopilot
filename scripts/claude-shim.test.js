#!/usr/bin/env node
'use strict';
/**
 * Tests for scripts/lib/account-fixtures/claude-shim.js (task alias: claude-shim).
 * Run: node --test scripts/claude-shim.test.js < /dev/null
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { installShim } = require('./lib/account-fixtures/shim-install');

const SHIM_SRC = path.join(__dirname, 'lib', 'account-fixtures', 'claude-shim.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shim-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function runShim(root, shim, argv, env) {
  return spawnSync(process.execPath, [shim.shimPath, ...argv], {
    encoding: 'utf8',
    cwd: root,
    env: Object.assign({
      HOME: root,
      CLAUDE_CONFIG_DIR: path.join(root, 'cfg'),
      CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-shim-token-value',
    }, env),
    timeout: 30_000,
  });
}

const OK_JSON = { exit: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }) + '\n' };

test('default control writes log and returns configured stdout', () => {
  const { shim } = (() => {
    const fx = installShim(path.join(TMP, 'def'), { default: OK_JSON });
    return { shim: fx };
  })();
  const root = path.dirname(shim.binDir);
  const res = runShim(root, shim, ['--print', 'hi']);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('"result":"OK"') || res.stdout.includes('OK'));
  assert.equal(shim.spawns(), 1);
  const row = shim.calls()[0];
  assert.ok(Array.isArray(row.argv));
  assert.equal(row.fp, crypto.createHash('sha256').update('FAKE-shim-token-value').digest('hex').slice(0, 8));
  assert.equal(row.decoy_read, false);
});

test('per-token response overrides default', () => {
  const tok = 'FAKE-tok-A';
  const fx = installShim(path.join(TMP, 'tok'), {
    default: { exit: 1, stderr: 'nope\n' },
    tokens: { [tok]: { exit: 0, stdout: 'TOKEN-OK\n' } },
  });
  const res = spawnSync(process.execPath, [fx.shimPath], {
    encoding: 'utf8',
    cwd: path.join(TMP, 'tok'),
    env: { HOME: path.join(TMP, 'tok'), CLAUDE_CODE_OAUTH_TOKEN: tok },
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), 'TOKEN-OK');
});

test('--output-format json renders result object', () => {
  const dual = {
    exit: 0,
    result: { type: 'result', subtype: 'success', is_error: false, result: 'RENDERED', session_id: 'S1' },
  };
  const fx = installShim(path.join(TMP, 'jsonfmt'), { default: dual });
  const res = runShim(path.join(TMP, 'jsonfmt'), fx, ['--output-format', 'json'], {
    CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-json',
  });
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.result, 'RENDERED');
});

test('missing control file exits non-zero', () => {
  const bin = path.join(TMP, 'nobin');
  fs.mkdirSync(bin, { recursive: true });
  const shimPath = path.join(bin, 'claude');
  fs.copyFileSync(SHIM_SRC, shimPath);
  fs.chmodSync(shimPath, 0o755);
  const res = spawnSync(process.execPath, [shimPath], {
    encoding: 'utf8',
    cwd: bin,
    env: { HOME: TMP },
  });
  assert.notEqual(res.status, 0);
});

test('ambient decoy credentials path yields ambient envelope', () => {
  const root = path.join(TMP, 'decoy');
  fs.mkdirSync(root, { recursive: true });
  const cfg = path.join(root, 'cfg');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, '.credentials.json'), '{"synthetic":true}\n');
  const fx = installShim(root, { default: OK_JSON });
  const res = runShim(root, fx, [], {
    CLAUDE_CODE_OAUTH_TOKEN: '',
    CLAUDE_CONFIG_DIR: cfg,
    HOME: root,
  });
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('OK-FROM-AMBIENT'));
  assert.equal(fx.calls()[0].decoy_read, true);
});