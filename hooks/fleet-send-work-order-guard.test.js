'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
  const body = 'task_id: 01M7RSNEWJ85N4906CNC4Z3QFX\ntag: progress\n' + '請跑 nsys 這一輪。';
  assert.equal(call('mcp__fleet__reply', body, { message_id: 'm1' }), null);
});

test('P5: reply carrying a work order without task context is denied', () => {
  const out = call('mcp__fleet__reply', '請跑 nsys 這一輪，跑完交件。', { message_id: 'm1' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /reply/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /task_id: <26 碼任務 id>/);
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /欄位/);
});

test('P5: reply that answers a task (task_id field or 26-char id in text) is allowed', () => {
  assert.equal(call('mcp__fleet__reply', '請跑 nsys 這一輪。', { message_id: 'm1', task_id: '01M7RSNEWJ85N4906CNC4Z3QFX' }), null);
  assert.equal(call('mcp__fleet__reply', `請跑 nsys 這一輪。母單 01M7RSNEWJ85N4906CNC4Z3QFX`, { message_id: 'm1' }), null);
});

test('P5: first-person and bare-noun replies are allowed (also fyi)', () => {
  for (const c of ['好的，我現在就跑，跑完回報', 'OK 已修，你可以開跑了', '要你確認的事我寫在 PR', '我去跑 一次，之後給你']) {
    assert.equal(call('mcp__fleet__reply', c, { message_id: 'm1' }), null, c);
    assert.equal(call('mcp__fleet__reply', c, { message_id: 'm1', fyi: true }), null, c);
  }
});

test('P5: imperative replies are denied', () => {
  for (const c of ['麻煩你修一下 foo.js 然後回我', 'please implement the parser and push']) {
    const out = call('mcp__fleet__reply', c, { message_id: 'm1' });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', c);
  }
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

function transcriptWith(channel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-guard-tx-'));
  const transcript_path = path.join(dir, 'turn.jsonl');
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: channel } });
  fs.writeFileSync(transcript_path, `${line}\n`);
  return transcript_path;
}

test('reply to a courier wake is denied and names the task_id', () => {
  const messageId = '01FAKEWAKE0000000000000001';
  const taskId = '01M7XM2E0WF2NDPPHQ5KA3KBZS';
  const transcript_path = transcriptWith(
    `<channel source="fleet" from="cookys/aimax395/courier@gen1" message_id="${messageId}" kind="chat">\nwake\ntask_id: ${taskId}\n</channel>`,
  );
  const out = guard.decide({
    tool_name: 'mcp__fleet__reply',
    transcript_path,
    tool_input: { message_id: messageId, content: '收到' },
  });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /不能回 courier/);
  assert.match(reason, /task_comment/);
  assert.match(reason, new RegExp(taskId));
});

test('reply to a member message is allowed', () => {
  const messageId = '01FAKEMEMBERMSG00000000001';
  const transcript_path = transcriptWith(
    `<channel source="fleet" from="cookys/aimax395/pm--claude" message_id="${messageId}" kind="chat">\nhello\n</channel>`,
  );
  assert.equal(guard.decide({
    tool_name: 'mcp__fleet__reply',
    transcript_path,
    tool_input: { message_id: messageId, content: '收到' },
  }), null);
});

test('reply to an unknown message id is allowed', () => {
  const transcript_path = transcriptWith(
    '<channel source="fleet" from="cookys/aimax395/courier" message_id="01FAKEOTHER0000000000000001" kind="chat">\ntask_id: 01M7XM2E0WF2NDPPHQ5KA3KBZS\n</channel>',
  );
  assert.equal(guard.decide({
    tool_name: 'mcp__fleet__reply',
    transcript_path,
    tool_input: { message_id: '01FAKEMISSING0000000000001', content: '收到' },
  }), null);
});

const BRIEF = '請各席回報：讀 ~/.claude/settings.json 的 model 與 effort 欄位，並算 ~/.claude/CLAUDE.md 的 sha256';

test('a brief that tells seats to read ~/.claude is denied', () => {
  for (const tool of ['mcp__fleet__dispatch', 'mcp__fleet__send', 'mcp__fleet__task_comment']) {
    const field = tool.endsWith('dispatch') ? 'task' : tool.endsWith('task_comment') ? 'text' : 'content';
    const out = guard.decide({ tool_name: tool, tool_input: { to: 'ns/h/peer', [field]: BRIEF } });
    assert.equal(out && out.hookSpecificOutput.permissionDecision, 'deny', tool);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /~\/\.claude|operator|操作員/);
  }
});

test('$HOME/.claude outside projects is denied', () => {
  for (const content of [
    '請讀 $HOME/.claude/settings.json',
    '請讀 /home/someone/.claude/settings.json',
    '請讀 /Users/someone/.claude/settings.json',
  ]) {
    const out = guard.decide({
      tool_name: 'mcp__fleet__send',
      tool_input: { to: 'ns/h/peer', content },
    });
    assert.equal(out && out.hookSpecificOutput.permissionDecision, 'deny', content);
  }
});

test('a seat memory path under .claude/projects is allowed', () => {
  assert.equal(guard.decide({
    tool_name: 'mcp__fleet__send',
    tool_input: { to: 'ns/h/peer', content: '~/.claude/projects/abc123/memory 是各席自己的記憶' },
  }), null);
});

test('text with no .claude path is allowed', () => {
  assert.equal(guard.decide({
    tool_name: 'mcp__fleet__task_comment',
    tool_input: { task_id: '01M7XM2E0WF2NDPPHQ5KA3KBZS', text: '這則沒有家目錄設定路徑。' },
  }), null);
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
