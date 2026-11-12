// hooks/askpm-log.test.js — PM-session ask/reply log. The hook must stay silent and fail open.
// Negative control: a real operator prompt is an ask; an injected prompt is a turn marker, not an ask.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'askpm-log.js');
const PM = 'ns/host-a/pm--claude';
const CONSOLE_OK = '{"schema":"autopilot.console/1","mode":"program"}';

function run(payload, env, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-home-'));
  const state = path.join(home, 'state');
  fs.mkdirSync(state, { recursive: true });
  for (const [rel, body] of Object.entries(files || {})) {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const input = { ...payload };
  if (typeof input.cwd !== 'string' || input.cwd === '') input.cwd = home;
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      AUTOPILOT_STATE_DIR: state,
      AUTOPILOT_HOOK_ASKPM_LOG: '1',
      ...env,
    },
  });
  const file = path.join(state, 'askpm.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(home, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines };
}

test('injected message is a turn marker, not an ask; a real operator prompt is', () => {
  const pm = { '.claude/console.json': CONSOLE_OK };
  const real = run({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '記憶線要不要合併？' }, {}, pm);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(real.stdout, '');
  assert.equal(real.lines.length, 1, 'real prompt recorded');
  assert.equal(JSON.parse(real.lines[0]).kind, 'ask');
  for (const prompt of [
    '[待決回覆]\n甲',
    '[待決回覆·更正] d-00000000 → 甲',
    '<system-reminder>do not record</system-reminder>',
    '<task-notification>done</task-notification>',
    'hello <channel source="fleet" from="ns/host-a/pm--claude@1" message_id="m" kind="chat">body</channel>',
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"advisory"}}',
  ]) {
    const inj = run({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }, {}, pm);
    assert.equal(inj.status, 0, inj.stderr);
    assert.equal(inj.stdout, '');
    assert.equal(inj.lines.length, 1, 'injected turn marker missing: ' + prompt.slice(0, 40));
    const row = JSON.parse(inj.lines[0]);
    assert.equal(row.kind, 'turn', 'injected recorded as an ask: ' + prompt.slice(0, 40));
    assert.equal(row.injected, true);
    assert.equal(row.schema, 'autopilot.askpm/1');
    assert.equal(row.text, undefined);
  }
});

test('a non-PM session records nothing', () => {
  const r = run(
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '這題給 PM' },
    { FLEET_ADDRESS: 'ns/host-a/game-lead--claude' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 0);
  const missing = run(
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '沒有位址' },
    { FLEET_ADDRESS: '' },
  );
  assert.equal(missing.lines.length, 0);
});

test('the hook writes nothing to stdout', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-home-'));
  const state = path.join(home, 'state');
  const transcript = path.join(home, 't.jsonl');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '進度？' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '等回報：遊戲線\n明天再看' }] } }),
  ].join('\n') + '\n');
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    AUTOPILOT_STATE_DIR: state,
    AUTOPILOT_HOOK_ASKPM_LOG: '1',
  };
  const ask = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '進度？', cwd: home }),
    encoding: 'utf8',
    env,
  });
  const stop = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, cwd: home }),
    encoding: 'utf8',
    env,
  });
  const again = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, stop_hook_active: true, cwd: home }),
    encoding: 'utf8',
    env,
  });
  const lines = fs.readFileSync(path.join(state, 'askpm.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(ask.stdout, '');
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, '');
  assert.equal(stop.stderr, '');
  assert.equal(again.stdout, '');
  assert.equal(lines.length, 2, 'ask plus one reply; stop_hook_active does not append again');
  assert.deepEqual(lines[1].lines, ['等回報：遊戲線', '明天再看']);
});

// Isolated from run(): no FLEET_ADDRESS unless the case sets it. The PM gate is console.json only.
function gateRun(extra, env, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-gate-'));
  const state = path.join(home, 'state');
  const tree = path.join(home, 'tree');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(tree, { recursive: true });
  for (const [rel, body] of Object.entries(files || {})) {
    const abs = path.join(tree, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const cwd = extra && extra.cwdRel ? path.join(tree, extra.cwdRel) : tree;
  fs.mkdirSync(cwd, { recursive: true });
  const payload = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 's',
    prompt: '記憶線要不要合併？',
    cwd,
  };
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      AUTOPILOT_STATE_DIR: state,
      AUTOPILOT_HOOK_ASKPM_LOG: '1',
      ...env,
    },
  });
  const file = path.join(state, 'askpm.jsonl');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(home, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines };
}

test('console.json in cwd records', () => {
  const r = gateRun(null, { FLEET_ADDRESS: '' }, { '.claude/console.json': CONSOLE_OK });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 1, 'cwd console.json did not record');
  assert.equal(JSON.parse(r.lines[0]).kind, 'ask');
});

test('console.json in an ancestor records', () => {
  const r = gateRun({ cwdRel: 'a/b' }, { FLEET_ADDRESS: '' }, { '.claude/console.json': CONSOLE_OK });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.lines.length, 1, 'ancestor console.json did not record');
});

test('absent console.json records nothing', () => {
  const r = gateRun(null, { FLEET_ADDRESS: PM, FLEET_MEMBER: 'pm--claude' }, {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 0, 'absent console.json recorded');
});

test('opt-in on but no console.json records nothing', () => {
  const r = gateRun(null, { FLEET_ADDRESS: '' }, {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 0, 'opt-in without console.json recorded');
});

test('AUTOPILOT_ASKPM=1 alone records nothing', () => {
  const r = gateRun(null, { AUTOPILOT_ASKPM: '1', FLEET_ADDRESS: '' }, {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 0, 'old env alone recorded');
});

test('malformed console.json records nothing', () => {
  const r = gateRun(null, { FLEET_ADDRESS: PM }, { '.claude/console.json': '{not json' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.lines.length, 0, 'malformed console.json recorded');
});

test('other schema records nothing', () => {
  const r = gateRun(null, { FLEET_ADDRESS: PM }, { '.claude/console.json': '{"schema":"other/1","mode":"program"}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.lines.length, 0, 'other schema recorded');
});

test('FLEET_ADDRESS pm--claude alone records nothing', () => {
  const r = gateRun(null, { FLEET_ADDRESS: PM }, {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.lines.length, 0, 'FLEET_ADDRESS alone recorded');
});

// Host Stop entry is the opt-in multiplexer (hooks.json). owner-question-guard is a
// later Stop command: it can block the first Stop, and the turn then ends on a second
// Stop with stop_hook_active true, delivered to the same entry.
const MUX = path.join(__dirname, 'opt-in-multiplexer.js');
const GUARD = path.join(__dirname, 'owner-question-guard.js');
const ROOT = path.join(__dirname, '..');

function hostStop(home, state, payload) {
  return spawnSync(process.execPath, [MUX, 'Stop'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      AUTOPILOT_STATE_DIR: state,
      AUTOPILOT_HOOK_ASKPM_LOG: '1',
      CLAUDE_PLUGIN_ROOT: ROOT,
    },
  });
}

function readRows(state) {
  const file = path.join(state, 'askpm.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('first Stop blocked by another hook, second Stop with stop_hook_active records one reply', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-block-'));
  const state = path.join(home, 'state');
  const transcript = path.join(home, 't.jsonl');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  const user = JSON.stringify({ type: 'user', message: { role: 'user', content: '剛剛我還沒改，現在改好了' } });
  const assistant = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '要我合併嗎\n好了' }] },
  });
  // The multiplexer runs before owner-question-guard. The reply is not in the
  // transcript yet, so this Stop records nothing. The guard then sees the reply and blocks.
  fs.writeFileSync(transcript, user + '\n');
  const ask = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '剛剛我還沒改，現在改好了', cwd: home }),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: home,
      AUTOPILOT_STATE_DIR: state,
      AUTOPILOT_HOOK_ASKPM_LOG: '1',
    },
  });
  const first = hostStop(home, state, { hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, cwd: home, stop_hook_active: false });
  fs.appendFileSync(transcript, assistant + '\n');
  const guard = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, cwd: home, stop_hook_active: false }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: home },
  });
  const second = hostStop(home, state, { hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, cwd: home, stop_hook_active: true });
  const rows = readRows(state);
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(ask.status, 0, ask.stderr);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(guard.stdout).decision, 'block');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, '');
  const replies = rows.filter((r) => r.kind === 'reply');
  assert.equal(replies.length, 1, 'the stop_hook_active Stop must record the reply the blocked Stop missed');
  assert.deepEqual(replies[0].lines, ['要我合併嗎', '好了']);
  assert.equal(rows.filter((r) => r.kind === 'ask').length, 1);
});

test('stop_hook_active uses last_assistant_message when the transcript has no reply yet', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-direct-'));
  const state = path.join(home, 'state');
  const transcript = path.join(home, 't.jsonl');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', message: { role: 'user', content: '剛剛我還沒改，現在改好了' } }) + '\n');
  const payload = {
    hook_event_name: 'Stop',
    session_id: 's',
    transcript_path: transcript,
    cwd: home,
    stop_hook_active: true,
    last_assistant_message: '要我合併嗎\n好了',
  };
  const first = hostStop(home, state, payload);
  const second = hostStop(home, state, payload);
  const replies = readRows(state).filter((r) => r.kind === 'reply');
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].lines, ['要我合併嗎', '好了']);
});

test('last_assistant_message wins when the transcript still ends on a previous turn', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-lag-'));
  const state = path.join(home, 'state');
  const transcript = path.join(home, 't.jsonl');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  // Newest assistant entry is the previous turn. No user line after it, so the
  // transcript looks complete while the current reply is only on the payload.
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '上一題' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '上一輪回覆\n舊的' }] } }),
  ].join('\n') + '\n');
  const stop = hostStop(home, state, {
    hook_event_name: 'Stop',
    session_id: 's',
    transcript_path: transcript,
    cwd: home,
    last_assistant_message: '這一輪回覆\n現在的',
  });
  const replies = readRows(state).filter((r) => r.kind === 'reply');
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].lines, ['這一輪回覆', '現在的']);
});

function pmSession() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-own-'));
  const state = path.join(home, 'state');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    AUTOPILOT_STATE_DIR: state,
    AUTOPILOT_HOOK_ASKPM_LOG: '1',
  };
  function send(payload) {
    return spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ cwd: home, session_id: 's', ...payload }),
      encoding: 'utf8',
      env,
    });
  }
  function transcript(entries) {
    const p = path.join(home, 't.jsonl');
    fs.writeFileSync(p, entries.join('\n') + '\n');
    return p;
  }
  function rows() {
    const file = path.join(state, 'askpm.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  return { home, send, transcript, rows, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function entry(role, content) {
  return JSON.stringify({ type: role, message: { role, content } });
}

test('transcript fallback records the last assistant text of the turn, not an earlier one', () => {
  const s = pmSession();
  try {
    const ask = '問題甲';
    const tp = s.transcript([
      entry('user', ask),
      entry('assistant', [{ type: 'text', text: 'mid' }]),
      entry('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
      entry('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      entry('assistant', [{ type: 'text', text: 'final' }]),
    ]);
    const prompted = s.send({ hook_event_name: 'UserPromptSubmit', prompt: ask });
    const stop = s.send({ hook_event_name: 'Stop', transcript_path: tp });
    const replies = s.rows().filter((r) => r.kind === 'reply');
    assert.equal(prompted.status, 0, prompted.stderr);
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(stop.stdout, '');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, 'final');
    assert.deepEqual(replies[0].lines, ['final']);
  } finally {
    s.cleanup();
  }
});

test('an injected prompt closes the open ask, so its Stop records no reply', () => {
  const s = pmSession();
  try {
    const prompted = s.send({ hook_event_name: 'UserPromptSubmit', prompt: '記憶線要不要合併？' });
    const injected = s.send({ hook_event_name: 'UserPromptSubmit', prompt: '[待決回覆]\n甲' });
    const stop = s.send({ hook_event_name: 'Stop', last_assistant_message: 'x' });
    const rows = s.rows();
    assert.equal(prompted.status, 0, prompted.stderr);
    assert.equal(injected.status, 0, injected.stderr);
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(stop.stdout, '');
    assert.equal(rows.filter((r) => r.kind === 'reply').length, 0);
    assert.equal(rows.filter((r) => r.kind === 'ask').length, 1);
    const turn = rows.find((r) => r.kind === 'turn');
    assert.ok(turn, 'injected prompt must append a turn row');
    assert.equal(turn.injected, true);
    assert.equal(turn.schema, 'autopilot.askpm/1');
    assert.equal(typeof turn.at, 'string');
  } finally {
    s.cleanup();
  }
});

test('a channel turn whose last real user is not the ask records no reply', () => {
  const s = pmSession();
  try {
    const ask = '記憶線要不要合併？';
    const channel = '<channel source="fleet" from="ns/host-a/other@1" message_id="m" kind="chat">請看這則</channel>';
    const tp = s.transcript([
      entry('user', ask),
      entry('assistant', [{ type: 'text', text: '上一輪的回覆' }]),
      entry('user', channel),
      entry('assistant', [{ type: 'text', text: 'Now a card for the operator to listen.' }]),
    ]);
    const prompted = s.send({ hook_event_name: 'UserPromptSubmit', prompt: ask });
    const stop = s.send({ hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: 'y' });
    const rows = s.rows();
    assert.equal(prompted.status, 0, prompted.stderr);
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(stop.stdout, '');
    assert.equal(rows.filter((r) => r.kind === 'reply').length, 0);
    assert.equal(rows.filter((r) => r.kind === 'ask').length, 1);
    assert.equal(rows.some((r) => r.kind === 'turn'), false);
  } finally {
    s.cleanup();
  }
});

test('an unreadable transcript still records the reply for the open ask', () => {
  const s = pmSession();
  try {
    const prompted = s.send({ hook_event_name: 'UserPromptSubmit', prompt: '記憶線要不要合併？' });
    const stop = s.send({
      hook_event_name: 'Stop',
      transcript_path: path.join(s.home, 'missing.jsonl'),
      last_assistant_message: '還在',
    });
    const replies = s.rows().filter((r) => r.kind === 'reply');
    assert.equal(prompted.status, 0, prompted.stderr);
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, '還在');
  } finally {
    s.cleanup();
  }
});

test('ask then its own Stop still records the reply', () => {
  const s = pmSession();
  try {
    const prompt = '問\r\n題';
    const tp = s.transcript([
      entry('user', '問\n題'),
      entry('assistant', [{ type: 'text', text: '舊的' }]),
    ]);
    const prompted = s.send({ hook_event_name: 'UserPromptSubmit', prompt });
    const stop = s.send({ hook_event_name: 'Stop', transcript_path: tp, last_assistant_message: '新的回覆\n第二行' });
    const rows = s.rows();
    const replies = rows.filter((r) => r.kind === 'reply');
    assert.equal(prompted.status, 0, prompted.stderr);
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(stop.stdout, '');
    assert.equal(rows.filter((r) => r.kind === 'ask').length, 1);
    assert.equal(rows.find((r) => r.kind === 'ask').text, '問\n題');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, '新的回覆\n第二行');
    assert.deepEqual(replies[0].lines, ['新的回覆', '第二行']);
  } finally {
    s.cleanup();
  }
});

test('two Stops in one turn record one reply', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-twice-'));
  const state = path.join(home, 'state');
  const transcript = path.join(home, 't.jsonl');
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'console.json'), CONSOLE_OK);
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '剛剛我還沒改，現在改好了' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '要我合併嗎\n好了' }] } }),
  ].join('\n') + '\n');
  const base = { hook_event_name: 'Stop', session_id: 's', transcript_path: transcript, cwd: home };
  const first = hostStop(home, state, { ...base, stop_hook_active: false });
  const second = hostStop(home, state, { ...base, stop_hook_active: true });
  const replies = readRows(state).filter((r) => r.kind === 'reply');
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, '');
  assert.equal(second.stdout, '');
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].lines, ['要我合併嗎', '好了']);
});

test('wiring: askpm-log is opt-in, not a per-prompt spawn', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'));
  const commands = (event) => (hooks.hooks[event] || []).flatMap((g) => (g.hooks || []).map((h) => h.command));
  assert.equal(commands('UserPromptSubmit').some((c) => c.includes('/hooks/askpm-log.js')), false, 'UserPromptSubmit must not spawn askpm-log');
  assert.equal(commands('Stop').some((c) => c.includes('/hooks/askpm-log.js')), false, 'Stop must not spawn askpm-log directly');
  assert.ok(commands('Stop').some((c) => c.includes('/hooks/opt-in-multiplexer.js Stop')), 'Stop multiplexer unwired');
  assert.deepStrictEqual(commands('UserPromptSubmit').map((c) => c.includes('/hooks/advisory-relay.js')), [true], 'UserPromptSubmit is advisory-relay only');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'opt-in-manifest.json'), 'utf8'));
  assert.equal((manifest.opt_in || []).includes('askpm-log'), true, 'missing from opt-in manifest');
  const mux = fs.readFileSync(path.join(__dirname, 'opt-in-multiplexer.js'), 'utf8');
  assert.match(mux, /stem: 'askpm-log'/);
  const host = fs.readFileSync(path.join(__dirname, 'advisory-relay.js'), 'utf8');
  assert.match(host, /isEnabled\('askpm-log'\)/);
  assert.match(host, /askpm-log'\)\.handle|askpm-log\.js'\)|require\('\.\/askpm-log'\)\.handle/);
  const classes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'profiles', 'hook-classes.json'), 'utf8'));
  const row = classes.hooks.find((h) => h.stem === 'askpm-log');
  assert.equal(row && row.class, 'invariant_effect');
  const off = run(
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'opt-in off records nothing' },
    { AUTOPILOT_HOOK_ASKPM_LOG: '' },
    { '.claude/console.json': CONSOLE_OK },
  );
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout, '');
  assert.equal(off.lines.length, 0, 'opt-in off still recorded');
});
