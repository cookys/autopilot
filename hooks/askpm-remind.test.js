'use strict';
// hooks/askpm-remind.test.js — PM request register reminder & host wiring (P1).
// Run: node --test hooks/askpm-remind.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isPmConsole } = require('./_shared/pm-console');

const LOG_HOOK = path.join(__dirname, 'askpm-log.js');
const REMIND_HOOK = path.join(__dirname, 'askpm-remind.js');
const RELAY_HOOK = path.join(__dirname, 'advisory-relay.js');
const PM_ASK = path.join(__dirname, '..', 'scripts', 'pm-ask.js');

const CONSOLE_PROGRAM = JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' });
const CONSOLE_OTHER = JSON.stringify({ schema: 'autopilot.console/1', mode: 'lane' });

function entry(role, content) {
  return JSON.stringify({ type: role, message: { role, content } });
}

function makeEnv(opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-remind-'));
  const state = path.join(home, 'state');
  const live = path.join(home, 'live');
  const pmRepo = path.join(home, 'pm-repo');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(live, { recursive: true });
  fs.mkdirSync(path.join(pmRepo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(pmRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(pmRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(pmRepo, '.claude', 'console.json'), CONSOLE_PROGRAM);

  const baseEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    AUTOPILOT_STATE_DIR: state,
    AUTOPILOT_LIVE_DIR: live,
    AUTOPILOT_CONFIG_FILE: path.join(home, 'config.json'),
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_AWAITING_OWNER: 'off',
    AUTOPILOT_DECIDE_REPLY_CLOSE: 'off',
    AUTOPILOT_FLEET_BIN: path.join(home, 'no-such-fleet'),
    AUTOPILOT_HOOK_ASKPM_LOG: '1',
    AUTOPILOT_HOOK_ASKPM_REMIND: '1',
    ...opts.env,
  };

  function runScript(scriptPath, payload, extraEnv) {
    return spawnSync(process.execPath, [scriptPath], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...baseEnv, ...extraEnv },
    });
  }

  function runPmAsk(args) {
    return spawnSync(process.execPath, [PM_ASK, ...args], {
      encoding: 'utf8',
      env: baseEnv,
    });
  }

  function readRows() {
    const f = path.join(state, 'askpm.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  function writeTranscript(name, entries) {
    const p = path.join(home, name);
    fs.writeFileSync(p, entries.join('\n') + '\n');
    return p;
  }

  return {
    home,
    state,
    pmRepo,
    runRelay: (p, e) => runScript(RELAY_HOOK, { session_id: 's1', cwd: pmRepo, ...p }, e),
    runLog: (p, e) => runScript(LOG_HOOK, { session_id: 's1', cwd: pmRepo, ...p }, e),
    runRemind: (p, e) => runScript(REMIND_HOOK, { session_id: 's1', cwd: pmRepo, ...p }, e),
    runPmAsk,
    readRows,
    writeTranscript,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

test('pm-console gate stops at first .git and requires schema + mode:"program"', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-console-gate-'));
  try {
    const pm = path.join(root, 'pm');
    fs.mkdirSync(path.join(pm, '.git'), { recursive: true });
    fs.writeFileSync(path.join(pm, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(pm, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(pm, '.claude', 'console.json'), CONSOLE_PROGRAM);
    fs.mkdirSync(path.join(pm, 'nested', 'dir'), { recursive: true });
    assert.equal(isPmConsole(path.join(pm, 'nested', 'dir')), true);

    // Child git repo inside PM workspace never inherits parent console.json
    const child = path.join(pm, 'child-repo');
    fs.mkdirSync(path.join(child, '.git'), { recursive: true });
    fs.writeFileSync(path.join(child, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(isPmConsole(child), false);

    // Gitfile worktree (.git is a regular file)
    const wt = path.join(root, 'wt');
    fs.mkdirSync(path.join(wt, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /some/where\n');
    fs.writeFileSync(path.join(wt, '.claude', 'console.json'), CONSOLE_PROGRAM);
    assert.equal(isPmConsole(wt), true);

    // Non-program mode rejected
    const lane = path.join(root, 'lane');
    fs.mkdirSync(path.join(lane, '.git'), { recursive: true });
    fs.writeFileSync(path.join(lane, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(lane, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(lane, '.claude', 'console.json'), CONSOLE_OTHER);
    assert.equal(isPmConsole(lane), false);

    // .git dir without HEAD is not treated as a git root
    const bareDir = path.join(pm, 'fake-sub');
    fs.mkdirSync(path.join(bareDir, '.git'), { recursive: true });
    assert.equal(isPmConsole(bareDir), true, 'walks past .git directory lacking HEAD');

    // Even when process.cwd() is a PM console repo, empty/missing cwd returns false without falling back
    const prevCwd = process.cwd();
    try {
      process.chdir(pm);
      assert.equal(isPmConsole(''), false);
      assert.equal(isPmConsole('   '), false);
      assert.equal(isPmConsole(undefined), false);
      assert.equal(isPmConsole(null), false);
      assert.equal(isPmConsole({}), false);
      assert.equal(isPmConsole({ cwd: '' }), false);
    } finally {
      process.chdir(prevCwd);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ask gets sha256 ask_id, advisory-relay emits ask_id only with askpm-remind on, and [voice call · unverified] is injected', () => {
  const s = makeEnv();
  try {
    // askpm-remind OFF: ask still gets ask_id, but advisory-relay emits no ask_id context line
    const offRes = s.runRelay(
      { hook_event_name: 'UserPromptSubmit', prompt: '請檢查進度' },
      { AUTOPILOT_HOOK_ASKPM_REMIND: '0' },
    );
    assert.equal(offRes.status, 0, offRes.stderr);
    assert.equal(offRes.stdout, '');

    // askpm-remind ON: ask gets ask_id and advisory-relay emits `ask_id a-xxxxxxxx`
    const onRes = s.runRelay({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-42', prompt: '合併嗎？' });
    assert.equal(onRes.status, 0, onRes.stderr);
    const out = JSON.parse(onRes.stdout);
    const ctx = out.hookSpecificOutput.additionalContext;
    const rows = s.readRows();
    const ask2 = rows[1];
    assert.equal(ask2.kind, 'ask');
    assert.equal(ask2.session_id, 'sess-42');
    const expectedId = 'a-' + crypto.createHash('sha256').update(`sess-42\n${ask2.at}\n合併嗎？`).digest('hex').slice(0, 8);
    assert.equal(ask2.ask_id, expectedId);
    assert.match(ctx, new RegExp(`^ask_id ${expectedId}$`, 'm'));

    // [voice call · unverified] and injected prompts get turn markers, no ask_id, no ask_id line
    for (const prompt of ['[voice call · unverified] 測試語音', '<system-reminder>hi</system-reminder>']) {
      const inj = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt });
      assert.equal(inj.status, 0, inj.stderr);
      assert.equal(inj.stdout, '');
    }
    const allRows = s.readRows();
    assert.equal(allRows.filter((r) => r.kind === 'ask').length, 2);
    assert.equal(allRows.filter((r) => r.kind === 'turn').length, 2);
  } finally {
    s.cleanup();
  }
});

test('askpm-remind on with askpm-log off does nothing and prints once on stderr', () => {
  const s = makeEnv({ env: { AUTOPILOT_HOOK_ASKPM_LOG: '0' } });
  try {
    const relayRes = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
    assert.equal(relayRes.status, 0);
    assert.equal(relayRes.stdout, '');
    assert.match(relayRes.stderr, /askpm-log is off/);

    const stopRes = s.runRemind({ hook_event_name: 'Stop', last_assistant_message: 'hi' });
    assert.equal(stopRes.status, 0);
    assert.equal(stopRes.stdout, '');
    assert.match(stopRes.stderr, /askpm-log is off/);

    assert.equal(s.readRows().length, 0);
    assert.equal(fs.existsSync(path.join(s.state, 'remind-day')), false);
  } finally {
    s.cleanup();
  }
});

test('Stop 1 blocks undisposed ask; Stop 2 never blocks and writes Stop 1 pending_reply; single reply writer with both hooks on', () => {
  const s = makeEnv();
  try {
    const prompt = '請決定部署時間';
    const relay = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt });
    assert.equal(relay.status, 0, relay.stderr);
    const askRow = s.readRows().find((r) => r.kind === 'ask');
    const tp1 = s.writeTranscript('t1.jsonl', [
      entry('user', prompt),
      entry('assistant', [{ type: 'text', text: '建議今晚 20:00 部署\n等待確認' }]),
    ]);

    // With both opt-ins on, askpm-log Stop skips the reply row
    const logStop1 = s.runLog({ hook_event_name: 'Stop', transcript_path: tp1 });
    assert.equal(logStop1.status, 0, logStop1.stderr);
    assert.equal(logStop1.stdout, '');
    assert.equal(s.readRows().filter((r) => r.kind === 'reply').length, 0);

    // Stop 1 of askpm-remind blocks and writes reminded row with pending_reply
    const remindStop1 = s.runRemind({ hook_event_name: 'Stop', transcript_path: tp1 });
    assert.equal(remindStop1.status, 0, remindStop1.stderr);
    const blockJson = JSON.parse(remindStop1.stdout);
    assert.equal(blockJson.decision, 'block');
    assert.equal(blockJson.reason, `ask_id ${askRow.ask_id} 尚未處置：pm-ask close/progress/supersede` + '修正：用 node scripts/pm-ask.js close|progress|supersede <ask_id> 處置後再結束 參閱：hooks/README.md');

    const remindedRow = s.readRows().find((r) => r.kind === 'reminded');
    assert.ok(remindedRow);
    assert.equal(remindedRow.ask_id, askRow.ask_id);
    assert.equal(remindedRow.pending_reply, '建議今晚 20:00 部署\n等待確認');

    // Stop 2: transcript's last user entry is now the block reason, not the original ask
    const tp2 = s.writeTranscript('t2.jsonl', [
      entry('user', prompt),
      entry('assistant', [{ type: 'text', text: '建議今晚 20:00 部署\n等待確認' }]),
      entry('user', blockJson.reason),
      entry('assistant', [{ type: 'text', text: '已補記進度' }]),
    ]);
    const logStop2 = s.runLog({ hook_event_name: 'Stop', transcript_path: tp2, stop_hook_active: true });
    assert.equal(logStop2.status, 0);
    assert.equal(logStop2.stdout, '');

    const remindStop2 = s.runRemind({ hook_event_name: 'Stop', transcript_path: tp2, stop_hook_active: true });
    assert.equal(remindStop2.status, 0, remindStop2.stderr);
    assert.equal(remindStop2.stdout, '');

    const replies = s.readRows().filter((r) => r.kind === 'reply');
    assert.equal(replies.length, 1, 'exactly one reply row per ask');
    assert.equal(replies[0].text, '建議今晚 20:00 部署\n等待確認');
    assert.deepEqual(replies[0].lines, ['建議今晚 20:00 部署', '等待確認']);
    const feed = s.runPmAsk(['list', '--answers', '--open', '--json']);
    assert.equal(feed.status, 0, feed.stderr);
    assert.equal(JSON.parse(feed.stdout)[0].answer, '建議今晚 20:00 部署\n等待確認');
    assert.equal(replies[0].ask_id, askRow.ask_id);
  } finally {
    s.cleanup();
  }
});

test('Stop 1 on already-disposed ask writes reply without blocking', () => {
  const s = makeEnv();
  try {
    const prompt = '幫我開卡';
    s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt });
    const askId = s.readRows().find((r) => r.kind === 'ask').ask_id;
    const closed = s.runPmAsk(['close', askId, '--evidence', 'd-1234abcd']);
    assert.equal(closed.status, 0, closed.stderr);

    const tp = s.writeTranscript('t.jsonl', [
      entry('user', prompt),
      entry('assistant', [{ type: 'text', text: '已開卡 d-1234abcd' }]),
    ]);
    const stop = s.runRemind({ hook_event_name: 'Stop', transcript_path: tp });
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(stop.stdout, '');
    const replies = s.readRows().filter((r) => r.kind === 'reply');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, '已開卡 d-1234abcd');
    assert.equal(replies[0].ask_id, askId);
  } finally {
    s.cleanup();
  }
});

test('a later fleet turn never blocks (both injected turn and channel transcript turn)', () => {
  const s = makeEnv();
  try {
    // 1. Open ask followed by a channel turn without UserPromptSubmit
    const prompt = '這週要發版嗎？';
    s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt });
    const tpChannel = s.writeTranscript('channel.jsonl', [
      entry('user', prompt),
      entry('assistant', [{ type: 'text', text: '等回報' }]),
      entry('user', '<channel source="fleet" from="ns/host/lane@1" message_id="m1" kind="chat">done</channel>'),
      entry('assistant', [{ type: 'text', text: '收到 lane 回報' }]),
    ]);
    const stopChannel = s.runRemind({ hook_event_name: 'Stop', transcript_path: tpChannel });
    assert.equal(stopChannel.status, 0);
    assert.equal(stopChannel.stdout, '');

    // 2. Open ask closed by injected fleet UserPromptSubmit turn
    s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt: '<channel source="fleet" from="ns/h/l@1" message_id="m2" kind="chat">ping</channel>' });
    const stopTurn = s.runRemind({ hook_event_name: 'Stop', last_assistant_message: 'ack' });
    assert.equal(stopTurn.status, 0);
    assert.equal(stopTurn.stdout, '');
  } finally {
    s.cleanup();
  }
});

test('daily overdue fires once per UTC+8 day via advisory-relay', () => {
  const s = makeEnv();
  try {
    const oldAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    fs.writeFileSync(
      path.join(s.state, 'askpm.jsonl'),
      JSON.stringify({
        schema: 'autopilot.askpm/1',
        kind: 'ask',
        at: oldAt,
        ask_id: 'a-old11111',
        session_id: 's0',
        text: 'overdue request from yesterday',
      }) + '\n',
    );
    const first = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt: '今天第一個問題' });
    assert.equal(first.status, 0, first.stderr);
    const ctx1 = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx1, /^ask_id a-/m);
    assert.match(ctx1, /^a-old11111 25h overdue request from yesterday$/m);

    const todayUtc8 = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    assert.equal(fs.readFileSync(path.join(s.state, 'remind-day'), 'utf8').trim(), todayUtc8);

    // Second prompt on the same UTC+8 day does NOT repeat overdue output
    const second = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt: '今天第二個問題' });
    assert.equal(second.status, 0, second.stderr);
    const ctx2 = JSON.parse(second.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx2, /^ask_id a-/m);
    assert.equal(ctx2.includes('a-old11111'), false);
  } finally {
    s.cleanup();
  }
});

test('child repo under PM workspace is untouched by askpm-remind and advisory-relay', () => {
  const s = makeEnv();
  try {
    const child = path.join(s.pmRepo, 'child-repo');
    fs.mkdirSync(path.join(child, '.git'), { recursive: true });
    fs.writeFileSync(path.join(child, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    // Relay in child repo: no ask_id line, no remind-day
    const relay = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt: 'child prompt', cwd: child });
    assert.equal(relay.status, 0, relay.stderr);
    assert.equal(relay.stdout, '');
    assert.equal(fs.existsSync(path.join(s.state, 'remind-day')), false);

    // askpm-log prompt in child repo: passive ask row without ask_id or session_id
    const logPrompt = s.runLog({ hook_event_name: 'UserPromptSubmit', prompt: 'child log prompt', cwd: child });
    assert.equal(logPrompt.status, 0, logPrompt.stderr);
    assert.equal(logPrompt.stdout, '');
    const askRows = s.readRows().filter((r) => r.kind === 'ask');
    // Relay also invokes passive logging; both prompts retain the original gate.
    assert.deepEqual(askRows.map((r) => r.text), ['child prompt', 'child log prompt']);
    for (const row of askRows) {
      assert.equal(row.ask_id, undefined);
      assert.equal(row.session_id, undefined);
    }

    // Stop in child repo: askpm-remind never blocks, and askpm-log still writes reply because PM console gate is false
    const tp = s.writeTranscript('child.jsonl', [
      entry('user', 'child log prompt'),
      entry('assistant', [{ type: 'text', text: 'child reply' }]),
    ]);
    const remind = s.runRemind({ hook_event_name: 'Stop', transcript_path: tp, cwd: child });
    assert.equal(remind.status, 0);
    assert.equal(remind.stdout, '');

    const logStop = s.runLog({ hook_event_name: 'Stop', transcript_path: tp, cwd: child });
    assert.equal(logStop.status, 0);
    assert.equal(s.readRows().filter((r) => r.kind === 'reply').length, 1);
  } finally {
    s.cleanup();
  }
});

test('askpm-remind off produces no stdout and leaves askpm-log Stop behaviour intact', () => {
  const s = makeEnv({ env: { AUTOPILOT_HOOK_ASKPM_REMIND: '0' } });
  try {
    const prompt = '一般問題';
    const relay = s.runRelay({ hook_event_name: 'UserPromptSubmit', prompt });
    assert.equal(relay.status, 0);
    assert.equal(relay.stdout, '');

    const tp = s.writeTranscript('off.jsonl', [
      entry('user', prompt),
      entry('assistant', [{ type: 'text', text: '一般回覆' }]),
    ]);
    const remind = s.runRemind({ hook_event_name: 'Stop', transcript_path: tp });
    assert.equal(remind.status, 0);
    assert.equal(remind.stdout, '');

    const logStop = s.runLog({ hook_event_name: 'Stop', transcript_path: tp });
    assert.equal(logStop.status, 0);
    assert.equal(logStop.stdout, '');
    const replies = s.readRows().filter((r) => r.kind === 'reply');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, '一般回覆');
  } finally {
    s.cleanup();
  }
});
