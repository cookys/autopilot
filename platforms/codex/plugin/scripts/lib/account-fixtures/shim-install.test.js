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

// ---- BL-0372 Task 3: dual-format fixture (json and stream-json rendered from one `result` object)
const { installShim, DUAL_OK } = require('./shim-install.js');
const os = require('os');

function runShim(shimPath, argv) {
  return spawnSync(shimPath, argv, { env: { PATH: process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: 'FAKE-dual', HOME: '/nonexistent' }, encoding: 'utf8' });
}
// The equality the fixture promises: the last stream line equals the json output byte for byte.
function dualEqual(shimPath) {
  const j = runShim(shimPath, ['-p', 'x', '--output-format', 'json']).stdout;
  const s = runShim(shimPath, ['-p', 'x', '--output-format', 'stream-json', '--verbose']).stdout;
  const lines = s.split('\n').filter(Boolean);
  return { j, s, lines, equal: lines[lines.length - 1] + '\n' === j };
}
function tmpShim(control, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-shim-'));
  const sh = installShim(root, { default: control });
  if (mutate) {
    const before = fs.readFileSync(sh.shimPath, 'utf8');
    const after = mutate(before);
    assert.notStrictEqual(after, before, 'the mutation did not change the shim source (the negative control would be vacuous)');
    fs.writeFileSync(sh.shimPath, after);
  }
  return { root, sh };
}

test('dual format: same result object, last stream line equals the json output byte for byte', () => {
  const { root, sh } = tmpShim(DUAL_OK);
  const r = dualEqual(sh.shimPath);
  assert.strictEqual(r.equal, true);
  assert.strictEqual(r.j, JSON.stringify(DUAL_OK.result) + '\n');
  assert.deepStrictEqual(r.lines.slice(0, -1).map((l) => JSON.parse(l).type), ['system', 'assistant', 'rate_limit_event']);
  assert.strictEqual(runShim(sh.shimPath, ['-p', 'x']).stdout, 'OK\n'); // no --output-format: text
  assert.strictEqual(sh.calls().length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dual format: stream_result_extra models a stream result line with extra keys (equality then fails on purpose)', () => {
  const { root, sh } = tmpShim(Object.assign({}, DUAL_OK, { stream_result_extra: { model_usage_since_last_result: {} } }));
  const r = dualEqual(sh.shimPath);
  assert.strictEqual(r.equal, false);
  assert.ok(Object.keys(JSON.parse(r.lines[r.lines.length - 1])).includes('model_usage_since_last_result'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('negative control: a shim that renders the two formats from different results is caught', () => {
  const { root, sh } = tmpShim(DUAL_OK, (src) => src.replace("      last,\n", "      last.replace('\"num_turns\":1', '\"num_turns\":2'),\n"));
  assert.strictEqual(dualEqual(sh.shimPath).equal, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy path unchanged: a static stdout response is returned verbatim whatever the --output-format says', () => {
  const stat = { exit: 0, stdout: '{"type":"result","is_error":false,"result":"STATIC"}\n' };
  const { root, sh } = tmpShim(stat);
  for (const fmt of ['json', 'stream-json']) {
    assert.strictEqual(runShim(sh.shimPath, ['-p', 'x', '--output-format', fmt]).stdout, stat.stdout);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('dual format keeps the token out of stdout/log (no leak mode set)', () => {
  const { root, sh } = tmpShim(DUAL_OK);
  const r = runShim(sh.shimPath, ['-p', 'x', '--output-format', 'stream-json']);
  assert.ok(!r.stdout.includes('FAKE-dual'));
  assert.ok(!fs.readFileSync(sh.log, 'utf8').includes('FAKE-dual'));
  fs.rmSync(root, { recursive: true, force: true });
});
