'use strict';
// L1 unit tests for transcript-reader-lib.js — pure parse + path discovery +
// fail-open wrapper. Fixtures mirror the real Claude Code transcript JSONL shape
// captured during the 2026-06-02 spike.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findLatestToolEvent, resolveTranscriptPath, readLatestToolEvent } =
  require('./transcript-reader-lib.js');

// Helpers to build real-shape JSONL lines.
const asstToolUse = (id, name, input) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const userToolResult = (id, content, isError, toolUseResult) => {
  const rec = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }] },
  };
  if (toolUseResult !== undefined) rec.toolUseResult = toolUseResult;
  return JSON.stringify(rec);
};
const noise = () => JSON.stringify({ type: 'system', content: 'irrelevant' });

test('findLatestToolEvent: returns last tool_use with matching result', () => {
  const jsonl = [
    noise(),
    asstToolUse('t1', 'Read', { file_path: '/a.txt' }),
    userToolResult('t1', 'file contents', false),
    asstToolUse('t2', 'Bash', { command: 'ls', description: 'list' }),
    userToolResult('t2', 'a\nb\n', false),
  ].join('\n');
  const ev = findLatestToolEvent(jsonl);
  assert.equal(ev.tool_name, 'Bash');
  assert.deepEqual(ev.tool_input, { command: 'ls', description: 'list' });
  assert.equal(ev.tool_response, 'a\nb\n');
  assert.equal(ev.is_error, false);
  assert.equal(ev.tool_use_id, 't2');
});

test('findLatestToolEvent: picks the LAST tool_use even with trailing noise', () => {
  const jsonl = [
    asstToolUse('t1', 'Read', { file_path: '/a' }),
    userToolResult('t1', 'x', false),
    asstToolUse('t2', 'Write', { file_path: '/b' }),
    userToolResult('t2', 'ok', false),
    noise(),
  ].join('\n');
  assert.equal(findLatestToolEvent(jsonl).tool_name, 'Write');
});

test('findLatestToolEvent: tool_use without a result → tool_response undefined, not error', () => {
  const jsonl = [asstToolUse('t9', 'Grep', { pattern: 'x' })].join('\n');
  const ev = findLatestToolEvent(jsonl);
  assert.equal(ev.tool_name, 'Grep');
  assert.equal(ev.tool_response, undefined);
  assert.equal(ev.is_error, false);
});

test('findLatestToolEvent: is_error propagates', () => {
  const jsonl = [asstToolUse('e1', 'Bash', { command: 'false' }), userToolResult('e1', 'boom', true)].join('\n');
  assert.equal(findLatestToolEvent(jsonl).is_error, true);
});

test('findLatestToolEvent: richer toolUseResult overrides block content', () => {
  const jsonl = [
    asstToolUse('r1', 'Bash', { command: 'echo hi' }),
    userToolResult('r1', 'hi', false, { stdout: 'hi', stderr: '', exitCode: 0 }),
  ].join('\n');
  const ev = findLatestToolEvent(jsonl);
  assert.deepEqual(ev.tool_response, { stdout: 'hi', stderr: '', exitCode: 0 });
});

test('findLatestToolEvent: empty / garbage / no-tool input → null', () => {
  assert.equal(findLatestToolEvent(''), null);
  assert.equal(findLatestToolEvent('not json\n{bad'), null);
  assert.equal(findLatestToolEvent([noise(), noise()].join('\n')), null);
});

test('findLatestToolEvent: tolerates CRLF and oversized lines', () => {
  const big = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Big', input: { blob: 'z'.repeat(2 * 1024 * 1024) } }] } });
  const jsonl = [big, asstToolUse('ok', 'Read', { file_path: '/a' })].join('\r\n');
  // oversized line skipped → the small Read is the latest valid tool_use
  assert.equal(findLatestToolEvent(jsonl).tool_name, 'Read');
});

test('resolveTranscriptPath: finds <sessionId>.jsonl under projects/* regardless of dir name', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-some-weird-Encoded.path');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'd5aaeec5-9c18-4047-9fa0-e47964001bbb';
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), 'x');
  assert.equal(resolveTranscriptPath({ sessionId: sid, homedir: home }), path.join(dir, `${sid}.jsonl`));
  assert.equal(resolveTranscriptPath({ sessionId: 'no-such-id', homedir: home }), null);
  assert.equal(resolveTranscriptPath({ sessionId: '', homedir: home }), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('readLatestToolEvent: end-to-end via env + sandbox home; fail-open without env', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'abc12345-0000-0000-0000-000000000000';
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), [
    asstToolUse('z', 'Edit', { file_path: '/f' }), userToolResult('z', 'done', false),
  ].join('\n'));

  const ev = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
  assert.equal(ev.tool_name, 'Edit');

  assert.equal(readLatestToolEvent({ env: {}, homedir: home }), null, 'no session id → null');
  assert.equal(readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: 'missing' }, homedir: home }), null, 'missing transcript → null');
  fs.rmSync(home, { recursive: true, force: true });
});

test('Part 3.1: current-schema fixture with tail-window read', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'sid-tail-window-test';
  const filePath = path.join(dir, `${sid}.jsonl`);

  const reader = require('./transcript-reader-lib.js');
  const originalTailWindowBytes = reader.TAIL_WINDOW_BYTES;
  reader.TAIL_WINDOW_BYTES = 200;

  try {
    const headerNoise = noise().repeat(10); // ~400 bytes of noise
    const event1 = asstToolUse('t1', 'Bash', { command: 'ls' }); // ~130 bytes
    const event2 = userToolResult('t1', 'res', false); // ~100 bytes
    // Total file size will be around 630 bytes, which is > 200 bytes.
    // The last 200 bytes will include the event2 and part of event1.
    // The tail read will slice off the first partial line and parse the rest, finding 'Bash'.
    fs.writeFileSync(filePath, [headerNoise, event1, event2].join('\n') + '\n');

    const ev = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
    assert.ok(ev);
    assert.equal(ev.tool_name, 'Bash');
    assert.equal(ev.tool_response, 'res');
  } finally {
    reader.TAIL_WINDOW_BYTES = originalTailWindowBytes;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Part 3.2: event-beyond-window fixture with full-read fallback', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'sid-fallback-test';
  const filePath = path.join(dir, `${sid}.jsonl`);

  const reader = require('./transcript-reader-lib.js');
  const originalTailWindowBytes = reader.TAIL_WINDOW_BYTES;
  reader.TAIL_WINDOW_BYTES = 200;

  try {
    const event1 = asstToolUse('t1', 'Bash', { command: 'ls' }); // ~130 bytes
    const event2 = userToolResult('t1', 'res', false); // ~100 bytes
    const trailerNoise = noise().repeat(10); // ~400 bytes of noise at the end
    // Total file size is > 630 bytes. The last 200 bytes contain only trailer noise.
    // Tail read will find no tool events. It should fallback to full read and find 'Bash'.
    fs.writeFileSync(filePath, [event1, event2, trailerNoise].join('\n') + '\n');

    const ev = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
    assert.ok(ev);
    assert.equal(ev.tool_name, 'Bash');
    assert.equal(ev.tool_response, 'res');
  } finally {
    reader.TAIL_WINDOW_BYTES = originalTailWindowBytes;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Part 3.3: schema-changed fixture triggers canary exactly once', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'sid-canary-test';
  const filePath = path.join(dir, `${sid}.jsonl`);

  try {
    // Write a schema-changed fixture (different format/names)
    fs.writeFileSync(filePath, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'changed_tool_use', id: 'c1' }] } }) + '\n');

    // Run first call
    const ev1 = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
    assert.equal(ev1, null);

    // Verify marker and log files exist
    const autoDir = path.join(home, '.autopilot');
    const markerFile = path.join(autoDir, `.canary-${sid}`);
    const logFile = path.join(autoDir, 'transcript-canary.log');
    
    assert.ok(fs.existsSync(markerFile), 'Marker file should exist');
    assert.ok(fs.existsSync(logFile), 'Log file should exist');
    
    const lines1 = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines1.length, 1, 'Log should have exactly 1 line after first call');

    // Run second call
    const ev2 = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
    assert.equal(ev2, null);

    const lines2 = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.equal(lines2.length, 1, 'Log should still have exactly 1 line after second call (deduped)');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Part 3.3b: schema-changed fixture does not trigger canary when AUTOPILOT_NO_CANARY=1', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'sid-canary-disabled-test';
  const filePath = path.join(dir, `${sid}.jsonl`);

  try {
    fs.writeFileSync(filePath, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'changed_tool_use', id: 'c1' }] } }) + '\n');

    const ev = readLatestToolEvent({
      env: { CLAUDE_CODE_SESSION_ID: sid, AUTOPILOT_NO_CANARY: '1' },
      homedir: home,
    });
    assert.equal(ev, null);

    const autoDir = path.join(home, '.autopilot');
    const markerFile = path.join(autoDir, `.canary-${sid}`);
    const logFile = path.join(autoDir, 'transcript-canary.log');

    assert.ok(!fs.existsSync(markerFile), 'Marker file should NOT exist');
    assert.ok(!fs.existsSync(logFile), 'Log file should NOT exist');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Part 3.4: small-file fixture with byte-identical behavior', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-home-'));
  const dir = path.join(home, '.claude', 'projects', '-proj');
  fs.mkdirSync(dir, { recursive: true });
  const sid = 'sid-small-file-test';
  const filePath = path.join(dir, `${sid}.jsonl`);

  try {
    const event1 = asstToolUse('t1', 'Bash', { command: 'ls' });
    const event2 = userToolResult('t1', 'res', false);
    fs.writeFileSync(filePath, [event1, event2].join('\n') + '\n');

    const ev = readLatestToolEvent({ env: { CLAUDE_CODE_SESSION_ID: sid }, homedir: home });
    assert.ok(ev);
    assert.equal(ev.tool_name, 'Bash');
    assert.equal(ev.tool_response, 'res');

    const autoDir = path.join(home, '.autopilot');
    assert.ok(!fs.existsSync(autoDir), 'Autopilot directory should NOT be created for successful parses');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
