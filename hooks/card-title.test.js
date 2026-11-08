'use strict';

// hooks/card-title.test.js — the card's short title on the READ side: cardTitle's fallback (src/status/decision-input.js) and the
// optional `title` field in schemas/decision.schema.json (string, minLength 1, maxLength 20 code points, NOT required). The write
// side (scripts/open-decision.js --title) is a later task; this suite only pins the reader.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cardTitle } = require('../src/status/decision-input.js');

const CJK = '字'; // one code point, one UTF-16 unit
const EMOJI = '😀'; // one code point, TWO UTF-16 units (a surrogate pair)

test('an explicit title is returned as is, even when the question is long', () => {
  assert.equal(cardTitle({ title: '短標題', question: 'x'.repeat(30) }), '短標題');
});

test('no title, question exactly 20 code points: unchanged, no ellipsis', () => {
  assert.equal(cardTitle({ question: 'a'.repeat(20) }), 'a'.repeat(20));
});

test('no title, question 21 code points: first 20 plus the ellipsis', () => {
  assert.equal(cardTitle({ question: 'a'.repeat(21) }), 'a'.repeat(20) + '…');
});

test('an emoji (surrogate pair) counts as one char: kept whole at position 20, then the ellipsis', () => {
  // 19 CJK + 😀 + 4 more = 24 code points (25 UTF-16 units): truncated at 20 code points, the emoji at position 20 unsplit.
  assert.equal(cardTitle({ question: CJK.repeat(19) + EMOJI + '更多文字' }), CJK.repeat(19) + EMOJI + '…');
  // The boundary the negative control breaks: exactly 20 code points ending in the emoji = 21 UTF-16 units -> no truncation,
  // no ellipsis. A q.length check would count 21, append the ellipsis, and this assertion fails.
  assert.equal(cardTitle({ question: CJK.repeat(19) + EMOJI }), CJK.repeat(19) + EMOJI);
});

test('newline runs in the question become single spaces', () => {
  assert.equal(cardTitle({ question: '第一行\n第二行\r\n第三行' }), '第一行 第二行 第三行');
});

test('a trailing （共 N 題） suffix is removed: the spaced form ask-decision.js writes, and the no-space form', () => {
  assert.equal(cardTitle({ question: `要不要升級（共 ${3} 題）` }), '要不要升級');
  assert.equal(cardTitle({ question: '要不要升級（共3題）' }), '要不要升級');
});

test('an empty title string falls back to the question', () => {
  assert.equal(cardTitle({ title: '', question: '問題' }), '問題');
});

test('the schema declares the optional title: string, minLength 1, maxLength 20, not required', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'decision.schema.json'), 'utf8'));
  const item = schema.properties.decisions.items;
  assert.deepEqual(item.properties.title, { type: 'string', minLength: 1, maxLength: 20 });
  assert.ok(!item.required.includes('title'));
});
