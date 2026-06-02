/**
 * Tests for suggest-compact: pure threshold lib + the ENXIO-survival regression.
 * Run: node --test hooks/suggest-compact.test.js
 *
 * The regression these guard (v2.8.1): the /dev/stdin read used to be the first
 * statement in the sole try, so ENXIO (broken stdin pipe, #6305) aborted before
 * the counter ever incremented — the hook was silently dead. The wrapper now
 * isolates the stdin read and increments regardless.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { compactDecision, FIRST_THRESHOLD, INTERVAL } = require('./suggest-compact-lib.js');
const SCRIPT = path.join(__dirname, 'suggest-compact.js');

// ──────────────── compactDecision: threshold boundaries ────────────────

test('compactDecision: silent below first threshold (49)', () => {
  assert.equal(compactDecision(49).warn, false);
});

test('compactDecision: warns at first threshold (50) with first-level message', () => {
  const d = compactDecision(50);
  assert.equal(d.warn, true);
  assert.equal(d.level, 'first');
  assert.match(d.message, /Consider running \/compact/);
});

test('compactDecision: silent between thresholds (51..74)', () => {
  for (let c = 51; c <= 74; c++) assert.equal(compactDecision(c).warn, false, `count ${c} should be silent`);
});

test('compactDecision: warns at first interval (75) with interval-level message', () => {
  const d = compactDecision(75);
  assert.equal(d.warn, true);
  assert.equal(d.level, 'interval');
  assert.match(d.message, /Strongly recommend \/compact/);
});

test('compactDecision: unbounded — warns at 100 and 125, not capped at 100', () => {
  assert.equal(compactDecision(100).warn, true);
  assert.equal(compactDecision(125).warn, true);
  assert.equal(compactDecision(110).warn, false);
});

test('compactDecision: guards non-positive / non-integer counts', () => {
  assert.equal(compactDecision(0).warn, false);
  assert.equal(compactDecision(-5).warn, false);
  assert.equal(compactDecision(50.5).warn, false);
});

test('compactDecision: constants match documented behavior', () => {
  assert.equal(FIRST_THRESHOLD, 50);
  assert.equal(INTERVAL, 25);
});

// ──────────────── wrapper: counter increments without a real stdin payload ────────────────
// Runs the actual hook in a subprocess with stdin = /dev/null (the no-payload
// case) and an isolated TMPDIR + fixed session id, proving the counter advances
// each invocation regardless of stdin — the exact behaviour the ENXIO bug broke.

function runHook(tmpdir, sessionId) {
  return spawnSync(process.execPath, [SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'], // stdin=/dev/null
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmpdir, CLAUDE_CODE_SESSION_ID: sessionId },
  });
}

test('wrapper: counter increments across invocations and nudges at the threshold', () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-compact-test-'));
  const sessionId = 'test-session-abc';
  const countFile = path.join(tmpdir, `claude-tool-count-${sessionId}`);
  try {
    let lastFirstThresholdStderr = '';
    for (let i = 1; i <= FIRST_THRESHOLD; i++) {
      const r = runHook(tmpdir, sessionId);
      assert.equal(r.status, 0, 'hook must exit 0 (fail-open)');
      const count = parseInt(fs.readFileSync(countFile, 'utf8'), 10);
      assert.equal(count, i, `after invocation ${i} the counter must equal ${i}`);
      if (i === FIRST_THRESHOLD) lastFirstThresholdStderr = r.stderr;
    }
    // The 50th call must emit the first-threshold nudge to stderr.
    assert.match(lastFirstThresholdStderr, /Consider running \/compact/);
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test('wrapper: counter STILL increments when the stdin read throws (the ENXIO regression)', () => {
  // /dev/null returns '' without throwing, so it cannot exercise the bug. Point the
  // read at a guaranteed-throwing path: this reproduces the failure mode the broken
  // stdin pipe (#6305) caused. The pre-v2.8.1 structure (read as the first statement
  // of the sole try) would abort here and never increment; the isolated inner-try
  // structure must swallow it and still count.
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-compact-test-'));
  const sessionId = 'test-session-enxio';
  const countFile = path.join(tmpdir, `claude-tool-count-${sessionId}`);
  const throwingPath = path.join(tmpdir, 'does-not-exist', 'stdin'); // ENOENT on read
  try {
    for (let i = 1; i <= 3; i++) {
      const r = spawnSync(process.execPath, [SCRIPT], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: {
          ...process.env,
          TMPDIR: tmpdir,
          CLAUDE_CODE_SESSION_ID: sessionId,
          AUTOPILOT_SUGGEST_COMPACT_STDIN: throwingPath,
        },
      });
      assert.equal(r.status, 0, 'hook must exit 0 (fail-open) even when the stdin read throws');
      const count = parseInt(fs.readFileSync(countFile, 'utf8'), 10);
      assert.equal(count, i, `counter must reach ${i} despite the stdin read throwing`);
    }
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test('wrapper: AUTOPILOT_SUGGEST_COMPACT=false opts out (no counter file written)', () => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-compact-test-'));
  const sessionId = 'test-session-optout';
  const countFile = path.join(tmpdir, `claude-tool-count-${sessionId}`);
  try {
    const r = spawnSync(process.execPath, [SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: tmpdir, CLAUDE_CODE_SESSION_ID: sessionId, AUTOPILOT_SUGGEST_COMPACT: 'false' },
    });
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(countFile), false, 'opt-out must skip before writing the counter');
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});
