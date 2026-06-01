/**
 * L1 unit tests for state-checkpoint-lib.js pure helpers.
 *
 * Run: node --test hooks/state-checkpoint.test.js
 *      (also runs as part of `bash hooks/tests/run.sh`)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  truncateUtf8Safe,
  renderContentBlocks,
  extractTurn,
  parseTranscriptText,
  buildTranscriptTail,
  emitFailure,
  PER_TURN_BUDGET,
  THINKING_BLOCK_CAP,
} = require('./state-checkpoint-lib.js');

// ──────────────── truncateUtf8Safe ────────────────

test('truncateUtf8Safe: no-op when input within budget', () => {
  const r = truncateUtf8Safe('hello', 10);
  assert.equal(r.text, 'hello');
  assert.equal(r.truncated, false);
  assert.equal(r.originalBytes, 5);
});

test('truncateUtf8Safe: cuts at UTF-8 codepoint boundary', () => {
  // 你=E4BDA0 (3B), 好=E5A5BD (3B), 世=E4B896 (3B), 界=E7958C (3B) → 12 bytes total
  // maxBytes=5 means we can fit only 你 (3 bytes); 好's 1st continuation byte at index 3 would overflow.
  const r = truncateUtf8Safe('你好世界', 5);
  assert.equal(r.text, '你');
  assert.equal(r.truncated, true);
  assert.equal(r.originalBytes, 12);
});

test('truncateUtf8Safe: legitimate U+FFFD survives (no replacement-char strip)', () => {
  const input = 'valid � text';   // U+FFFD is 3 bytes; total ~14B
  const r = truncateUtf8Safe(input, 100);
  assert.equal(r.text, input);
  assert.equal(r.truncated, false);
});

test('truncateUtf8Safe: handles ASCII-only fast path', () => {
  const r = truncateUtf8Safe('a'.repeat(100), 50);
  assert.equal(r.text.length, 50);
  assert.equal(r.truncated, true);
});

// ──────────────── renderContentBlocks ────────────────

test('renderContentBlocks: text block returns its text', () => {
  assert.equal(renderContentBlocks([{ type: 'text', text: 'hi' }]), 'hi');
});

test('renderContentBlocks: thinking block wrapped + capped at THINKING_BLOCK_CAP', () => {
  const big = 'X'.repeat(THINKING_BLOCK_CAP + 100);
  const out = renderContentBlocks([{ type: 'thinking', thinking: big }]);
  assert.match(out, /^<thinking>X{1,}\[\.\.\.thinking truncated\]<\/thinking>$/);
});

test('renderContentBlocks: tool_use surfaces name', () => {
  assert.equal(renderContentBlocks([{ type: 'tool_use', name: 'Bash' }]), '[tool_use: Bash(...)]');
});

test('renderContentBlocks: tool_result shows byte size for string content', () => {
  assert.equal(renderContentBlocks([{ type: 'tool_result', content: 'abc' }]), '[tool_result: 3B]');
});

test('renderContentBlocks: tool_result shows JSON size for array content', () => {
  const arr = [{ type: 'text', text: 'x' }];
  const expected = JSON.stringify(arr).length;
  assert.equal(renderContentBlocks([{ type: 'tool_result', content: arr }]), `[tool_result: ${expected}B]`);
});

test('renderContentBlocks: image block', () => {
  assert.equal(renderContentBlocks([{ type: 'image', source: { type: 'base64' } }]), '[image]');
});

test('renderContentBlocks: unknown block type still rendered (no throw)', () => {
  assert.equal(renderContentBlocks([{ type: 'future_thing' }]), '[future_thing]');
});

test('renderContentBlocks: null / non-object blocks are skipped', () => {
  assert.equal(renderContentBlocks([null, undefined, 'string', { type: 'text', text: 'kept' }]), 'kept');
});

// ──────────────── extractTurn ────────────────

test('extractTurn: string content turn', () => {
  const t = extractTurn({ type: 'user', timestamp: 'T1', message: { content: 'hello' } });
  assert.deepEqual(t, { role: 'user', text: 'hello', timestamp: 'T1' });
});

test('extractTurn: array content turn → renders via renderContentBlocks', () => {
  const t = extractTurn({
    type: 'assistant',
    timestamp: 'T2',
    message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'Read' }] },
  });
  assert.equal(t.text, 'a\n[tool_use: Read(...)]');
});

test('extractTurn: returns null when message absent', () => {
  assert.equal(extractTurn({ type: 'user' }), null);
});

test('extractTurn: unknown content shape → JSON stub', () => {
  const t = extractTurn({ type: 'assistant', message: { content: { weird: true } } });
  assert.match(t.text, /\[non-standard content/);
});

// ──────────────── parseTranscriptText ────────────────

test('parseTranscriptText: filters non user/assistant records', () => {
  const text = [
    JSON.stringify({ type: 'permission-mode' }),
    JSON.stringify({ type: 'user', message: { content: 'a' } }),
    JSON.stringify({ type: 'file-history-snapshot' }),
    JSON.stringify({ type: 'assistant', message: { content: 'b' } }),
  ].join('\n');
  const r = parseTranscriptText(text);
  assert.equal(r.turns.length, 2);
  assert.equal(r.filteredOut, 2);
  assert.equal(r.errors, 0);
});

test('parseTranscriptText: CRLF tolerated', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { content: 'a' } }),
    JSON.stringify({ type: 'user', message: { content: 'b' } }),
  ].join('\r\n');
  const r = parseTranscriptText(text);
  assert.equal(r.turns.length, 2);
});

test('parseTranscriptText: malformed JSON line counted in errors but parsing continues', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { content: 'a' } }),
    '{not valid json',
    JSON.stringify({ type: 'user', message: { content: 'b' } }),
  ].join('\n');
  const r = parseTranscriptText(text);
  assert.equal(r.turns.length, 2);
  assert.equal(r.errors, 1);
});

test('parseTranscriptText: empty input → 0 turns', () => {
  const r = parseTranscriptText('');
  assert.equal(r.turns.length, 0);
  assert.equal(r.totalRecords, 0);
});

// ──────────────── buildTranscriptTail ────────────────

test('buildTranscriptTail: empty turns → empty body', () => {
  const r = buildTranscriptTail([]);
  assert.equal(r.body, '');
  assert.equal(r.metadata.kept, 0);
});

test('buildTranscriptTail: newest turn exempt from PER_TURN_BUDGET', () => {
  // Single big newest turn (3000 bytes) should be preserved verbatim, not truncated.
  const bigText = 'X'.repeat(3000);
  const turns = [{ role: 'user', text: bigText, timestamp: 'T' }];
  const r = buildTranscriptTail(turns, { tailN: 20, byteCap: 8192 });
  assert.ok(r.body.includes(bigText), 'newest turn body present verbatim');
  assert.ok(!r.body.includes('turn truncated'), 'no per-turn-truncate marker on newest');
});

test('buildTranscriptTail: older turn over PER_TURN_BUDGET gets truncated', () => {
  const big = 'Y'.repeat(PER_TURN_BUDGET + 500);
  const turns = [
    { role: 'user', text: big, timestamp: 'T1' },        // older — should be truncated
    { role: 'assistant', text: 'small', timestamp: 'T2' }, // newest
  ];
  const r = buildTranscriptTail(turns);
  assert.ok(r.body.includes('turn truncated'), 'older turn flagged truncated');
  assert.ok(r.body.includes('small'), 'newest still verbatim');
});

test('buildTranscriptTail: respects tailN slicing', () => {
  const turns = Array.from({ length: 50 }, (_, i) => ({
    role: 'user', text: `turn ${i}`, timestamp: `T${i}`,
  }));
  const r = buildTranscriptTail(turns, { tailN: 5, byteCap: 100000 });
  assert.equal(r.metadata.kept, 5);
  assert.ok(r.body.includes('turn 49'));
  assert.ok(!r.body.includes('turn 44'));
});

// ──────────────── emitFailure ────────────────

test('emitFailure: returns failure message with reason + lastStep', () => {
  const msg = emitFailure('test reason', 'unit step');
  assert.match(msg, /## Transcript Tail: FAILED/);
  assert.match(msg, /Reason: test reason/);
  assert.match(msg, /Last successful step: unit step/);
});

test('emitFailure: optional stderr-like sink receives diag line', () => {
  const captured = [];
  const sink = { write(s) { captured.push(s); } };
  emitFailure('r', 's', '', sink);
  assert.equal(captured.length, 1);
  assert.match(captured[0], /\[state-checkpoint\] r at "s"/);
});

test('emitFailure: extraDetail included when provided', () => {
  const msg = emitFailure('r', 's', 'extra info');
  assert.match(msg, /Detail: extra info/);
});
