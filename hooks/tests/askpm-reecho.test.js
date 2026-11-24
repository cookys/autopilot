#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const askpmLogPath = path.resolve(__dirname, '..', 'askpm-log.js');
const { handle, append, SCHEMA } = require(askpmLogPath);

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-reecho-'));
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

function withEnv(env, fn) {
  const prevHome = process.env.HOME;
  const prevLog = process.env.AUTOPILOT_HOOK_ASKPM_LOG;
  process.env.HOME = env.HOME;
  process.env.AUTOPILOT_HOOK_ASKPM_LOG = '1';
  try {
    return fn();
  } finally {
    process.env.HOME = prevHome;
    if (prevLog === undefined) delete process.env.AUTOPILOT_HOOK_ASKPM_LOG;
    else process.env.AUTOPILOT_HOOK_ASKPM_LOG = prevLog;
  }
}

// (a) 同題第二次問，onPrompt 回傳的 reecho 含原答案一行與台北時間
function testSameQuestionReecho() {
  const { root, cwd, env } = makeSandbox();
  try {
    withEnv(env, () => {
      const oldAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      append(env, { schema: SCHEMA, kind: 'ask', at: oldAt, ask_id: 'a-old1', session_id: 's1', text: 'What is the deploy status?' });
      append(env, { schema: SCHEMA, kind: 'reply', at: oldAt, ts: oldAt, ask_id: 'a-old1', session_id: 's1', turn: 1, lines: ['Deploy succeeded on prod.', 'Second line.'], text: 'Deploy succeeded on prod.\nSecond line.' });

      const res = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 's2',
        prompt: 'What is the deploy status?',
      }, env);

      assert.ok(res && typeof res.reecho === 'string', 'expected reecho string');
      assert.ok(res.reecho.includes('Deploy succeeded on prod.'), 'reecho should include first reply line');
      assert.ok(/台北時間 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(res.reecho), 'reecho should include Taipei time');
    });
  } finally {
    cleanup(root);
  }
}

// (b) 無關問題不命中
function testUnrelatedQuestionNoReecho() {
  const { root, cwd, env } = makeSandbox();
  try {
    withEnv(env, () => {
      const oldAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      append(env, { schema: SCHEMA, kind: 'ask', at: oldAt, ask_id: 'a-old2', session_id: 's1', text: 'What is the deploy status?' });
      append(env, { schema: SCHEMA, kind: 'reply', at: oldAt, ts: oldAt, ask_id: 'a-old2', session_id: 's1', turn: 1, lines: ['Deploy succeeded on prod.'], text: 'Deploy succeeded on prod.' });

      const res = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 's2',
        prompt: 'How many unit tests failed?',
      }, env);

      assert.strictEqual(res.reecho, undefined, 'unrelated question must not reecho');
    });
  } finally {
    cleanup(root);
  }
}

// (c) 第一次問（無舊 ask）不命中
function testFirstAskNoReecho() {
  const { root, cwd, env } = makeSandbox();
  try {
    withEnv(env, () => {
      const res = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 's1',
        prompt: 'First time asking this?',
      }, env);

      assert.strictEqual(res.reecho, undefined, 'first ask must not reecho');
    });
  } finally {
    cleanup(root);
  }
}

// (d) 舊 ask 超過 14 天不命中
function testExpiredAskNoReecho() {
  const { root, cwd, env } = makeSandbox();
  try {
    withEnv(env, () => {
      const oldAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      append(env, { schema: SCHEMA, kind: 'ask', at: oldAt, ask_id: 'a-old4', session_id: 's1', text: 'Check old issue' });
      append(env, { schema: SCHEMA, kind: 'reply', at: oldAt, ts: oldAt, ask_id: 'a-old4', session_id: 's1', turn: 1, lines: ['Old answer.'], text: 'Old answer.' });

      const res = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 's2',
        prompt: 'Check old issue',
      }, env);

      assert.strictEqual(res.reecho, undefined, 'ask older than 14 days must not reecho');
    });
  } finally {
    cleanup(root);
  }
}

// (e) 舊 ask 沒有 reply 不命中
function testAskWithoutReplyNoReecho() {
  const { root, cwd, env } = makeSandbox();
  try {
    withEnv(env, () => {
      const oldAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      append(env, { schema: SCHEMA, kind: 'ask', at: oldAt, ask_id: 'a-old5', session_id: 's1', text: 'Unanswered question' });

      const res = handle({
        hook_event_name: 'UserPromptSubmit',
        cwd,
        session_id: 's2',
        prompt: 'Unanswered question',
      }, env);

      assert.strictEqual(res.reecho, undefined, 'ask without reply must not reecho');
    });
  } finally {
    cleanup(root);
  }
}

testSameQuestionReecho();
testUnrelatedQuestionNoReecho();
testFirstAskNoReecho();
testExpiredAskNoReecho();
testAskWithoutReplyNoReecho();
console.log('askpm-reecho.test.js: all 5 tests passed');
