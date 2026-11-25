#!/usr/bin/env node
/**
 * quota-wait-guard.test.js — Negative control tests for quota-wait-check,
 * fleet-quota-wait-guard hook, and quota-wait-sweep.
 * Uses fake JSON files only; never calls real `fleet` or touches ~/.claude.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkEngineQuota } = require('./quota-wait-check.js');
const { evaluateQuotaWaitGuard } = require('../hooks/fleet-quota-wait-guard.js');
const { sweepQuotaWaitTasks } = require('./quota-wait-sweep.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-wait-test-'));
const fakeQuotaFile = path.join(tmpDir, 'fleet-quota.json');
const fakeTasksFile = path.join(tmpDir, 'fleet-tasks.json');

fs.writeFileSync(fakeQuotaFile, JSON.stringify({
  observed_at: '2026-11-25T09:00:00Z',
  harness: {
    agy: { pct_5h: 35, pct_7d: 40, reset_at: '2026-11-25T14:00:00Z', observed_at: '2026-11-25T09:00:00Z' },
    codex: { pct_5h: 100, pct_7d: 60, reset_at: '2026-11-25T12:00:00Z', observed_at: '2026-11-25T09:00:00Z' },
  },
}));

fs.writeFileSync(fakeTasksFile, JSON.stringify({
  tasks: [
    { id: '01TESTTASK0000000000000001', status: 'blocked', title: '等 carbon 額度' },
    { id: '01TESTTASK0000000000000002', status: 'open', title: '正常任務' },
  ],
}));

// 1. quota-wait-check: carbon -> agy (has_quota), codex (exhausted), missing file -> unknown
const agyRes = checkEngineQuota('carbon', { quotaJsonFile: fakeQuotaFile });
assert.strictEqual(agyRes.resolved_engine, 'agy');
assert.strictEqual(agyRes.verdict, 'has_quota');

const codexRes = checkEngineQuota('codex', { quotaJsonFile: fakeQuotaFile });
assert.strictEqual(codexRes.verdict, 'exhausted');

const missingRes = checkEngineQuota('agy', { quotaJsonFile: path.join(tmpDir, 'nonexistent.json') });
assert.strictEqual(missingRes.verdict, 'unknown');

// 2. Negative control: "等 carbon 額度" with NO reading -> blocked
const denyNoReading = evaluateQuotaWaitGuard({
  tool_name: 'mcp__fleet__task_comment',
  tool_input: { task_id: '01TESTTASK0000000000000001', text: '等 carbon 額度' },
});
assert.strictEqual(denyNoReading.action, 'deny');

// 3. Negative control: "等 carbon 額度" WITH has_quota reading -> still blocked & prompts direct dispatch
const denyHasQuota = evaluateQuotaWaitGuard({
  tool_name: 'mcp__fleet__task_result',
  tool_input: {
    content: '等 carbon 額度\nquota_reading: engine=agy 5h=35% 7d=40% reset_at=2026-11-25T14:00:00Z observed_at=2026-11-25T09:00:00Z',
  },
});
assert.strictEqual(denyHasQuota.action, 'deny');
assert.ok(denyHasQuota.reason.includes('直接派工'), 'should prompt direct dispatch');

// 4. Positive control: "等 codex 額度" WITH exhausted reading -> allowed
const allowExhausted = evaluateQuotaWaitGuard({
  tool_name: 'mcp__fleet__send',
  tool_input: {
    content: '等 codex 額度\nquota_reading: engine=codex 5h=100% 7d=60% reset_at=2026-11-25T12:00:00Z observed_at=2026-11-25T09:00:00Z',
  },
});
assert.strictEqual(allowExhausted.action, 'allow');

// 5. Knob: warn / off
const warnRes = evaluateQuotaWaitGuard(
  { tool_input: { text: '等 carbon 額度' } },
  { AUTOPILOT_QUOTA_WAIT_GUARD_MODE: 'warn' },
);
assert.strictEqual(warnRes.action, 'warn');

const offRes = evaluateQuotaWaitGuard(
  { tool_input: { text: '等 carbon 額度' } },
  { AUTOPILOT_QUOTA_WAIT_GUARD_MODE: 'off' },
);
assert.strictEqual(offRes.action, 'allow');

// 6. Sweep test (read-only)
const sweep = sweepQuotaWaitTasks({ tasksJsonFile: fakeTasksFile, quotaJsonFile: fakeQuotaFile });
assert.strictEqual(sweep.ok, true);
assert.strictEqual(sweep.rows.length, 1);
assert.strictEqual(sweep.rows[0].engine, 'agy');
assert.strictEqual(sweep.rows[0].verdict, 'has_quota');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('PASS quota-wait-guard.test.js');
