'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyEvent,
  sliceEvents,
  scanCandidateItem,
  scanAndSampleEvents,
} = require('./pm-replay-slice.js');

function makeUserEntry(text, timestamp = '2026-11-23T10:00:00Z') {
  return {
    type: 'user',
    timestamp,
    message: { role: 'user', content: text },
  };
}

function makeAssistantEntry(text, timestamp = '2026-11-23T10:00:05Z') {
  return {
    type: 'assistant',
    timestamp,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 100, output_tokens: 20 },
    },
  };
}

test('sliceEvents handles three incoming formats and classifies six types + other', () => {
  const session = [
    makeUserEntry('Hello operator prompt', '2026-11-23T10:00:00Z'),
    makeAssistantEntry('ack 1', '2026-11-23T10:00:01Z'),
    {
      type: 'attachment',
      timestamp: '2026-11-23T10:01:00Z',
      attachment: { type: 'queued_command', prompt: '<channel source="x" kind="dispatch">run</channel>' },
    },
    {
      type: 'queue-operation',
      timestamp: '2026-11-23T10:02:00Z',
      content: '[fleet patrol] check',
    },
    makeUserEntry('[inbox batch #1]\n#1 item', '2026-11-23T10:03:00Z'),
    makeUserEntry('Stop hook feedback: please continue', '2026-11-23T10:04:00Z'),
    makeUserEntry('<task-notification>done</task-notification>', '2026-11-23T10:05:00Z'),
    {
      type: 'queue-operation',
      timestamp: '2026-11-23T10:06:00Z',
      content: 'unclassified system ping',
    },
  ];

  const events = sliceEvents(session);
  assert.equal(events.length, 7);
  assert.deepEqual(
    events.map((e) => e.type),
    ['operator', 'lane_result', 'patrol', 'inbox_batch', 'stop_hook', 'task_notification', 'other']
  );
  assert.equal(events[0].turns.length, 1);
  assert.equal(classifyEvent(session[0], 'plain text'), 'operator');
});

test('two-level scan: level 1 discards secret-bearing event, level 2 redacts personal data', () => {
  const fakeToken = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
  const secretEvent = {
    id: 'e1',
    type: 'operator',
    text: `use key ${fakeToken}`,
    turns: [],
  };
  const piiEvent = {
    id: 'e2',
    type: 'operator',
    text: 'read /home/alice/project and mail alice@corp.example.net',
    turns: [],
  };

  const resSecret = scanCandidateItem(secretEvent);
  assert.equal(resSecret.passed, false);
  assert.equal(resSecret.discarded, true);
  assert.ok(resSecret.level1Hits >= 1);

  // Negative control: disabling level 1 lets the fake key through (must fail if level 1 is off)
  const resDisabled = scanCandidateItem(secretEvent, { disableLevel1: true });
  assert.equal(resDisabled.passed, true);

  const resPii = scanCandidateItem(piiEvent);
  assert.equal(resPii.passed, true);
  assert.ok(resPii.level2Replacements >= 1);
  assert.ok(!resPii.item.text.includes('/home/alice'));
  assert.ok(!resPii.item.text.includes('alice@corp.example.net'));
});

test('scanAndSampleEvents: deterministic with fixed seed and aborts on insufficient quota', () => {
  const events = [
    { id: 'op1', type: 'operator', text: 'op 1', turns: [] },
    { id: 'op2', type: 'operator', text: 'op 2', turns: [] },
    { id: 'op3', type: 'operator', text: 'op 3', turns: [] },
    { id: 'lr1', type: 'lane_result', text: 'lr 1', turns: [] },
    { id: 'oth1', type: 'other', text: 'other 1', turns: [] },
  ];

  const quota = { operator: 2, lane_result: 1 };
  const run1 = scanAndSampleEvents(events, quota, 42);
  const run2 = scanAndSampleEvents(events, quota, 42);

  assert.deepEqual(
    run1.selected.map((e) => e.id),
    run2.selected.map((e) => e.id)
  );
  assert.equal(run1.otherCount, 1);

  assert.throws(
    () => scanAndSampleEvents(events, { operator: 2, lane_result: 2 }, 42),
    /Insufficient quota.*lane_result/
  );
});
