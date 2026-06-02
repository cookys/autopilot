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
