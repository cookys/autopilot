#!/usr/bin/env node
'use strict';
// A directly run *.test.js does not go through hooks/tests/lib.sh, so it never inherits
// AUTOPILOT_RUNNER_HOME_FALLBACK=off. Under `node --test` (NODE_TEST_CONTEXT set) an UNSET knob
// therefore counts as off: a runner installed under the real HOME is never reached and never paid for.
//   1 PATH holds no codex, HOME holds a fixture codex, knob unset -> not resolved
//   2 knob explicitly "on" -> the fixture codex resolves
// Negative control: hooks/tests/lib.sh sed_mutant drops the NODE_TEST_CONTEXT clause; case 1 goes red.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveBinaryPath } = require('./lib/runner-binary.js');

function withFixture(knob, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhf-'));
  const bin = path.join(root, 'home', '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME, K: process.env.AUTOPILOT_RUNNER_HOME_FALLBACK };
  process.env.PATH = path.join(root, 'empty');
  process.env.HOME = path.join(root, 'home');
  if (knob === undefined) delete process.env.AUTOPILOT_RUNNER_HOME_FALLBACK;
  else process.env.AUTOPILOT_RUNNER_HOME_FALLBACK = knob;
  try { return fn(path.join(bin, 'codex')); } finally {
    process.env.PATH = saved.PATH; process.env.HOME = saved.HOME;
    if (saved.K === undefined) delete process.env.AUTOPILOT_RUNNER_HOME_FALLBACK;
    else process.env.AUTOPILOT_RUNNER_HOME_FALLBACK = saved.K;
  }
}

test('node --test sets NODE_TEST_CONTEXT', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT);
});

test('unset knob under node --test: a codex under HOME is not resolved', () => {
  withFixture(undefined, () => assert.strictEqual(resolveBinaryPath('codex', 'codex'), null));
});

test('explicit on under node --test: the fixture codex under HOME resolves', () => {
  withFixture('on', (fx) => assert.strictEqual(resolveBinaryPath('codex', 'codex'), fx));
});
