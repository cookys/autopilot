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

test('(e) dispatch structured size vs task Size: mismatch, fallback, invalid, and missing', () => {
  const prevOptIn = process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD;
  process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD = '1';
  const pmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wog-pm-size-'));
  fs.mkdirSync(path.join(pmRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(pmRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(pmRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(pmRoot, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }));
  try {
    const mk = (task, size) => ({
      tool_name: 'mcp__fleet__dispatch',
      cwd: pmRoot,
      tool_input: size === undefined ? { to: 'dev/courier/worker', task } : { to: 'dev/courier/worker', size, task },
    });

    // 正例：結構化 size=M、內文 Size: M、有 Plan，放行
    assert.equal(decide(mk('Size: M\nPlan: x/y.md@abcdef1', 'M')), null);

    // 反例（核心）：結構化 size=S、內文 Size: L + Plan，被拒，理由含兩個值
    const mismatchSL = decide(mk('Size: L\nPlan: x/y.md@abcdef1', 'S'));
    assert.equal(mismatchSL.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(mismatchSL.hookSpecificOutput.permissionDecisionReason, /size=S/);
    assert.match(mismatchSL.hookSpecificOutput.permissionDecisionReason, /Size:\s*L/);

    // 反例（反向）：結構化 size=L、內文 Size: S，被拒
    const mismatchLS = decide(mk('Size: S\n小任務', 'L'));
    assert.equal(mismatchLS.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(mismatchLS.hookSpecificOutput.permissionDecisionReason, /size=L/);
    assert.match(mismatchLS.hookSpecificOutput.permissionDecisionReason, /Size:\s*S/);

    // 結構化 size=M、內文沒寫 Size、沒有 plan：被拒（缺 plan）
    const mNoPlan = decide(mk('沒有寫 Size 也沒有 plan', 'M'));
    assert.equal(mNoPlan.hookSpecificOutput.permissionDecision, 'deny');

    // 結構化 size=S、內文沒寫 Size：放行
    assert.equal(decide(mk('沒有寫 Size 的小任務', 'S')), null);

    // 結構化 size=XXL 與結構化 size=m（小寫）：被拒
    assert.equal(decide(mk('Size: M\nPlan: x/y.md@abcdef1', 'XXL')).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(decide(mk('Size: M\nPlan: x/y.md@abcdef1', 'm')).hookSpecificOutput.permissionDecision, 'deny');

    // 兩者都沒有：被拒（原行為）
    assert.equal(decide(mk('沒有寫 Size')).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    if (prevOptIn === undefined) delete process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD;
    else process.env.AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD = prevOptIn;
    fs.rmSync(pmRoot, { recursive: true, force: true });
  }
});
