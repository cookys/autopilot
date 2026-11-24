'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'switchboard-quality.js');

function withTempState(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-daily-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFakeSecondEngine(dir, opts = {}) {
  const name = opts.name || 'fake-second-engine';
  const helperPath = path.join(dir, `${name}.helper.js`);
  const cmdPath = path.join(dir, name);
  const logPath = opts.logPath || '';
  const verdictMap = opts.verdictMap || {};
  const defaultVerdict = opts.defaultVerdict || 'auto';
  const helperCode = [
    "'use strict';",
    "const fs = require('node:fs');",
    `const logPath = ${JSON.stringify(logPath)};`,
    `const verdictMap = ${JSON.stringify(verdictMap)};`,
    `const defaultVerdict = ${JSON.stringify(defaultVerdict)};`,
    "const raw = fs.readFileSync(0, 'utf8').trim();",
    'const row = JSON.parse(raw);',
    'if (logPath) {',
    '  const entry = {',
    '    id: row.id,',
    '    hasAnthropicBase: Object.prototype.hasOwnProperty.call(process.env, "ANTHROPIC_BASE_URL"),',
    '    hasOpenaiBase: Object.prototype.hasOwnProperty.call(process.env, "OPENAI_BASE_URL"),',
    '    hasAnthropicDefault: Object.keys(process.env).some((k) => k.startsWith("ANTHROPIC_DEFAULT_")),',
    '  };',
    '  fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");',
    '}',
    'const verdict = Object.prototype.hasOwnProperty.call(verdictMap, row.id) ? verdictMap[row.id] : defaultVerdict;',
    'process.stdout.write(JSON.stringify({ verdict }) + "\\n");',
  ].join('\n');
  fs.writeFileSync(helperPath, helperCode, { mode: 0o600 });
  fs.writeFileSync(cmdPath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(helperPath)}\n`, { mode: 0o700 });
  return cmdPath;
}

function writeConfig(homeDir, switchboardCfg) {
  const cfgDir = path.join(homeDir, '.autopilot');
  fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ switchboard: switchboardCfg }, null, 2));
}

function writeHandling(stateDir, date, rows) {
  const dir = path.join(stateDir, 'switchboard', 'handling');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${date}.jsonl`);
  const content = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  return filePath;
}

function makeRow(id, overrides = {}) {
  return {
    ts: '2026-11-17T08:00:00Z',
    id,
    packet_id: `pkt-${id}`,
    handled: true,
    latency_ms: 50,
    engine: 'sonnet',
    kind: 'auto',
    escalated: false,
    ...overrides,
  };
}

function runQuality(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env,
    timeout: 15000,
  });
}

test('daily does not claim success without required inputs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, 'daily', '--date', '2026-11-17'], {
      encoding: 'utf8',
      env: { HOME: home },
      timeout: 15000,
    });
    assert.notEqual(result.status, 0, 'missing input must not report pass');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('baseline consumes configured extractor output', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-baseline-'));
  try {
    const extractor = path.join(home, 'extract');
    fs.writeFileSync(extractor, '#!/bin/sh\nprintf \'%s\\n\' \'{"ts":"2026-11-17T00:00:00Z","tokens":100,"turns":2}\'\n', { mode: 0o700 });
    fs.mkdirSync(path.join(home, '.autopilot'));
    fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({ switchboard: { extract_script: extractor } }));
    const result = spawnSync(process.execPath, [SCRIPT, 'baseline', '--days', '7'], {
      encoding: 'utf8',
      env: { HOME: home },
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    const baseline = JSON.parse(fs.readFileSync(path.join(home, '.autopilot', 'switchboard', 'quality', 'baseline.json')));
    assert.deepEqual(baseline.daily, [{ date: '2026-11-17', turns: 2, tokens_per_turn: 50 }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('daily exits 1 when handling jsonl is missing even with valid config', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const cmd = writeFakeSecondEngine(root);
  writeConfig(root, { second_engine_cmd: cmd });
  const res = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /找不到當日處理紀錄檔/);
}));

test('daily refuses Chinese-family second opinion engine via cn-model-dispatch-gate before invocation', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const logPath = path.join(root, 'calls.jsonl');
  writeHandling(stateDir, '2026-11-17', [makeRow('m-01')]);

  const cmdByConfig = writeFakeSecondEngine(root, { name: 'neutral-stub', logPath });
  writeConfig(root, { second_engine_cmd: cmdByConfig, second_engine: 'deepseek-v3' });
  const res1 = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(res1.status, 1);
  assert.match(res1.stderr, /中國系模型/);
  assert.equal(fs.existsSync(logPath), false, 'CN engine must never be invoked');

  const cmdByName = writeFakeSecondEngine(root, { name: 'glm-5-stub', logPath });
  writeConfig(root, { second_engine_cmd: cmdByName });
  const res2 = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(res2.status, 1);
  assert.match(res2.stderr, /中國系模型/);
  assert.equal(fs.existsSync(logPath), false, 'CN-named executable must never be invoked');
}));

test('daily clean day samples deterministically (10% ceiling + first 50), computes nearest-rank p50/p95, scrubs env, and preserves mode.json', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const logPath = path.join(root, 'calls.jsonl');
  const cmd = writeFakeSecondEngine(root, { logPath, defaultVerdict: 'auto' });
  writeConfig(root, { second_engine_cmd: cmd, second_engine: 'gemini-4-carbon' });

  const modePath = path.join(stateDir, 'switchboard', 'mode.json');
  fs.mkdirSync(path.dirname(modePath), { recursive: true, mode: 0o700 });
  const initialMode = '{"mode":"live"}\n';
  fs.writeFileSync(modePath, initialMode, { mode: 0o600 });

  // 25 auto rows (non-escalated, shuffled) + 35 escalate-kind non-escalated rows (total 60 non-escalated -> cap at 50)
  // + 20 escalated rows with known latency_ms 10..200 (step 10) -> nearest-rank p50=100, p95=190.
  const rows = [];
  for (let i = 25; i >= 1; i -= 1) {
    rows.push(makeRow(`a-${String(i).padStart(2, '0')}`, { kind: 'auto', escalated: false }));
  }
  for (let i = 35; i >= 1; i -= 1) {
    rows.push(makeRow(`b-${String(i).padStart(2, '0')}`, { kind: 'escalate', escalated: false }));
  }
  for (let i = 20; i >= 1; i -= 1) {
    rows.push(makeRow(`e-${String(i).padStart(2, '0')}`, { kind: 'escalate', escalated: true, latency_ms: i * 10 }));
  }
  writeHandling(stateDir, '2026-11-17', rows);

  const res = runQuality(['daily', '--date', '2026-11-17'], {
    HOME: root,
    AUTOPILOT_STATE_DIR: stateDir,
    ANTHROPIC_BASE_URL: 'https://example.invalid',
    OPENAI_BASE_URL: 'https://example.invalid',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'override-should-be-scrubbed',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim().split('\n').length, 1, 'must print exactly one summary line');

  const report = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'quality', '2026-11-17.json'), 'utf8'));
  assert.equal(report.auto_total, 25);
  assert.equal(report.auto_sample_size, 3, 'ceil(25 * 0.1) must be 3');
  assert.equal(report.non_escalated_total, 60);
  assert.equal(report.swallow_sample_size, 50, 'non-escalated sample must cap at 50');
  assert.equal(report.wrong_intake, 0);
  assert.equal(report.swallowed, 0);
  assert.equal(report.latency_ms.p50, 100);
  assert.equal(report.latency_ms.p95, 190);
  assert.equal(report.rollback, false);

  const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 53);
  assert.deepEqual(calls.slice(0, 3).map((entry) => entry.id), ['a-01', 'a-09', 'a-17']);
  assert.equal(calls[3].id, 'a-01');
  assert.equal(calls[52].id, 'b-25');
  for (const call of calls) {
    assert.equal(call.hasAnthropicBase, false);
    assert.equal(call.hasOpenaiBase, false);
    assert.equal(call.hasAnthropicDefault, false);
  }

  assert.equal(fs.readFileSync(modePath, 'utf8'), initialMode, 'clean day must not modify mode.json');
  assert.equal(fs.existsSync(path.join(stateDir, 'switchboard', 'replay', '2026-11-17')), false);
}));

test('daily rolls back to shadow when wrong_intake >= 2 and does not roll back on 1', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const rows = [];
  for (let i = 1; i <= 20; i += 1) {
    rows.push(makeRow(`a-${String(i).padStart(2, '0')}`, { kind: 'auto', escalated: false }));
  }
  const inputPath = writeHandling(stateDir, '2026-11-17', rows);

  // 1 wrong intake (a-01) -> no rollback
  const cmdOne = writeFakeSecondEngine(root, { name: 'eng-one', verdictMap: { 'a-01': 'escalate' } });
  writeConfig(root, { second_engine_cmd: cmdOne });
  const resOne = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(resOne.status, 0, resOne.stderr);
  assert.equal(fs.existsSync(path.join(stateDir, 'switchboard', 'mode.json')), false);

  // 2 wrong intakes (equidistant sample of 20 is a-01, a-11) -> rollback
  const cmdTwo = writeFakeSecondEngine(root, { name: 'eng-two', verdictMap: { 'a-01': 'escalate', 'a-11': 'escalate' } });
  writeConfig(root, { second_engine_cmd: cmdTwo });
  const resTwo = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(resTwo.status, 0, resTwo.stderr);
  assert.match(resTwo.stdout, /wrong_intake/);
  const mode = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'mode.json'), 'utf8'));
  assert.deepEqual(mode, { mode: 'shadow', reason: 'wrong_intake' });
  const replayCopy = path.join(stateDir, 'switchboard', 'replay', '2026-11-17', '2026-11-17.jsonl');
  assert.equal(fs.readFileSync(replayCopy, 'utf8'), fs.readFileSync(inputPath, 'utf8'));
}));

test('daily rolls back to shadow when swallowed >= 1', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const rows = [makeRow('m-01'), makeRow('m-02')];
  const inputPath = writeHandling(stateDir, '2026-11-17', rows);
  const cmd = writeFakeSecondEngine(root, { verdictMap: { 'm-02': 'question' } });
  writeConfig(root, { second_engine_cmd: cmd });

  const res = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /swallowed/);
  const mode = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'mode.json'), 'utf8'));
  assert.deepEqual(mode, { mode: 'shadow', reason: 'swallowed' });
  const replayCopy = path.join(stateDir, 'switchboard', 'replay', '2026-11-17', '2026-11-17.jsonl');
  assert.equal(fs.readFileSync(replayCopy, 'utf8'), fs.readFileSync(inputPath, 'utf8'));
}));

for (const breachField of ['authority_breach', 'missed_operator_ask', 'wrong_executor', 'sensitive_send']) {
  test(`daily rolls back to shadow when ${breachField} >= 1`, () => withTempState((root) => {
    const stateDir = path.join(root, 'state');
    const rows = [
      makeRow('m-01'),
      makeRow('m-02', { [breachField]: true }),
    ];
    const inputPath = writeHandling(stateDir, '2026-11-17', rows);
    const cmd = writeFakeSecondEngine(root);
    writeConfig(root, { second_engine_cmd: cmd });

    const res = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(breachField));
    const mode = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'mode.json'), 'utf8'));
    assert.deepEqual(mode, { mode: 'shadow', reason: breachField });
    const replayCopy = path.join(stateDir, 'switchboard', 'replay', '2026-11-17', '2026-11-17.jsonl');
    assert.equal(fs.readFileSync(replayCopy, 'utf8'), fs.readFileSync(inputPath, 'utf8'));
  }));
}

test('daily rolls back when tokens_per_turn degrades >= 20% vs baseline for two consecutive days', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const cmd = writeFakeSecondEngine(root);
  writeConfig(root, { second_engine_cmd: cmd });

  const qualityDir = path.join(stateDir, 'switchboard', 'quality');
  fs.mkdirSync(qualityDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(qualityDir, 'baseline.json'),
    JSON.stringify({ daily: [{ date: '2026-11-10', turns: 10, tokens_per_turn: 100 }] }),
  );

  // Day 1 degraded (+20%): no previous day quality file -> no rollback
  writeHandling(stateDir, '2026-11-16', [makeRow('m-01', { tokens: 240, turns: 2 })]);
  const day1 = runQuality(['daily', '--date', '2026-11-16'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(day1.status, 0, day1.stderr);
  assert.equal(fs.existsSync(path.join(stateDir, 'switchboard', 'mode.json')), false);

  // Day 2 degraded (+25%): consecutive day -> rollback
  const day2Input = writeHandling(stateDir, '2026-11-17', [makeRow('m-01', { tokens: 250, turns: 2 })]);
  const day2 = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(day2.status, 0, day2.stderr);
  assert.match(day2.stdout, /tokens_per_turn_2day/);
  const mode = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'mode.json'), 'utf8'));
  assert.deepEqual(mode, { mode: 'shadow', reason: 'tokens_per_turn_2day' });
  const replayCopy = path.join(stateDir, 'switchboard', 'replay', '2026-11-17', '2026-11-17.jsonl');
  assert.equal(fs.readFileSync(replayCopy, 'utf8'), fs.readFileSync(day2Input, 'utf8'));
}));

test('daily rolls back when p95 latency degrades >= 20% vs baseline for two consecutive days', () => withTempState((root) => {
  const stateDir = path.join(root, 'state');
  const cmd = writeFakeSecondEngine(root);
  writeConfig(root, { second_engine_cmd: cmd });

  const qualityDir = path.join(stateDir, 'switchboard', 'quality');
  fs.mkdirSync(qualityDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(qualityDir, 'baseline.json'),
    JSON.stringify({ daily: [{ date: '2026-11-10', turns: 10, tokens_per_turn: 100 }], latency_p95_ms: 100 }),
  );

  // Day 1 degraded (p95 = 120, +20%): no previous day -> no rollback
  writeHandling(stateDir, '2026-11-16', [
    makeRow('a-01'),
    makeRow('e-01', { kind: 'escalate', escalated: true, latency_ms: 120 }),
  ]);
  const day1 = runQuality(['daily', '--date', '2026-11-16'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(day1.status, 0, day1.stderr);
  assert.equal(fs.existsSync(path.join(stateDir, 'switchboard', 'mode.json')), false);

  // Day 2 degraded (p95 = 130, +30%): consecutive day -> rollback
  const day2Input = writeHandling(stateDir, '2026-11-17', [
    makeRow('a-01'),
    makeRow('e-01', { kind: 'escalate', escalated: true, latency_ms: 130 }),
  ]);
  const day2 = runQuality(['daily', '--date', '2026-11-17'], { HOME: root, AUTOPILOT_STATE_DIR: stateDir });
  assert.equal(day2.status, 0, day2.stderr);
  assert.match(day2.stdout, /p95_latency_2day/);
  const mode = JSON.parse(fs.readFileSync(path.join(stateDir, 'switchboard', 'mode.json'), 'utf8'));
  assert.deepEqual(mode, { mode: 'shadow', reason: 'p95_latency_2day' });
  const replayCopy = path.join(stateDir, 'switchboard', 'replay', '2026-11-17', '2026-11-17.jsonl');
  assert.equal(fs.readFileSync(replayCopy, 'utf8'), fs.readFileSync(day2Input, 'utf8'));
}));
