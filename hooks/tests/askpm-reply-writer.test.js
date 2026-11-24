#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const askpmLogPath = path.resolve(__dirname, '..', 'askpm-log.js');
const { handle, readRows, writeReply, logFile, SCHEMA } = require(askpmLogPath);

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-reply-writer-'));
  const homeDir = path.join(root, 'home');
  const stateDir = path.join(root, 'state');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(path.join(homeDir, '.autopilot'), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1' }));
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

// (a) 一筆 ask 後 Stop，reply 列帶正確 ask_id
function testAskThenStopHasAskId() {
  const { root, cwd, env } = makeSandbox();
  const prevHome = process.env.HOME;
  const prevLog = process.env.AUTOPILOT_HOOK_ASKPM_LOG;
  process.env.HOME = env.HOME;
  process.env.AUTOPILOT_HOOK_ASKPM_LOG = '1';
  try {
    const askRes = handle({
      hook_event_name: 'UserPromptSubmit',
      cwd,
      session_id: 'sess-a',
      prompt: 'What is the status?',
    }, env);
    assert.ok(askRes && askRes.ask_id, 'ask should produce ask_id');

    handle({
      hook_event_name: 'Stop',
      cwd,
      session_id: 'sess-a',
      turn: 1,
      last_assistant_message: 'All green.',
    }, env);

    const rows = readRows(env);
    const replies = rows.filter((r) => r.kind === 'reply');
    assert.strictEqual(replies.length, 1, 'expected 1 reply row');
    assert.strictEqual(replies[0].ask_id, askRes.ask_id, 'reply ask_id should match ask');
    assert.strictEqual(replies[0].session_id, 'sess-a', 'reply session_id should match');
    assert.strictEqual(replies[0].turn, 1, 'reply turn should match');
    assert.ok(typeof replies[0].ts === 'string' && replies[0].ts.length > 0, 'reply ts should be set');
  } finally {
    process.env.HOME = prevHome;
    if (prevLog === undefined) delete process.env.AUTOPILOT_HOOK_ASKPM_LOG;
    else process.env.AUTOPILOT_HOOK_ASKPM_LOG = prevLog;
    cleanup(root);
  }
}

// (b) 同 turn 重複 Stop 只一筆（含 writeReply 直接呼叫同 (ask_id, turn) 冪等）
function testDuplicateStopSameTurnWritesOnce() {
  const { root, cwd, env } = makeSandbox();
  const prevHome = process.env.HOME;
  const prevLog = process.env.AUTOPILOT_HOOK_ASKPM_LOG;
  process.env.HOME = env.HOME;
  process.env.AUTOPILOT_HOOK_ASKPM_LOG = '1';
  try {
    const askRes = handle({
      hook_event_name: 'UserPromptSubmit',
      cwd,
      session_id: 'sess-b',
      prompt: 'Check duplicate turn',
    }, env);
    assert.ok(askRes && askRes.ask_id);

    writeReply(env, 'First reply', { ask_id: askRes.ask_id, session_id: 'sess-b', turn: 2 });
    writeReply(env, 'Second reply same turn', { ask_id: askRes.ask_id, session_id: 'sess-b', turn: 2 });

    const rows = readRows(env);
    const replies = rows.filter((r) => r.kind === 'reply');
    assert.strictEqual(replies.length, 1, 'same (ask_id, turn) must write only once');
    assert.strictEqual(replies[0].text, 'First reply');
  } finally {
    process.env.HOME = prevHome;
    if (prevLog === undefined) delete process.env.AUTOPILOT_HOOK_ASKPM_LOG;
    else process.env.AUTOPILOT_HOOK_ASKPM_LOG = prevLog;
    cleanup(root);
  }
}

// (c) 兩個 process 各 append 50 筆後逐行都能 JSON.parse
function testConcurrentProcessesAppend() {
  const { root, env } = makeSandbox();
  const script = `
    const { writeReply } = require(${JSON.stringify(askpmLogPath)});
    const env = ${JSON.stringify(env)};
    const workerId = process.argv[2];
    for (let i = 0; i < 50; i += 1) {
      writeReply(env, 'msg-' + workerId + '-' + i, {
        ask_id: 'a-' + workerId + '-' + i,
        session_id: 'sess-' + workerId,
        turn: i,
      });
    }
  `;

  function runWorker(id) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, id], {
        env: { ...process.env, HOME: env.HOME, AUTOPILOT_STATE_DIR: env.AUTOPILOT_STATE_DIR },
        stdio: 'pipe',
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('exit', (code) => {
        if (code !== 0) reject(new Error(`worker ${id} exited ${code}: ${stderr}`));
        else resolve();
      });
    });
  }

  return Promise.all([runWorker('p1'), runWorker('p2')])
    .then(() => {
      const raw = fs.readFileSync(logFile(env), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 100, 'expected 100 lines total from two processes');
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.strictEqual(parsed.schema, SCHEMA);
        assert.strictEqual(parsed.kind, 'reply');
      }
    })
    .finally(() => cleanup(root));
}

// (d) 一行壞 JSON 夾在中間，讀取不中斷
function testMalformedJsonLineSkipped() {
  const { root, env } = makeSandbox();
  try {
    const file = logFile(env);
    const row1 = JSON.stringify({ schema: SCHEMA, kind: 'ask', at: '2026-11-24T00:00:00Z', ask_id: 'a-11111111', text: 'q1' });
    const row2 = JSON.stringify({ schema: SCHEMA, kind: 'reply', at: '2026-11-24T00:00:01Z', ask_id: 'a-11111111', text: 'r1' });
    fs.writeFileSync(file, `${row1}\n{not valid json\n${row2}\n`);

    const rows = readRows(env);
    assert.strictEqual(rows.length, 2, 'malformed line should be skipped without throwing');
    assert.strictEqual(rows[0].kind, 'ask');
    assert.strictEqual(rows[1].kind, 'reply');
  } finally {
    cleanup(root);
  }
}

async function main() {
  testAskThenStopHasAskId();
  testDuplicateStopSameTurnWritesOnce();
  await testConcurrentProcessesAppend();
  testMalformedJsonLineSkipped();
  console.log('askpm-reply-writer.test.js: all 4 tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
