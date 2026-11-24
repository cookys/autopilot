'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { SCHEMA, append } = require('../hooks/askpm-log');
const { groupKey } = require('./lib/ask-group-key');
const { groupAsks, listOutput, loadState, withGroupKey } = require('./pm-ask');

function makeSandboxEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ask-gk-'));
  return {
    env: {
      HOME: dir,
      XDG_STATE_HOME: path.join(dir, 'state'),
      AUTOPILOT_STATE_DIR: path.join(dir, 'autopilot-state'),
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('same question asked 3 times merges into 1 entry with count=3', () => {
  const { env, cleanup } = makeSandboxEnv();
  try {
    const q = '為什麼這個 CI pipeline 會失敗？';
    const times = [
      '2026-11-01T10:00:00Z',
      '2026-11-01T10:05:00Z',
      '2026-11-01T10:10:00Z',
    ];
    times.forEach((at, idx) => {
      append(env, withGroupKey({
        schema: SCHEMA,
        kind: 'ask',
        ask_id: `a-0000000${idx + 1}`,
        session_id: 's1',
        at,
        text: q,
      }));
    });

    const { asks } = loadState(env);
    const nowMs = Date.parse('2026-11-01T10:15:00Z');
    const grouped = groupAsks(asks, nowMs);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].count, 3);
    assert.equal(grouped[0].first_at, times[0]);
    assert.equal(grouped[0].last_at, times[2]);

    const out = listOutput(env, { nowMs });
    assert.equal(out.split('\n').length, 1);
    assert.match(out, /\(x3\)/);
  } finally {
    cleanup();
  }
});

test('negative control: same first 80 chars but different suffix do not merge', () => {
  const { env, cleanup } = makeSandboxEnv();
  try {
    const prefix = 'a'.repeat(80);
    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-10000001',
      session_id: 's1',
      at: '2026-11-01T10:00:00Z',
      text: `${prefix} alpha`,
    }));
    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-10000002',
      session_id: 's1',
      at: '2026-11-01T10:01:00Z',
      text: `${prefix} beta`,
    }));

    const { asks } = loadState(env);
    const grouped = groupAsks(asks, Date.parse('2026-11-01T10:05:00Z'));
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].count, 1);
    assert.equal(grouped[1].count, 1);
  } finally {
    cleanup();
  }
});

test('negative control: different questions under same task do not merge', () => {
  const { env, cleanup } = makeSandboxEnv();
  try {
    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-20000001',
      task_id: '01M85TGX639NV8DHSJ391JD3XW',
      session_id: 's1',
      at: '2026-11-01T10:00:00Z',
      text: '第一個問題',
    }));
    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-20000002',
      task_id: '01M85TGX639NV8DHSJ391JD3XW',
      session_id: 's1',
      at: '2026-11-01T10:01:00Z',
      text: '第二個問題',
    }));

    const { asks } = loadState(env);
    const grouped = groupAsks(asks, Date.parse('2026-11-01T10:05:00Z'));
    assert.equal(grouped.length, 2);
  } finally {
    cleanup();
  }
});

test('legacy events without group_key are listed without error', () => {
  const { env, cleanup } = makeSandboxEnv();
  try {
    append(env, {
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-30000001',
      at: '2026-11-01T10:00:00Z',
      text: '舊事件沒有 group_key',
    });
    append(env, {
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-30000002',
      at: '2026-11-01T10:01:00Z',
      text: '舊事件沒有 group_key',
    });

    const out = listOutput(env, { nowMs: Date.parse('2026-11-01T10:05:00Z') });
    assert.equal(out.split('\n').length, 2);
  } finally {
    cleanup();
  }
});

test('archived after 14 days without new ask, reopened when asked again', () => {
  const { env, cleanup } = makeSandboxEnv();
  try {
    const q = '這個專案什麼時候上線？';
    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-40000001',
      session_id: 's1',
      at: '2026-11-01T00:00:00Z',
      text: q,
    }));

    const day14Ms = Date.parse('2026-11-15T00:00:00Z');
    let grouped = groupAsks(loadState(env).asks, day14Ms);
    assert.equal(grouped[0].archived, true);
    assert.match(listOutput(env, { nowMs: day14Ms }), /\[archived\]/);

    append(env, withGroupKey({
      schema: SCHEMA,
      kind: 'ask',
      ask_id: 'a-40000002',
      session_id: 's1',
      at: '2026-11-16T00:00:00Z',
      text: q,
    }));

    const day16Ms = Date.parse('2026-11-16T01:00:00Z');
    grouped = groupAsks(loadState(env).asks, day16Ms);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].count, 2);
    assert.equal(grouped[0].archived, false);
    assert.doesNotMatch(listOutput(env, { nowMs: day16Ms }), /\[archived\]/);
  } finally {
    cleanup();
  }
});

test('withGroupKey omits group_key when groupKey returns null', () => {
  assert.equal(groupKey('   !!!   '), null);
  const ev = withGroupKey({ kind: 'ask', text: '   !!!   ' });
  assert.equal('group_key' in ev, false);
});
