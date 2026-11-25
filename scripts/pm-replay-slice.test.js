'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
  loadSessionsFromDirs,
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

test('buildPrefillPrefix and writeSliceOutput: shifts prefix start past Level-1 hit, sets shortPrefix, preserves tool pairs, and leaks no secret', () => {
  const fakeToken = ['sk', 'ant', 'api03', 'midprefixsecret1234567890abcdefg'].join('-');
  const session = [
    makeUserEntry('earlier prefix prompt before secret', '2026-11-23T08:00:00Z'),
    makeAssistantEntry('earlier prefix reply before secret', '2026-11-23T08:00:01Z'),
    makeUserEntry('middle prefix event before secret turn', '2026-11-23T08:10:00Z'),
    makeAssistantEntry(`leaked secret ${fakeToken}`, '2026-11-23T08:10:01Z'),
    makeUserEntry('clean suffix prefix prompt', '2026-11-23T08:20:00Z'),
    makeAssistantEntry('clean suffix prefix reply', '2026-11-23T08:20:01Z'),
    makeUserEntry('[fleet patrol] check selected event', '2026-11-23T09:00:00Z'),
    makeAssistantEntry('patrol ack', '2026-11-23T09:00:01Z'),
  ];

  // Shifted prefix shorter than level => excludes secret turn & earlier turns, shortPrefix: true
  const shortRes = buildPrefillPrefix(session, 6, 1000, [0, 2, 4, 6]);
  assert.equal(shortRes.startIndex, 4);
  assert.equal(shortRes.endIndex, 6);
  assert.equal(shortRes.turns.length, 2);
  assert.equal(shortRes.shortPrefix, true);
  assert.ok(!JSON.stringify(shortRes.turns).includes(fakeToken));
  assert.ok(!JSON.stringify(shortRes.turns).includes('earlier prefix'));
  assert.ok(!JSON.stringify(shortRes.turns).includes('middle prefix'));

  // Remaining prefix reaches level => shortPrefix: false
  const enoughRes = buildPrefillPrefix(session, 6, 15, [0, 2, 4, 6]);
  assert.equal(enoughRes.startIndex, 4);
  assert.equal(enoughRes.endIndex, 6);
  assert.equal(enoughRes.turns.length, 2);
  assert.equal(enoughRes.shortPrefix, false);

  // No clean boundary remains after secret => empty prefix, no throw, shortPrefix: true
  const emptyRes = buildPrefillPrefix(session, 4, 100, [0, 2, 4]);
  assert.equal(emptyRes.turns.length, 0);
  assert.equal(emptyRes.turnCount, 0);
  assert.equal(emptyRes.estimatedTokens, 0);
  assert.equal(emptyRes.shortPrefix, true);

  // Secret inside tool_use: shifted start must not land on its paired tool_result boundary
  const pairSession = [
    makeUserEntry('before pair', '2026-11-23T08:00:00Z'),
    {
      type: 'assistant',
      timestamp: '2026-11-23T08:00:01Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_secret', name: 'Read', input: { token: fakeToken } }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-11-23T08:00:02Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_secret', content: 'ok' },
          { type: 'text', text: 'paired user text' },
        ],
      },
    },
    makeUserEntry('clean after pair', '2026-11-23T08:01:00Z'),
    makeUserEntry('selected event', '2026-11-23T09:00:00Z'),
  ];
  const pairRes = buildPrefillPrefix(pairSession, 4, 100, [0, 2, 3, 4]);
  assert.equal(pairRes.startIndex, 3);
  assert.equal(pairRes.endIndex, 4);
  assert.equal(pairRes.turns.length, 1);
  assert.equal(pairRes.shortPrefix, true);
  assert.ok(!JSON.stringify(pairRes.turns).includes('tu_secret'));

  // End-to-end writeSliceOutput: shortPrefix in manifest & prefix-<level>.json, no secret leaked
  const events = sliceEvents(session);
  const sample = scanAndSampleEvents(events, { patrol: 1 }, 1);
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-replay-prefix-shift-'));
  const outDir = path.join(tmpBase, 'out');
  try {
    writeSliceOutput(outDir, session, sample, { seed: 1, levels: [1000] });

    const manifestRaw = fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    assert.equal(manifest.prefixes.length, 1);
    assert.equal(manifest.prefixes[0].startIndex, 4);
    assert.equal(manifest.prefixes[0].endIndex, 6);
    assert.equal(manifest.prefixes[0].turnCount, 2);
    assert.equal(manifest.prefixes[0].shortPrefix, true);
    assert.ok(!manifestRaw.includes(fakeToken));

    const prefixRaw = fs.readFileSync(path.join(outDir, 'prefix-1000.json'), 'utf8');
    const prefixJson = JSON.parse(prefixRaw);
    assert.equal(prefixJson.startIndex, 4);
    assert.equal(prefixJson.endIndex, 6);
    assert.equal(prefixJson.turns.length, 2);
    assert.equal(prefixJson.shortPrefix, true);
    assert.ok(!prefixRaw.includes(fakeToken));
    assert.ok(!prefixRaw.includes('earlier prefix prompt before secret'));
    assert.ok(!prefixRaw.includes('earlier prefix reply before secret'));
    assert.ok(!prefixRaw.includes('middle prefix event before secret turn'));
    assert.ok(prefixRaw.includes('clean suffix prefix prompt'));
    assert.ok(prefixRaw.includes('clean suffix prefix reply'));

    for (const relPath of Object.keys(manifest.files)) {
      const raw = fs.readFileSync(path.join(outDir, relPath), 'utf8');
      assert.ok(!raw.includes(fakeToken));
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('loadSessionsFromDirs: streams across small chunks with same result as full-file read, skips bad JSON, preserves order, and filters --since at load time', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-replay-stream-'));
  try {
    const file1Entries = [
      makeUserEntry('old prompt before since', '2026-11-21T23:59:59Z'),
      makeAssistantEntry('old reply before since', '2026-11-21T23:59:59Z'),
      makeUserEntry('boundary prompt at since', '2026-11-22T00:00:00Z'),
    ];
    const file2Entries = [
      makeAssistantEntry('boundary reply after since', '2026-11-22T00:00:05Z'),
      makeUserEntry('later prompt without trailing newline', '2026-11-23T01:02:03Z'),
    ];

    const file1Content = [
      JSON.stringify(file1Entries[0]),
      '{"type":"user", broken json line',
      '',
      JSON.stringify(file1Entries[1]),
      JSON.stringify(file1Entries[2]),
    ].join('\n') + '\n';

    const file2Content = [
      JSON.stringify(file2Entries[0]),
      'not-valid-json-at-all',
      JSON.stringify(file2Entries[1]),
    ].join('\n'); // intentionally no trailing newline

    assert.ok(Buffer.byteLength(file1Content, 'utf8') > 64);
    assert.ok(Buffer.byteLength(file2Content, 'utf8') > 64);

    // Write in reverse filename order to verify sorted loading
    fs.writeFileSync(path.join(tmpBase, '02-second.jsonl'), file2Content, 'utf8');
    fs.writeFileSync(path.join(tmpBase, '01-first.jsonl'), file1Content, 'utf8');
    fs.writeFileSync(path.join(tmpBase, 'ignore.txt'), '{"ignored":true}\n', 'utf8');

    // Reference full-file read
    const fullReadExpected = [];
    for (const file of fs.readdirSync(tmpBase).filter((f) => f.endsWith('.jsonl')).sort()) {
      for (const line of fs.readFileSync(path.join(tmpBase, file), 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          fullReadExpected.push(JSON.parse(trimmed));
        } catch {
          // skip malformed line
        }
      }
    }

    const stats = {};
    const streamed = loadSessionsFromDirs([tmpBase], { chunkSize: 64, stats });
    assert.ok(Array.isArray(streamed));
    assert.deepEqual(streamed, fullReadExpected);
    assert.equal(streamed.length, 5);
    assert.equal(stats.skippedBadLines, 2);
    assert.equal(stats.loadedCount, 5);

    // --since drops earlier entries during load while preserving >= since items in order
    const sinceStats = {};
    const filtered = loadSessionsFromDirs([tmpBase], {
      chunkSize: 64,
      since: '2026-11-22T00:00:00Z',
      stats: sinceStats,
    });
    assert.deepEqual(filtered, [file1Entries[2], file2Entries[0], file2Entries[1]]);
    assert.equal(sinceStats.skippedBadLines, 2);
    assert.equal(sinceStats.loadedCount, 3);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('loadSessionsFromDirs: correctly splices lines longer than chunkSize (64 bytes) including multibyte UTF-8 across chunk boundaries', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-replay-splice-'));
  try {
    // Each JSON line intentionally exceeds 64 bytes (spanning multiple chunks) and puts
    // multibyte UTF-8 characters across the 64-byte chunk boundary.
    // Negative control: breaking cross-chunk carry-over (`rest + dec.write(...)`) splits
    // these >64-byte lines mid-JSON so they fail JSON.parse and this test goes RED.
    const entry1 = makeUserEntry(
      `${'x'.repeat(28)}PM 收件匣批次包跨段測試${'y'.repeat(80)}`,
      '2026-11-23T10:00:00Z'
    );
    const entry2 = makeAssistantEntry(
      `long assistant response spanning multiple 64-byte chunks: ${'z'.repeat(110)}`,
      '2026-11-23T10:00:05Z'
    );
    const entry3 = makeUserEntry(
      `final long line without trailing newline ${'w'.repeat(90)}`,
      '2026-11-23T10:01:00Z'
    );
    const badLongLine = `{"broken":"${'q'.repeat(80)}`;

    const line1 = JSON.stringify(entry1);
    const line2 = JSON.stringify(entry2);
    const line3 = JSON.stringify(entry3);
    assert.ok(Buffer.byteLength(line1, 'utf8') > 128);
    assert.ok(Buffer.byteLength(line2, 'utf8') > 128);
    assert.ok(Buffer.byteLength(line3, 'utf8') > 128);
    assert.ok(Buffer.byteLength(badLongLine, 'utf8') > 64);

    fs.writeFileSync(
      path.join(tmpBase, 'long-lines.jsonl'),
      [line1, badLongLine, line2, line3].join('\n'),
      'utf8'
    );

    const stats = {};
    const loaded = loadSessionsFromDirs([tmpBase], { chunkSize: 64, stats });
    assert.deepEqual(loaded, [entry1, entry2, entry3]);
    assert.equal(stats.skippedBadLines, 1);
    assert.equal(stats.loadedCount, 3);
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

test('CLI main prints skipped_bad_lines and loaded_items counts to stderr without leaking line content', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-replay-cli-'));
  try {
    const sessionsDir = path.join(tmpBase, 'sessions');
    const outDir = path.join(tmpBase, 'out');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const badSentinel = 'SENTINEL_BAD_LINE_CONTENT_DO_NOT_PRINT';
    const userSentinel = 'SENTINEL_USER_PROMPT_DO_NOT_PRINT';
    const content = [
      JSON.stringify(makeUserEntry('old prompt before since', '2026-11-20T00:00:00Z')),
      `{invalid json ${badSentinel}`,
      JSON.stringify(makeUserEntry(`operator hello ${userSentinel}`, '2026-11-23T10:00:00Z')),
      JSON.stringify(makeAssistantEntry('ack reply', '2026-11-23T10:00:01Z')),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(sessionsDir, 'session.jsonl'), content, 'utf8');

    const res = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'pm-replay-slice.js'),
        '--sessions-dir', sessionsDir,
        '--out', outDir,
        '--quota', 'operator=1',
        '--levels', '100',
        '--since', '2026-11-22T00:00:00Z',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );

    assert.equal(res.status, 0, res.stderr);
    const stderrLines = res.stderr.trim().split('\n');
    assert.deepEqual(stderrLines, [
      'skipped_bad_lines: 1',
      'loaded_items: 2',
    ]);
    assert.ok(!res.stderr.includes(badSentinel));
    assert.ok(!res.stderr.includes(userSentinel));
    assert.ok(fs.existsSync(path.join(outDir, 'manifest.json')));
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

const slice = require('./pm-replay-slice.js');
test('v4 defaults: 30 strata, six prefill levels, --screening gives the 12-segment quota', () => {
  const sum = (q) => Object.values(q).reduce((a, b) => a + b, 0);
  assert.equal(sum(slice.DEFAULT_QUOTA), 30);
  assert.deepEqual(slice.DEFAULT_QUOTA, { operator: 8, lane_result: 7, patrol: 5, inbox_batch: 5, stop_hook: 3, task_notification: 2 });
  assert.deepEqual(slice.DEFAULT_LEVELS, [100000, 150000, 250000, 300000, 350000, 450000]);
  const def = slice.parseArgs([]);
  assert.deepEqual(def.levels, slice.DEFAULT_LEVELS);
  const scr = slice.parseArgs(['--screening']);
  assert.equal(sum(scr.quota), 12);
  for (const k of Object.keys(slice.DEFAULT_QUOTA)) assert.ok(scr.quota[k] <= slice.DEFAULT_QUOTA[k]);
});
