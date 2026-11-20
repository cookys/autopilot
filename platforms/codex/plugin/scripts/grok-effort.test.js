#!/usr/bin/env node
'use strict';
// Unit tests for scripts/lib/grok-effort.js — synthetic only; bash path uses AUTOPILOT_GROK_EFFORT_PROBE=0
// or a PATH stub grok so no real CLI is spawned.
// Run: node --test scripts/grok-effort.test.js < /dev/null

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { grokEffortClamp } = require('./lib/grok-effort');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-effort-test-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function withProbeOff(fn) {
  const prev = process.env.AUTOPILOT_GROK_EFFORT_PROBE;
  process.env.AUTOPILOT_GROK_EFFORT_PROBE = '0';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AUTOPILOT_GROK_EFFORT_PROBE;
    else process.env.AUTOPILOT_GROK_EFFORT_PROBE = prev;
  }
}

function withStubGrok(body, fn) {
  const bindir = path.join(TMP, `bin-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(bindir);
  const grok = path.join(bindir, 'grok');
  fs.writeFileSync(grok, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const prevPath = process.env.PATH;
  const prevProbe = process.env.AUTOPILOT_GROK_EFFORT_PROBE;
  process.env.PATH = `${bindir}:${prevPath || ''}`;
  delete process.env.AUTOPILOT_GROK_EFFORT_PROBE;
  try {
    return fn(grok);
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevProbe === undefined) delete process.env.AUTOPILOT_GROK_EFFORT_PROBE;
    else process.env.AUTOPILOT_GROK_EFFORT_PROBE = prevProbe;
  }
}

test('grokEffortClamp: accepted levels pass through (probe disabled)', () => {
  withProbeOff(() => {
    for (const e of ['low', 'medium', 'high', 'xhigh']) {
      assert.equal(grokEffortClamp(e, '', 'grok'), e, `effort ${e}`);
    }
  });
});

test('grokEffortClamp: max, empty, and unknown clamp to xhigh (probe disabled)', () => {
  withProbeOff(() => {
    assert.equal(grokEffortClamp('max', '', 'grok'), 'xhigh');
    assert.equal(grokEffortClamp('', '', 'grok'), 'xhigh');
    assert.equal(grokEffortClamp(undefined, '', 'grok'), 'xhigh');
    assert.equal(grokEffortClamp('bogus', '', 'grok'), 'xhigh');
  });
});

test('grokEffortClamp: live enum via stub grok — xhigh rejected for grok-4.5', () => {
  withStubGrok(
    'echo "unknown effort level xhigh; use one of: high, medium, low" >&2; exit 1',
    (grok) => {
      assert.equal(grokEffortClamp('xhigh', 'grok-4.5', grok), 'high');
      assert.equal(grokEffortClamp('max', 'grok-4.5', grok), 'high');
      assert.equal(grokEffortClamp('low', 'grok-4.5', grok), 'low');
    },
  );
});

test('grokEffortClamp: live enum accepts xhigh for grok-4.7 stub', () => {
  withStubGrok(
    'echo "unknown effort level __probe__; use one of: xhigh, high, medium, low" >&2; exit 1',
    (grok) => {
      assert.equal(grokEffortClamp('xhigh', 'grok-4.7', grok), 'xhigh');
    },
  );
});

test('grokEffortClamp: missing grok binary falls back to static table', () => {
  withProbeOff(() => {
    assert.equal(grokEffortClamp('high', 'grok-4.7', '/nonexistent-grok-binary-12345'), 'high');
    assert.equal(grokEffortClamp('max', 'grok-4.7', '/nonexistent-grok-binary-12345'), 'xhigh');
  });
});