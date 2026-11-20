'use strict';

/**
 * Tests for scripts/lib/extract-json-object.js (transport-layer JSON recovery).
 * Run: node --test scripts/extract-json-object.test.js
 *
 * Pure string-in/string-out module: no fs, no env. Every case is inline text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonObject, repairBrackets } = require('./lib/extract-json-object.js');

test('extractJsonObject: a clean JSON object is returned verbatim', () => {
  assert.equal(extractJsonObject('{"a":1}'), '{"a":1}');
  assert.equal(extractJsonObject('{\n  "a": [1, 2],\n  "b": "x"\n}'), '{\n  "a": [1, 2],\n  "b": "x"\n}');
});

test('extractJsonObject: ```json fences are stripped', () => {
  assert.equal(extractJsonObject('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJsonObject('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJsonObject('  ```json\n{"a":1}\n```  '), '{"a":1}');
});

test('extractJsonObject: prose before the object is skipped (scan starts at first {)', () => {
  assert.equal(extractJsonObject('Here is the result:\n{"a":1}'), '{"a":1}');
  assert.equal(extractJsonObject('grade: B+\n{"findings":[{"id":1}],"ok":true}'), '{"findings":[{"id":1}],"ok":true}');
});

test('extractJsonObject: trailing prose after the closing brace is recovered by the suffix scan', () => {
  assert.equal(extractJsonObject('{"a":1}\nThe end.'), '{"a":1}');
  assert.equal(extractJsonObject('{"a":{"b":2}} done'), '{"a":{"b":2}}');
});

test('extractJsonObject: a dropped closing brace is repaired (1..8 insertions)', () => {
  // The documented temperature-0 failure: nested finding structure loses one brace.
  assert.equal(extractJsonObject('{"a": {"b": 1}'), '{"a": {"b": 1}}');
  assert.equal(extractJsonObject('{"findings":[{"id":1,"text":"x"}'), '{"findings":[{"id":1,"text":"x"}]}');
});

test('extractJsonObject: returns null when nothing is recoverable', () => {
  assert.equal(extractJsonObject('no braces here'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(null), null);
  assert.equal(extractJsonObject(undefined), null);
  assert.equal(extractJsonObject(12345), null);
  // A parse error that is not a bracket imbalance cannot be repaired or truncated.
  assert.equal(extractJsonObject('{"a": }'), null);
  assert.equal(extractJsonObject('{"a" 1}'), null);
});

test('extractJsonObject: more than 8 missing brackets is beyond repair', () => {
  // 9 opens, 0 closes -> repairBrackets must decline (inserted > 8) and the
  // suffix scan finds no closing brace to truncate at.
  assert.equal(extractJsonObject('{"a": ' + '['.repeat(9) + '1'), null);
});

test('repairBrackets: balanced input is returned as null (nothing inserted)', () => {
  assert.equal(repairBrackets('{"a":1}'), null);
  assert.equal(repairBrackets('{"a": "}{"}'), null); // brackets inside strings never count
});

test('repairBrackets: synthesizes the missing closers, innermost first', () => {
  assert.equal(repairBrackets('{"a": {"b": 1}'), '{"a": {"b": 1}}');
  // Mismatched closer: the array's closer was dropped before the object's.
  assert.equal(repairBrackets('{"a": [1, 2}'), '{"a": [1, 2]}');
  assert.equal(repairBrackets('[[1, 2]'), '[[1, 2]]');
  // Brackets inside a CLOSED string literal are data, not structure: only the
  // object's own missing closer is synthesized.
  assert.equal(repairBrackets('{"a": "}{"'), '{"a": "}{"}');
});

test('repairBrackets: an unmatched closer with an empty stack is unrecoverable', () => {
  assert.equal(repairBrackets('}'), null);
  assert.equal(repairBrackets('{"a":1}}'), null);
});

test('repairBrackets: the insertion budget is 1..8 inclusive', () => {
  assert.equal(repairBrackets('['.repeat(8)), '['.repeat(8) + ']'.repeat(8));
  assert.equal(repairBrackets('['.repeat(9)), null);
  assert.equal(repairBrackets('['.repeat(20)), null);
});
