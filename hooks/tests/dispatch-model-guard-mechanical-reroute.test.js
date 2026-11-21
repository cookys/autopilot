#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '../dispatch-model-guard.js');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mech-reroute-test-'));
const fakeCwd = path.join(tmpRoot, 'cwd');
const fakeRuntime = path.join(tmpRoot, 'runtime');
fs.mkdirSync(fakeCwd, { recursive: true });
fs.mkdirSync(fakeRuntime, { recursive: true });

function runHook(payload, extraEnv = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: fakeRuntime,
      AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind',
      ...extraEnv,
    },
  });
  let out = null;
  try { out = JSON.parse(res.stdout.trim()); } catch { out = null; }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, out };
}

const logPath = path.join(fakeRuntime, 'autopilot', 'mechanical-reroute-shadow.jsonl');

// 1. Lead seat with Role: stats and subagent_type general-purpose:
//    - shadow mode: allowed and one log line written
const shadowRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet\nRole: stats\nLane: test-lane\nDo stats.',
  },
}, { AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: 'shadow' });
assert.strictEqual(shadowRes.status, 0);
assert.strictEqual(shadowRes.out?.hookSpecificOutput?.permissionDecision, undefined, 'shadow mode must allow');
const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 1, 'shadow mode must write 1 log line');
const row = JSON.parse(lines[0]);
assert.strictEqual(row.seat, 'lead');
assert.strictEqual(row.role, 'stats');
assert.strictEqual(row.subagent_type, 'general-purpose');
assert.strictEqual(row.Lane, 'test-lane');

//    - enforce mode: denied and reason holds re-dispatch command
const enforceRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet\nRole: stats\nDo stats.',
  },
}, { AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: 'enforce' });
assert.strictEqual(enforceRes.out?.hookSpecificOutput?.permissionDecision, 'deny');
assert.ok(enforceRes.out.hookSpecificOutput.permissionDecisionReason.includes('scripts/dispatch-hetero.sh'));

// 2. Role: reviewer: allowed with no log line
const beforeCount = fs.readFileSync(logPath, 'utf8').trim().split('\n').length;
const reviewerRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet\nRole: reviewer\nReview code.',
  },
}, { AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: 'shadow' });
assert.strictEqual(reviewerRes.status, 0);
assert.strictEqual(reviewerRes.out?.hookSpecificOutput?.permissionDecision, undefined);
assert.strictEqual(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, beforeCount);

// 3. Non-PM, non-lead seat with Role: stats: untouched
const nonSeatRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet\nRole: stats\nDo stats.',
  },
}, { AUTOPILOT_SEAT_ROLE: '', AUTOPILOT_MECHANICAL_REROUTE: 'enforce' });
assert.strictEqual(nonSeatRes.status, 0);
assert.strictEqual(nonSeatRes.out?.hookSpecificOutput?.permissionDecision, undefined);

// 4. Intentional on enforce: allowed
const intentionalRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet (intentional: need claude context)\nRole: stats\nDo stats.',
  },
}, { AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: 'enforce' });
assert.strictEqual(intentionalRes.status, 0);
assert.strictEqual(intentionalRes.out?.hookSpecificOutput?.permissionDecision, undefined);

// 5. Mode off: untouched
const offRes = runHook({
  tool_name: 'Agent',
  cwd: fakeCwd,
  tool_input: {
    subagent_type: 'general-purpose',
    model: 'sonnet',
    prompt: 'Engine: sonnet\nRole: stats\nDo stats.',
  },
}, { AUTOPILOT_SEAT_ROLE: 'lead', AUTOPILOT_MECHANICAL_REROUTE: 'off' });
assert.strictEqual(offRes.status, 0);
assert.strictEqual(offRes.out?.hookSpecificOutput?.permissionDecision, undefined);

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log('PASS: dispatch-model-guard-mechanical-reroute.test.js');
