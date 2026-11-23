'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  classifyEvent,
  sliceEvents,
  scanCandidateItem,
  scanAndSampleEvents,
  buildPrefillPrefix,
  writeSliceOutput,
  parseArgs,
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

test('buildPrefillPrefix never splits tool_use and tool_result pair', () => {
  const session = [
    makeUserEntry('a'.repeat(40), '2026-11-23T09:00:00Z'),
    {
      type: 'assistant',
      timestamp: '2026-11-23T09:00:01Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'x'.repeat(200) } }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-11-23T09:00:02Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'y'.repeat(40) }],
      },
    },
    makeUserEntry('selected event', '2026-11-23T10:00:00Z'),
  ];

  // Earlier safe boundary (endIndex=1, ~11 tokens) is closer to level 30 than endIndex=3 (~101 tokens)
  const prefixDown = buildPrefillPrefix(session, 3, 30, [0, 3]);
  assert.equal(prefixDown.endIndex, 1);
  assert.equal(prefixDown.turns.length, 1);

  // Later safe boundary (endIndex=3, ~101 tokens) is closer to level 80 than endIndex=1 (~11 tokens)
  const prefixUp = buildPrefillPrefix(session, 3, 80, [0, 3]);
  assert.equal(prefixUp.endIndex, 3);
  assert.equal(prefixUp.turns.length, 3);
});

test('writeSliceOutput: writes deterministic files, verifies sha256, rejects non-empty dir, and leaks no matched content', () => {
  const fakeToken = ['sk', 'ant', 'api03', 'secretkeyvalue1234567890abcdefgh'].join('-');
  const session = [
    makeUserEntry('prefix turn for /home/alice/repo', '2026-11-23T09:00:00Z'),
    makeAssistantEntry('prefix reply', '2026-11-23T09:00:01Z'),
    makeUserEntry(`secret prompt ${fakeToken}`, '2026-11-23T09:30:00Z'),
    makeUserEntry('operator prompt from alice@corp.example.net', '2026-11-23T10:00:00Z'),
    {
      type: 'assistant',
      timestamp: '2026-11-23T10:00:05Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Edit', input: { file_path: '/home/alice/x.js' } }],
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    },
    {
      type: 'user',
      timestamp: '2026-11-23T10:00:06Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'edited' }],
      },
    },
  ];

  const events = sliceEvents(session);
  const sample1 = scanAndSampleEvents(events, { operator: 1 }, 7);
  const sample2 = scanAndSampleEvents(events, { operator: 1 }, 7);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-replay-b-'));
  const out1 = path.join(tmpBase, 'out1');
  const out2 = path.join(tmpBase, 'out2');

  writeSliceOutput(out1, session, sample1, { seed: 7, levels: [100] });
  writeSliceOutput(out2, session, sample2, { seed: 7, levels: [100] });

  // Non-empty directory must be rejected
  assert.throws(
    () => writeSliceOutput(out1, session, sample1, { seed: 7, levels: [100] }),
    /not empty/
  );

  const manifest1 = JSON.parse(fs.readFileSync(path.join(out1, 'manifest.json'), 'utf8'));
  const manifest2 = JSON.parse(fs.readFileSync(path.join(out2, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest1, manifest2);

  // Verify every file sha256 matches manifest and no matched secret/PII appears in any output file
  for (const [relPath, expectedHash] of Object.entries(manifest1.files)) {
    const raw = fs.readFileSync(path.join(out1, relPath), 'utf8');
    const actualHash = crypto.createHash('sha256').update(raw).digest('hex');
    assert.equal(actualHash, expectedHash);
    assert.ok(!raw.includes(fakeToken));
    assert.ok(!raw.includes('/home/alice'));
    assert.ok(!raw.includes('alice@corp.example.net'));
  }

  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('parseArgs parses repeatable --sessions-dir and options', () => {
  const args = parseArgs([
    '--sessions-dir', '/tmp/a',
    '--sessions-dir', '/tmp/b',
    '--out', '/tmp/out',
    '--seed', '9',
    '--levels', '100,200',
    '--quota', 'operator=2,patrol=1',
    '--since', '2026-11-23T00:00:00Z',
  ]);
  assert.deepEqual(args.sessionsDirs, ['/tmp/a', '/tmp/b']);
  assert.equal(args.out, '/tmp/out');
  assert.equal(args.seed, 9);
  assert.deepEqual(args.levels, [100, 200]);
  assert.deepEqual(args.quota, { operator: 2, patrol: 1 });
  assert.equal(args.since, '2026-11-23T00:00:00Z');
});
