'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const guard = require('./fleet-send-work-order-guard');

// Fixture 2, verbatim (host names already replaced by roles).
const WORK = 'PM（補上一則排程追問，操作員剛說）：……nsys A-r2 現在就跑。唯一要顧的是 10:39 結束的 soak：nsys 如果不用重啟服務，就跟 soak 並行；要重啟的話，就中斷 soak 去跑……開跑時回一行，附 run id。[no-task: 對既有排程的裁示]';
const FACT_FYI = 'PM：好，hook 跑全量。不用等 push……';

function call(tool, content, extra = {}, env = {}) {
  return guard.decide({
    tool_name: tool,
    tool_input: { to: 'ns/hostC/gpu-lead--claude', content, ...extra },
  }, env);
}

test('fixture 2 send with a no-task note is denied', () => {
  const out = call('mcp__fleet__send', WORK);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /dispatch/);
  assert.match(reason, /reply/);
  assert.match(reason, /fyi/);
});

test('fyi true fact report is allowed', () => {
  assert.equal(call('mcp__fleet__send', FACT_FYI, { fyi: true }), null);
});

test('fyi true still denies a work order carrying [no-task', () => {
  const out = call('mcp__fleet__send', WORK, { fyi: true });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('fyi true + [no-task + 回報 denies (case-insensitive)', () => {
  const denyLower = call('mcp__fleet__send', '進度同步，請處理完回報。[no-task: quick]', { fyi: true });
  assert.equal(denyLower.hookSpecificOutput.permissionDecision, 'deny');
  const denyUpper = call('mcp__fleet__send', '進度同步，請處理完回報。[NO-TASK: quick]', { fyi: true });
  assert.equal(denyUpper.hookSpecificOutput.permissionDecision, 'deny');
});

test('fyi true + 回報 without [no-task is allowed', () => {
  assert.equal(call('mcp__fleet__send', '剛測完這批數據，晚點補完整回報。', { fyi: true }), null);
});

test('fyi true + [no-task without any work-order phrase is allowed', () => {
  assert.equal(call('mcp__fleet__send', 'FYI 狀態同步而已。[no-task: status]', { fyi: true }), null);
});

test('dispatch of the same text is allowed', () => {
  assert.equal(call('mcp__fleet__dispatch', WORK), null);
});

test('P5: fyi=true does not hide a work order (no [no-task needed)', () => {
  const out = call('mcp__fleet__send', '請跑 nsys 這一輪，跑完交件。', { fyi: true });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /task_id/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /waiting_on/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /內文最上面/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /task_id: <26 碼任務 id>\ntag: progress\|result\|question\|ruling\|fyi\nwaiting_on: /);
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /欄位/);
});

test('P5: task_id header line at top of body counts as task context', () => {
  const body = 'task_id: 01M7RSNEWJ85N4906CNC4Z3QFX\ntag: progress\n' + WORK;
  assert.equal(call('mcp__fleet__reply', body, { message_id: 'm1' }), null);
});

test('P5: reply carrying a work order without task context is denied', () => {
  const out = call('mcp__fleet__reply', WORK, { message_id: 'm1' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /reply/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /task_id: <26 碼任務 id>/);
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /欄位/);
});

test('P5: reply that answers a task (task_id field or 26-char id in text) is allowed', () => {
  assert.equal(call('mcp__fleet__reply', WORK, { message_id: 'm1', task_id: '01M7RSNEWJ85N4906CNC4Z3QFX' }), null);
  assert.equal(call('mcp__fleet__reply', `${WORK} 母單 01M7RSNEWJ85N4906CNC4Z3QFX`, { message_id: 'm1' }), null);
});

test('P5: plain fact reply and fyi reply with only the noun 回報 are allowed', () => {
  assert.equal(call('mcp__fleet__reply', '收到，路徑在 /x'), null);
  assert.equal(call('mcp__fleet__reply', '晚點補完整回報。', { fyi: true }), null);
});

test('a fact question is allowed', () => {
  assert.equal(call('mcp__fleet__send', 'X 的路徑在哪？'), null);
});

test('broadcast to @channel is allowed', () => {
  assert.equal(call('mcp__fleet__send', WORK, { to: '@channel' }), null);
});

test('off switch allows the work order', () => {
  assert.equal(call('mcp__fleet__send', WORK, {}, { AUTOPILOT_SEND_WORK_ORDER_GUARD: 'off' }), null);
});

test('cli denies the work order and the off switch allows it', () => {
  const script = path.join(__dirname, 'fleet-send-work-order-guard.js');
  const input = JSON.stringify({
    tool_name: 'mcp__fleet__send',
    tool_input: { to: 'ns/hostC/gpu-lead--claude', content: WORK },
  });
  const deny = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  assert.equal(deny.status, 0, deny.stderr);
  assert.match(deny.stdout, /"permissionDecision":"deny"/);
  const off = spawnSync(process.execPath, [script], {
    input,
    encoding: 'utf8',
    env: { ...process.env, AUTOPILOT_SEND_WORK_ORDER_GUARD: 'off' },
  });
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, '');
});
