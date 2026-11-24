#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const askpmLogPath = path.resolve(__dirname, '..', 'askpm-log.js');
const { handle, readRows, writeDisposition, logFile, SCHEMA } = require(askpmLogPath);

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-disposition-auto-'));
  const homeDir = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(path.join(homeDir, '.autopilot'), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }));
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(homeDir, '.autopilot', 'config.json'), JSON.stringify({ hooks: { 'askpm-log': true } }));
  const env = {
    HOME: homeDir,
    AUTOPILOT_STATE_DIR: stateDir,
    AUTOPILOT_HOOK_ASKPM_LOG: '1',
  };
  return { root, homeDir, stateDir, cwd, env };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function withSandbox(fn) {
  const sb = makeSandbox();
  const prevHome = process.env.HOME;
  const prevLog = process.env.AUTOPILOT_HOOK_ASKPM_LOG;
  process.env.HOME = sb.env.HOME;
  process.env.AUTOPILOT_HOOK_ASKPM_LOG = '1';
  try {
    fn(sb);
  } finally {
    process.env.HOME = prevHome;
    if (prevLog === undefined) delete process.env.AUTOPILOT_HOOK_ASKPM_LOG;
    else process.env.AUTOPILOT_HOOK_ASKPM_LOG = prevLog;
    cleanup(sb.root);
  }
}

// (a) 「收到，謝謝」→ close
function testAckClose() {
  withSandbox(({ cwd, env }) => {
    const askRes = handle({
      hook_event_name: 'UserPromptSubmit',
      cwd,
      session_id: 'sess-a',
      prompt: '收到，謝謝',
    }, env);
    assert.ok(askRes && askRes.ask_id);

    handle({
      hook_event_name: 'Stop',
      cwd,
      session_id: 'sess-a',
      turn: 1,
      last_assistant_message: '不客氣。',
    }, env);

    const rows = readRows(env);
    const disps = rows.filter((r) => r.kind === 'disposition');
    assert.strictEqual(disps.length, 1, 'expected 1 disposition row');
    assert.strictEqual(disps[0].action, 'close', 'expected close action for 收到，謝謝');
    assert.strictEqual(disps[0].ask_id, askRes.ask_id);
    assert.strictEqual(disps[0].session_id, 'sess-a');
    assert.strictEqual(disps[0].turn, 1);
    assert.ok(typeof disps[0].ts === 'string' && disps[0].ts.length > 0);
  });
}

// (b) 「再看看」→ progress
function testProgress() {
  withSandbox(({ cwd, env }) => {
    const askRes = handle({
      hook_event_name: 'UserPromptSubmit',
      cwd,
      session_id: 'sess-b',
      prompt: '再看看',
    }, env);
    assert.ok(askRes && askRes.ask_id);

    handle({
      hook_event_name: 'Stop',
      cwd,
      session_id: 'sess-b',
      turn: 1,
      last_assistant_message: '好的，我再檢查一下。',
    }, env);

    const rows = readRows(env);
    const disps = rows.filter((r) => r.kind === 'disposition');
    assert.strictEqual(disps.length, 1, 'expected 1 disposition row');
    assert.strictEqual(disps[0].action, 'progress', 'expected progress action for 再看看');
  });
}

// (c) 只有 sha、d-12345678、URL 的 prompt → 不 close
function testNonCloseIdentifiers() {
  for (const prompt of ['a1b2c3d4e5f6', 'd-12345678', 'https://example.com/issues/42']) {
    withSandbox(({ cwd, env }) => {
      const askRes = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 'sess-c',
        prompt,
      }, env);
      assert.ok(askRes && askRes.ask_id);

      handle({
        hook_event_name: 'Stop',
        cwd,
        session_id: 'sess-c',
        turn: 1,
        last_assistant_message: '已記錄。',
      }, env);

      const rows = readRows(env);
      const disps = rows.filter((r) => r.kind === 'disposition');
      assert.strictEqual(disps.length, 1, `expected 1 disposition row for ${prompt}`);
      assert.strictEqual(disps[0].action, 'progress', `expected progress (not close) for ${prompt}`);
    });
  }
}

// (d) 無 ask_id 的 reply 不寫 disposition 且不丟例外
function testNoAskIdSkipsDisposition() {
  withSandbox(({ cwd, env }) => {
    const file = logFile(env);
    fs.writeFileSync(file, JSON.stringify({
      schema: SCHEMA,
      kind: 'ask',
      at: '2026-11-24T10:00:00Z',
      text: '收到，謝謝',
    }) + '\n');

    handle({
      hook_event_name: 'Stop',
      cwd,
      session_id: 'sess-d',
      turn: 1,
      last_assistant_message: '已回覆。',
    }, env);

    const rows = readRows(env);
    const replies = rows.filter((r) => r.kind === 'reply');
    const disps = rows.filter((r) => r.kind === 'disposition');
    assert.strictEqual(replies.length, 1, 'reply should still be written');
    assert.strictEqual(disps.length, 0, 'disposition must not be written when ask_id is missing');
  });
}

// (e) 同 turn 重複 Stop 只一列
function testDuplicateStopSameTurnWritesOnce() {
  withSandbox(({ cwd, env }) => {
    const askRes = handle({
      hook_event_name: 'UserPromptSubmit',
      cwd,
      session_id: 'sess-e',
      prompt: '收到，謝謝',
    }, env);
    assert.ok(askRes && askRes.ask_id);

    writeDisposition(env, 'close', { ask_id: askRes.ask_id, session_id: 'sess-e', turn: 3 });
    writeDisposition(env, 'close', { ask_id: askRes.ask_id, session_id: 'sess-e', turn: 3 });

    const rows = readRows(env);
    const disps = rows.filter((r) => r.kind === 'disposition');
    assert.strictEqual(disps.length, 1, 'same (ask_id, turn) disposition must write only once');
  });
}

const tests = [
  testAckClose,
  testProgress,
  testNonCloseIdentifiers,
  testNoAskIdSkipsDisposition,
  testDuplicateStopSameTurnWritesOnce,
];

let passed = 0;
for (const t of tests) {
  t();
  passed += 1;
}
console.log(`PASS: ${passed}/${tests.length} tests in askpm-disposition-auto.test.js`);
