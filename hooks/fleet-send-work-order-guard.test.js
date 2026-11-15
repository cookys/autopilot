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

test('fyi true allows the work order itself', () => {
  assert.equal(call('mcp__fleet__send', WORK, { fyi: true }), null);
});

test('dispatch of the same text is allowed', () => {
  assert.equal(call('mcp__fleet__dispatch', WORK), null);
});

test('the same work-order text on reply is allowed', () => {
  assert.equal(call('mcp__fleet__reply', WORK), null);
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
