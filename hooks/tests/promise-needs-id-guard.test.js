'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, DENY_REASON } = require('../promise-needs-id-guard');

test('counterexample 1: 已報 PM 開憑證卡 without id is denied', () => {
  const out = decide({
    tool_name: 'Write',
    tool_input: {
      file_path: '/run/user/1000/autopilot/handoff/gpu-lead.md',
      content: '已報 PM 開憑證卡，等操作員處理',
    },
  });
  assert.ok(out && out.hookSpecificOutput);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, DENY_REASON);
});

test('counterexample 2: 等操作員 without id in fleet send is denied', () => {
  const out = decide({
    tool_name: 'mcp__fleet__send',
    tool_input: {
      to: 'pm/console',
      content: '操作員掛載步驟請 PM 轉交，等操作員',
    },
  });
  assert.ok(out && out.hookSpecificOutput);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, DENY_REASON);
});

test('positive cases: d- card id, 26-char fleet id, and no-trigger content are allowed', () => {
  const withCardId = decide({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/my-handoff-notes.md',
      content: '已報 PM 開卡 d-1a2b3c4d，等操作員',
    },
  });
  assert.equal(withCardId, null);

  const withFleetId = decide({
    tool_name: 'mcp__fleet__task_comment',
    tool_input: {
      task_id: '01M89BSEA28A8AFR5M6STVC5MS',
      content: '等操作員（請求訊息 01M89BSEA28A8AFR5M6STVC5MS）',
    },
  });
  assert.equal(withFleetId, null);

  const noTrigger = decide({
    tool_name: 'mcp__fleet__task_result',
    tool_input: {
      message_id: '01M89BSEA28A8AFR5M6STVC5MS',
      result: 'done',
      content: '已完成測試並更新文件',
    },
  });
  assert.equal(noTrigger, null);
});

test('negative control: AUTOPILOT_PROMISE_ID_GUARD=0 allows counterexamples', () => {
  const out = decide(
    {
      tool_name: 'Write',
      tool_input: {
        file_path: '/run/user/1000/autopilot/handoff/gpu-lead.md',
        content: '已報 PM 開憑證卡，等操作員處理',
      },
    },
    { AUTOPILOT_PROMISE_ID_GUARD: '0' },
  );
  assert.equal(out, null);
});
