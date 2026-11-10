// hooks/askpm-log.test.js — PM-session ask/reply log. The hook must stay silent and fail open.
// Negative control: a real operator prompt is recorded; an injected prompt in the same session is not.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, 'askpm-log.js');
const PM = 'cookys/aimax395/pm--claude';
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

test('injected message is not recorded; a real operator prompt is', () => {
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
    'hello <channel source="fleet" from="cookys/aimax395/pm--claude@1" message_id="m" kind="chat">body</channel>',
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"advisory"}}',
  ]) {
    const inj = run({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt }, {}, pm);
    assert.equal(inj.status, 0, inj.stderr);
    assert.equal(inj.stdout, '');
    assert.equal(inj.lines.length, 0, 'injected recorded: ' + prompt.slice(0, 40));
  }
});

test('a non-PM session records nothing', () => {
  const r = run(
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: '這題給 PM' },
    { FLEET_ADDRESS: 'cookys/aimax395/game-lead--claude' },
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
