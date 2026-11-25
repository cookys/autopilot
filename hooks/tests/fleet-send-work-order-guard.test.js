'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide } = require('../fleet-send-work-order-guard');

test('(a) send with task_id parameter is allowed even with imperative phrases', () => {
  const out = decide({
    tool_name: 'mcp__fleet__send',
    tool_input: {
      to: 'dev/courier/worker',
      task_id: '01M838P3WFXNM885HK3S6ZGSXP',
      tag: 'progress',
      content: '請跑完這輪測試並回報結果',
    },
  });
  assert.equal(out, null);
});

test('(b) send and reply with top task_id header line are allowed even with imperative phrases', () => {
  const sendOut = decide({
    tool_name: 'mcp__fleet__send',
    tool_input: {
      to: 'dev/courier/worker',
      content: 'task_id: 01M838P3WFXNM885HK3S6ZGSXP\n\n請跑完這輪測試並回報結果',
    },
  });
  assert.equal(sendOut, null);

  const replyOut = decide({
    tool_name: 'mcp__fleet__reply',
    tool_input: {
      message_id: 'msg-123',
      content: 'task_id: 01M838P3WFXNM885HK3S6ZGSXP\n\n請修好這個測試並回報',
    },
  });
  assert.equal(replyOut, null);
});

test('(c) send without task context is denied with a copyable dispatch example', () => {
  const out = decide({
    tool_name: 'mcp__fleet__send',
    tool_input: {
      to: 'dev/courier/worker',
      content: '請跑完這輪測試並回報結果',
    },
  });
  assert.ok(out && out.hookSpecificOutput);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /mcp__fleet__dispatch/);
  assert.match(reason, /\bto:/);
  assert.match(reason, /\bcontent:/);
  assert.match(reason, /Engine:/);
  assert.match(reason, /Role:/);
  assert.match(reason, /Lane:/);
  assert.match(reason, /Size:/);
});

test('(d) dispatch plan gate: regular Plan, legacy .md@sha warning, plan loop, plan-exempt, and negative cases', () => {
  const prevOptIn = process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD;
  process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD = '1';
  const pmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wog-pm-'));
  fs.mkdirSync(path.join(pmRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(pmRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(pmRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(pmRoot, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }));
  try {
    const mk = (task) => ({ tool_name: 'mcp__fleet__dispatch', cwd: pmRoot, tool_input: { to: 'dev/courier/worker', task } });

    // Regular Plan: allowed, no warning
    assert.equal(decide(mk('Size: M\nPlan: x/y.md@abcdef1')), null);

    // Missing plan on Size M: denied
    const noPlan = decide(mk('Size: M\n沒有 plan 標記'));
    assert.equal(noPlan.hookSpecificOutput.permissionDecision, 'deny');

    // Legacy .md@sha without Plan: header: allowed with PreToolUse additionalContext warning
    const legacy = decide(mk('Size: M\n見 knowledge/plans/2026-11-25-fleet-routing-mechanization.md@64d739bf5a34'));
    assert.equal(legacy.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(legacy.hookSpecificOutput.permissionDecision, undefined);
    assert.match(legacy.hookSpecificOutput.additionalContext, /Plan: <路徑>@<sha>/);

    // Legacy .md@ with <7 hex chars: denied
    const shortSha = decide(mk('Size: M\n見 a.md@abc123'));
    assert.equal(shortSha.hookSpecificOutput.permissionDecision, 'deny');

    // plan-first, plan loop, plan-loop: allowed
    assert.equal(decide(mk('Size: L\nPlan: plan-first')), null);
    assert.equal(decide(mk('Size: L\n跑 plan loop')), null);
    assert.equal(decide(mk('Size: L\n跑 plan-loop')), null);

    // bare 'plan' or 'planloop': denied
    assert.equal(decide(mk('Size: L\n只有 plan 一個字')).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(decide(mk('Size: L\nplanloop')).hookSpecificOutput.permissionDecision, 'deny');

    // [plan-exempt: reason]: allowed; empty reason: denied
    assert.equal(decide(mk('Size: M\n[plan-exempt: 純文件錯字修正]')), null);
    assert.equal(decide(mk('Size: M\n[plan-exempt: ]')).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(decide(mk('Size: M\n[plan-exempt:]')).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    if (prevOptIn === undefined) delete process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD;
    else process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD = prevOptIn;
    fs.rmSync(pmRoot, { recursive: true, force: true });
  }
});
