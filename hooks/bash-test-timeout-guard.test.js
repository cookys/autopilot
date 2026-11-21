#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK_PATH = path.resolve(__dirname, 'bash-test-timeout-guard.js');
const { splitShellSegments, checkCommand } = require(HOOK_PATH);

function runHook(command, extraEnv = {}) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
  });
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: payload,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, AUTOPILOT_BASH_TEST_TIMEOUT_NOW: '2026-11-25T00:00:00+08:00', ...extraEnv },
  });
}

test('splitShellSegments splits on &&, ||, ;, |, and newlines outside quotes', () => {
  const segs = splitShellSegments('echo "a && b" && node foo.test.js; pytest || npm test\nbash a.test.sh');
  assert.deepEqual(segs, [
    'echo "a && b"',
    'node foo.test.js',
    'pytest',
    'npm test',
    'bash a.test.sh',
  ]);
});

test('allows test commands prefixed with timeout <n> or <n>s|m', () => {
  assert.equal(checkCommand('timeout 120 node hooks/foo.test.js'), null);
  assert.equal(checkCommand('timeout 120s node --test scripts/bar.test.js'), null);
  assert.equal(checkCommand('timeout 5m bash hooks/tests/bar.test.sh'), null);
  assert.equal(checkCommand('FOO=1 timeout 600 node scripts/affected-suites.js --fast --run'), null);
  assert.equal(checkCommand('timeout 60 pytest'), null);
  assert.equal(checkCommand('timeout 120 python -m pytest'), null);
  assert.equal(checkCommand('timeout 120 npm test'), null);
  assert.equal(checkCommand('timeout 120 npx vitest run'), null);
  assert.equal(checkCommand('timeout 120 jest'), null);
  assert.equal(checkCommand('timeout 60 bash scripts/check-foo.sh'), null);
});

test('blocks test/check commands without timeout prefix', () => {
  const bad = [
    'node hooks/foo.test.js',
    'node --test scripts/bar.test.js',
    'bash hooks/tests/bar.test.sh',
    'sh scripts/foo.test.sh',
    'node scripts/affected-suites.js --fast --run',
    'node scripts/check-hook-inventory.js --check',
    'pytest tests/',
    'python -m pytest',
    'npm test',
    'npx vitest',
    'jest',
    'echo ok && node hooks/foo.test.js',
  ];
  for (const cmd of bad) {
    const res = runHook(cmd);
    assert.equal(res.status, 2, `expected exit 2 for: ${cmd}`);
    assert.match(res.stderr, /timeout 120/);
  }
});

test('allows non-test commands', () => {
  const res = runHook('git status && ls -la');
  assert.equal(res.status, 0);
});

test('allows non-test commands mentioning test runners in args or quotes (false-positive regression)', () => {
  const ok = [
    'grep -rn jest src',
    'cat scripts/check-test-cli-timeout.js',
    'git log --grep pytest',
    'git commit -m "add npm test coverage"',
    'echo jest',
    'timeout 1h node x.test.js',
  ];
  for (const cmd of ok) {
    const res = runHook(cmd, { AUTOPILOT_BASH_TEST_TIMEOUT_NOW: '2026-11-26T00:00:00+08:00' });
    assert.equal(res.status, 0, `expected exit 0 for: ${cmd}`);
  }
});

test('blocks bare test runner invocations at cutoff', () => {
  const bad = [
    'node a.test.js',
    'FOO=1 bash hooks/tests/x.test.sh',
  ];
  for (const cmd of bad) {
    const res = runHook(cmd, { AUTOPILOT_BASH_TEST_TIMEOUT_NOW: '2026-11-26T00:00:00+08:00' });
    assert.equal(res.status, 2, `expected exit 2 for: ${cmd}`);
  }
});

test('AUTOPILOT_BASH_TEST_TIMEOUT=0 disables the guard', () => {
  const res = runHook('node hooks/foo.test.js', { AUTOPILOT_BASH_TEST_TIMEOUT: '0' });
  assert.equal(res.status, 0);
});

test('warns before cutoff and blocks at cutoff', () => {
  const before = runHook('node hooks/foo.test.js', { AUTOPILOT_BASH_TEST_TIMEOUT_NOW: '2026-11-24T23:59:59+08:00' });
  assert.equal(before.status, 0);
  assert.match(JSON.parse(before.stdout).hookSpecificOutput.additionalContext, /warn \(blocking from 2026-11-25T00:00:00\+08:00\)/);
  const at = runHook('node hooks/foo.test.js');
  assert.equal(at.status, 2);
});
