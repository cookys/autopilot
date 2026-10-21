/**
 * BL-0271 seat knob. Run: node --test hooks/context-budget-seat.test.js
 * Temp HOME and temp live dir only. Never touches the real ~/.autopilot.
 */
// # RED at 329e516a0d1ed62020c81292f81128c3e19805b8: seat=resident and config seat=resident still emit the handoff T2 directive (2 failed, 3 passed).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { budgetDecision } = require('./context-budget-lib.js');
const HOOK = path.join(__dirname, 'context-budget.js');

const state = { contextTokens: 160000, calls: 1, lastT1Context: 0, lastT2Context: 0 };
const base = { t1: 100000, t2: 150000, step: 0 };

function msg(extra) {
  return budgetDecision(state, { ...base, ...extra }).message;
}

const VARIANTS = [{}, { windowUnknown: true }, { autocompactWindow: 180000 }];

test('seat=resident T2 text names the state file and has no handoff wording', () => {
  for (const extra of VARIANTS) {
    const m = msg({ ...extra, seat: 'resident' });
    assert.match(m, /Update the state file and confirm that after compaction only the state file path and unfinished items remain/);
    assert.doesNotMatch(m, /handoff/i);
    assert.doesNotMatch(m, /hand off/i);
  }
});

test('seat=session T2 text is byte-identical to unset', () => {
  for (const extra of VARIANTS) {
    assert.strictEqual(msg({ ...extra, seat: 'session' }), msg(extra));
  }
});

test('seat unset equals session', () => {
  assert.strictEqual(msg({}), msg({ seat: 'session' }));
});

test('unknown seat value falls back to session', () => {
  assert.strictEqual(msg({ seat: 'persistent' }), msg({ seat: 'session' }));
  assert.strictEqual(msg({ seat: 'nope' }), msg({}));
  assert.match(msg({ seat: 'nope' }), /handoff/i);
});

function runHook(configText, extraEnv) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-seat-home-'));
  const live = fs.mkdtempSync(path.join('/dev/shm', 'cb-seat-live-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-seat-work-'));
  try {
    fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
    const configFile = path.join(home, '.autopilot', 'config.json');
    fs.writeFileSync(configFile, configText);
    const transcript = path.join(work, 't.jsonl');
    fs.writeFileSync(transcript, '{"timestamp":"2026-10-21T00:00:00.000Z","message":{"usage":{"input_tokens":160000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":1}}}\n');
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ transcript_path: transcript, session_id: 'seat-test-sid' }),
      encoding: 'utf8',
      env: (() => {
        const env = { ...process.env };
        for (const key of Object.keys(env)) {
          if (key.startsWith('AUTOPILOT_CONTEXT_BUDGET_')) delete env[key];
        }
        delete env.AUTOPILOT_SESSION_ID;
        delete env.CLAUDE_CODE_SESSION_ID;
        return {
          ...env,
          HOME: home,
          AUTOPILOT_CONFIG_FILE: configFile,
          AUTOPILOT_LIVE_DIR: live,
          AUTOPILOT_CONTEXT_BUDGET_DIR: path.join(work, 'state'),
          AUTOPILOT_CONTEXT_BUDGET_T1: '100000',
          AUTOPILOT_CONTEXT_BUDGET_T2: '150000',
          AUTOPILOT_CONTEXT_BUDGET_STEP: '0',
          ...extraEnv,
        };
      })(),
    });
    return { status: r.status, stderr: r.stderr || '' };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(live, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

test('config seat=resident reaches the hook T2 text', () => {
  const resident = runHook('{"context_budget":{"seat":"resident"}}\n', {});
  assert.strictEqual(resident.status, 2);
  assert.match(resident.stderr, /state file path and unfinished items/);
  assert.doesNotMatch(resident.stderr, /handoff/i);
  const session = runHook('{"context_budget":{"seat":"session"}}\n', {});
  const unset = runHook('{}\n', {});
  const unknown = runHook('{"context_budget":{"seat":"persistent"}}\n', {});
  const sessionLine = session.stderr.split('\n').find((l) => l.startsWith('Context budget T2'));
  const unsetLine = unset.stderr.split('\n').find((l) => l.startsWith('Context budget T2'));
  const unknownLine = unknown.stderr.split('\n').find((l) => l.startsWith('Context budget T2'));
  assert.strictEqual(sessionLine, unsetLine);
  assert.strictEqual(unknownLine, unsetLine);
  assert.match(unsetLine, /handoff/i);
});

test('outer AUTOPILOT_CONTEXT_BUDGET_SEAT=resident does not leak into the session-default case', () => {
  const prev = process.env.AUTOPILOT_CONTEXT_BUDGET_SEAT;
  process.env.AUTOPILOT_CONTEXT_BUDGET_SEAT = 'resident';
  try {
    const unset = runHook('{}\n', {});
    assert.strictEqual(unset.status, 2);
    const line = unset.stderr.split('\n').find((l) => l.startsWith('Context budget T2'));
    assert.match(line, /handoff/i);
    assert.doesNotMatch(line, /state file path and unfinished items/);
  } finally {
    if (prev === undefined) delete process.env.AUTOPILOT_CONTEXT_BUDGET_SEAT;
    else process.env.AUTOPILOT_CONTEXT_BUDGET_SEAT = prev;
  }
});
