'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'pm-auto-handoff.js');

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-auto-handoff-test-'));

try {
  // (a) 正常產出且「操作員最近的話」與「未完成事項」兩段非空
  {
    const transcript = path.join(tmpDir, 'a.jsonl');
    const out = path.join(tmpDir, 'out-a.md');
    writeJsonl(transcript, [
      { type: 'user', message: { content: '請幫我檢查 Phase 1 進度' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '好的，建立任務。' },
            { type: 'tool_use', name: 'TaskCreate', input: { taskId: '1', subject: '實作 pm-auto-handoff.js' } },
            { type: 'tool_use', name: 'TaskCreate', input: { taskId: '2', subject: '已完成的前置檢查' } },
            { type: 'tool_use', name: 'TaskUpdate', input: { taskId: '2', status: 'completed' } },
          ],
        },
      },
      { type: 'user', message: { content: '記得加上負控制測試' } },
    ]);

    const res = runCli(['--transcript', transcript, '--session-id', 'sid-a', '--out', out, '--now', '2026-11-24T12:00:00Z']);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.ok(fs.existsSync(out), 'output file should exist');
    const md = fs.readFileSync(out, 'utf8');
    for (const heading of ['## 目標', '## 現況', '## 操作員最近的話', '## 未完成事項', '## 已決事項(不重議)', '## 下一步', '## 驗證方式', '## Read-order', '## 陷阱']) {
      assert.ok(md.includes(heading), `missing heading ${heading}`);
    }
    assert.ok(md.includes('請幫我檢查 Phase 1 進度'));
    assert.ok(md.includes('記得加上負控制測試'));
    assert.ok(md.includes('實作 pm-auto-handoff.js'));
    assert.ok(!md.includes('已完成的前置檢查'));
  }

  // (b) 工具結果與 system-reminder / task-notification / channel 不算操作員發言
  {
    const transcript = path.join(tmpDir, 'b.jsonl');
    const out = path.join(tmpDir, 'out-b.md');
    writeJsonl(transcript, [
      { type: 'user', message: { content: '<system-reminder>internal</system-reminder>' } },
      { type: 'user', message: { content: '<task-notification>done</task-notification>' } },
      { type: 'user', message: { content: '<channel kind="wake">ping</channel>' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'user', message: { content: '唯一真正的指令' } },
      { type: 'assistant', message: { content: '下一步：執行驗證腳本' } },
    ]);

    const res = runCli(['--transcript', transcript, '--session-id', 'sid-b', '--out', out]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
    const md = fs.readFileSync(out, 'utf8');
    assert.ok(md.includes('唯一真正的指令'));
    assert.ok(!md.includes('<system-reminder>'));
    assert.ok(!md.includes('<task-notification>'));
    assert.ok(!md.includes('<channel'));
    assert.ok(md.includes('下一步：執行驗證腳本'));
  }

  // (c) 無操作員發言（或 transcript 不存在）exit 3 且沒檔案
  {
    const transcript = path.join(tmpDir, 'c.jsonl');
    const out = path.join(tmpDir, 'out-c.md');
    writeJsonl(transcript, [
      { type: 'user', message: { content: '<system-reminder>only system</system-reminder>' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'tool out' }] } },
    ]);

    const res = runCli(['--transcript', transcript, '--session-id', 'sid-c', '--out', out]);
    assert.equal(res.status, 3, `expected exit 3, got ${res.status}`);
    assert.equal(res.stderr.trim(), 'missing_operator_utterance');
    assert.ok(!fs.existsSync(out), 'output file must not be created when no operator utterance');

    const missingRes = runCli(['--transcript', path.join(tmpDir, 'nope.jsonl'), '--session-id', 'sid-c2', '--out', out]);
    assert.equal(missingRes.status, 3);
    assert.equal(missingRes.stderr.trim(), 'missing_operator_utterance');
    assert.ok(!fs.existsSync(out));
  }

  // (d) 輸出 mtime 比呼叫前新
  {
    const transcript = path.join(tmpDir, 'd.jsonl');
    const out = path.join(tmpDir, 'out-d.md');
    writeJsonl(transcript, [{ type: 'user', message: { content: '更新 handoff' } }]);
    fs.writeFileSync(out, 'old content', 'utf8');
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(out, past, past);
    const beforeMtime = fs.statSync(out).mtimeMs;

    const res = runCli(['--transcript', transcript, '--session-id', 'sid-d', '--out', out]);
    assert.equal(res.status, 0);
    const afterMtime = fs.statSync(out).mtimeMs;
    assert.ok(afterMtime > beforeMtime, `expected mtime ${afterMtime} > ${beforeMtime}`);
  }

  console.log('pm-auto-handoff.test.js: 4/4 test cases passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
