'use strict';

// hooks/card-title-write.test.js — the WRITE side of the card's short title that needs no repo fixture:
//   1. scripts/lib/card-notice.js: a notice without `title` (old sender) and with `title` (new sender) both parse; one more unknown key, or a bad title, is still refused whole.
//   2. mods/live/cardtitle.ts (the live mod's copy of the rule, since a mod cannot require src/ JS) agrees with cardTitle() in src/status/decision-input.js on every input here.
// Negative controls (shown red before green): KEYS accepting only the titled set -> the "old format" case fails; the 20-code-point check dropped -> the 21 case fails;
// one character of the rule changed in mods/live/cardtitle.ts (20 -> 19) -> the comparison case fails.

require('../scripts/lib/test-git-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { encode, parse, PREFIX } = require('../scripts/lib/card-notice.js');
const { cardTitle } = require('../src/status/decision-input.js');

const base = { card_id: 'd-0a1b2c3d', question: 'Which way?', state: 'open', at: '2026-11-09T01:02:03.000Z', session: null };
const line = (extra, drop = []) => {
  const o = { ...JSON.parse(encode('open', base).slice(PREFIX.length)), ...extra };
  for (const k of drop) delete o[k];
  return PREFIX + JSON.stringify(o);
};

test('card-notice: the old format (no title) parses', () => {
  const r = parse(encode('open', base));
  assert.equal(r.ok, true);
  assert.equal('title' in r.notice, false);
});

test('card-notice: the new format (with title) parses and keeps the title; encode puts it in only when given', () => {
  const r = parse(encode('open', { ...base, title: '發版時機' }));
  assert.equal(r.ok, true);
  assert.equal(r.notice.title, '發版時機');
  assert.equal(parse(encode('open', { ...base, title: '' })).notice.title, undefined);
});

test('card-notice: an unknown extra key is still refused, with or without a title', () => {
  assert.equal(parse(line({ extra: 1 })).ok, false);
  assert.equal(parse(line({ title: 'ok', extra: 1 })).ok, false);
});

test('card-notice: a title over 20 code points, an empty or non-string one is refused', () => {
  assert.equal(parse(line({ title: '字'.repeat(20) })).ok, true);
  assert.equal(parse(line({ title: '字'.repeat(21) })).ok, false);
  assert.equal(parse(line({ title: '😀'.repeat(20) })).ok, true);
  assert.equal(parse(line({ title: '' })).ok, false);
  assert.equal(parse(line({ title: 7 })).ok, false);
});

test('mods/live/cardtitle.ts applies the same rule as cardTitle() in src/status/decision-input.js', async () => {
  const { cardTitleOf } = await import(path.join(__dirname, '..', 'mods', 'live', 'cardtitle.ts'));
  const cases = [
    { title: '短標題', question: 'x'.repeat(30) },
    { title: '', question: '問題' },
    { title: null, question: 'a'.repeat(20) },
    { question: 'a'.repeat(21) },
    { question: '字'.repeat(19) + '😀' },
    { question: '字'.repeat(19) + '😀' + '更多文字' },
    { question: '第一行\n第二行\r\n第三行' },
    { question: '要不要升級（共 3 題）' },
    { question: '要不要升級（共3題）' },
    { question: '  空白  ' },
    { question: '' },
  ];
  for (const c of cases) assert.equal(cardTitleOf(c), cardTitle(c), JSON.stringify(c));
});

test('a control character in a title: ask-decision drops the header, cardTitle ignores a stored title that has one, the mod copy agrees', async () => {
  const { questionFrom } = require('./ask-decision.js');
  const ask = (header) => questionFrom({ questions: [{ question: '要不要發版？', header, options: [] }] });
  assert.equal(ask('發版時機').title, '發版時機');
  for (const bad of ['發版\n時機', '發版\u001b[31m', '發版\u2028時機']) {
    assert.equal('title' in ask(bad), false, 'header with a control character writes no title: ' + JSON.stringify(bad));
    assert.equal(cardTitle({ title: bad, question: '要不要發版？' }), '要不要發版？', 'cardTitle derives from the question: ' + JSON.stringify(bad));
  }
  const { cardTitleOf } = await import(path.join(__dirname, '..', 'mods', 'live', 'cardtitle.ts'));
  for (const bad of ['發版\n時機', '發版\u001b[31m', '發版\u2028時機']) assert.equal(cardTitleOf({ title: bad, question: '要不要發版？' }), cardTitle({ title: bad, question: '要不要發版？' }));
});
