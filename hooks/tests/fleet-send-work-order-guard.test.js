'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
