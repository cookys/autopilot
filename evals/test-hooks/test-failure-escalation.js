#!/usr/bin/env node
/**
 * Unit test for failure-escalation.js hook logic.
 * Tests escalation levels, counter reset, false positive resistance, session isolation.
 *
 * No API calls — tests pure hook logic with mock stdin.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_PATH = path.join(__dirname, '..', '..', 'hooks', 'failure-escalation.js');
const STATE_DIR = path.join(os.homedir(), '.autopilot');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL: ${name} — ${e.message}`);
    fail++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function cleanup() {
  // Remove ALL counter files (session hashes, not "test" prefix)
  try {
    const files = fs.readdirSync(STATE_DIR).filter(f => f.startsWith('.failure_count_'));
    files.forEach(f => fs.unlinkSync(path.join(STATE_DIR, f)));
  } catch { /* ignore */ }
}

function runHook(input) {
  const inputStr = JSON.stringify(input);
  try {
    const output = execFileSync('node', [HOOK_PATH], {
      input: inputStr,
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    return output;
  } catch (e) {
    // execFileSync throws on non-zero exit, but our hook always exits 0
    return e.stdout || '';
  }
}

function makeInput(exitCode, output, sessionId) {
  return {
    tool_name: 'Bash',
    session_id: sessionId || 'test-session-001',
    exit_code: exitCode,
    tool_output: output || '',
  };
}

// ─── Tests ───

console.log('=== failure-escalation.js Unit Tests ===\n');

cleanup();

test('Non-Bash tool is ignored', () => {
  const out = runHook({ tool_name: 'Read', exit_code: 1, session_id: 'test-nonbash' });
  assert(out.trim() === '', 'Should produce no output for non-Bash tool');
});

test('First failure (L0) produces no injection', () => {
  cleanup();
  const out = runHook(makeInput(1, 'error: something failed', 'test-l0'));
  assert(out.trim() === '', 'L0 should produce no injection');
});

test('Second failure (L1) injects switch-approach message', () => {
  cleanup();
  runHook(makeInput(1, 'error 1', 'test-l1'));
  const out = runHook(makeInput(1, 'error 2', 'test-l1'));
  assert(out.includes('L1'), 'Should contain L1 marker');
  assert(out.includes('fundamentally different'), 'Should suggest different approach');
});

test('Third failure (L2) injects 5 mandatory steps', () => {
  cleanup();
  runHook(makeInput(1, 'err', 'test-l2'));
  runHook(makeInput(1, 'err', 'test-l2'));
  const out = runHook(makeInput(1, 'err', 'test-l2'));
  assert(out.includes('L2'), 'Should contain L2 marker');
  assert(out.includes('hypotheses'), 'Should mention hypotheses');
});

test('Fourth failure (L3) injects 7-point checklist', () => {
  cleanup();
  for (let i = 0; i < 3; i++) runHook(makeInput(1, 'err', 'test-l3'));
  const out = runHook(makeInput(1, 'err', 'test-l3'));
  assert(out.includes('L3'), 'Should contain L3 marker');
  assert(out.includes('opposite assumption'), 'Should include checklist items');
});

test('Fifth failure (L4) injects structured report requirement', () => {
  cleanup();
  for (let i = 0; i < 4; i++) runHook(makeInput(1, 'err', 'test-l4'));
  const out = runHook(makeInput(1, 'err', 'test-l4'));
  assert(out.includes('L4'), 'Should contain L4 marker');
  assert(out.includes('Verified facts'), 'Should require structured report');
});

test('Success resets counter', () => {
  cleanup();
  runHook(makeInput(1, 'err', 'test-reset'));
  runHook(makeInput(1, 'err', 'test-reset'));
  // Now success
  runHook(makeInput(0, 'ok', 'test-reset'));
  // Next failure should be count=1 (L0, no injection)
  const out = runHook(makeInput(1, 'err', 'test-reset'));
  assert(out.trim() === '', 'After reset, first failure should be L0 (no injection)');
});

test('FALSE POSITIVE: exit 0 with bare "error" keyword does NOT escalate', () => {
  cleanup();
  // Simulate: grep error logfile.txt → exit 0, output contains "error"
  runHook(makeInput(0, 'error: found in line 42\nerror: found in line 87', 'test-fp'));
  const out = runHook(makeInput(0, 'error: found in line 99', 'test-fp'));
  assert(out.trim() === '', 'Exit 0 with bare "error" should NOT trigger escalation');
});

test('Exit 0 with strong pattern (Traceback) DOES escalate', () => {
  cleanup();
  const pyError = 'Traceback (most recent call last):\n  File "test.py", line 1\nNameError: x';
  runHook(makeInput(0, pyError, 'test-strong'));
  const out = runHook(makeInput(0, pyError, 'test-strong'));
  assert(out.includes('L1'), 'Exit 0 with Traceback should trigger L1');
});

test('Session isolation: different sessions have separate counters', () => {
  cleanup();
  // Session A: 2 failures → L1
  runHook(makeInput(1, 'err', 'test-iso-a'));
  const outA = runHook(makeInput(1, 'err', 'test-iso-a'));
  assert(outA.includes('L1'), 'Session A should be at L1');

  // Session B: first failure → L0 (no injection)
  const outB = runHook(makeInput(1, 'err', 'test-iso-b'));
  assert(outB.trim() === '', 'Session B should be at L0 (independent counter)');
});

test('Malformed JSON input fails gracefully', () => {
  try {
    execFileSync('node', [HOOK_PATH], {
      input: 'not json at all',
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) {
    // Should still exit 0 (fail-open)
    assert(e.status === 0 || e.status === null, 'Should exit 0 on malformed input');
  }
  // If it didn't throw, that's also fine (exit 0)
});

cleanup();

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
