#!/usr/bin/env node
'use strict';
// G37 P3: the shim and its install helper (installed copy is mode 0755, logs fingerprint not token, simulates ambient fallback only via env paths).
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeFixture, R429 } = require('./shim-install.js');

function callShim(fx, env) {
  return spawnSync(path.join(fx.shim.binDir, 'claude'), ['-p', 'x'], { env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8' });
}

test('installed shim is a 0755 copy; logs fingerprint, never the token', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  const st = fs.lstatSync(fx.shim.shimPath);
  assert.ok(st.isFile() && (st.mode & 0o777) === 0o755);
  const r = callShim(fx, { CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-zz', HOME: '/nonexistent' });
  assert.strictEqual(r.status, 0);
  const raw = fs.readFileSync(fx.shim.log, 'utf8');
  assert.ok(!raw.includes('FAKE-zz'));
  assert.strictEqual(fx.shim.calls()[0].fp.length, 8);
  fx.cleanup();
});

test('ambient fallback is simulated only when a credential file is reachable via HOME or CLAUDE_CONFIG_DIR', () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  fx.shim.setControl({ default: R429 });
  assert.strictEqual(callShim(fx, { CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-zz', HOME: '/nonexistent' }).status, 1);
  const r = callShim(fx, { CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-zz', HOME: fx.realHome });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fx.shim.calls()[1].decoy_read, true);
  fx.cleanup();
});
