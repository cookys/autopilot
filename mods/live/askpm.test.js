// mods/live/askpm.test.js — pure view of the PM ask log. Rows in, window and status out.
// Red before askpm.ts existed: the import failed (ERR_MODULE_NOT_FOUND).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const G = require('./consolestrip.golden.js');

let A;
let I;
test.before(async () => {
  await G.load();
  A = await import(path.join(__dirname, 'askpm.ts'));
  I = await import(path.join(__dirname, 'i18n.ts'));
});

const ask = (at, text) => ({ schema: 'autopilot.askpm/1', kind: 'ask', at, text });
const reply = (at, text) => ({ schema: 'autopilot.askpm/1', kind: 'reply', at, lines: text.split('\n').slice(0, 2), text });

test('five-entry rolling window keeps the newest five', () => {
  const rows = [];
  for (let i = 1; i <= 7; i += 1) {
    rows.push(ask(`2026-11-10T0${i}:00:00.000Z`, `問題${i}這是第${i}題`));
    rows.push(reply(`2026-11-10T0${i}:00:05.000Z`, '已看過'));
  }
  const wide = A.askpmView(rows, { cols: 120 });
  assert.equal(wide.limit, 5);
  assert.equal(wide.entries.length, 5);
  assert.equal(wide.entries[0].summary.includes('問題3'), true);
  assert.equal(wide.entries[4].summary.includes('問題7'), true);
  assert.equal(wide.entries.some((e) => e.summary.includes('問題1')), false);
  assert.equal(wide.entries.some((e) => e.summary.includes('問題2')), false);
});

test('等回報 becomes 已回覆 when a later reply contains 已回報 and that question time', () => {
  const at = '2026-11-10T01:00:00.000Z'; // Taipei 2026-11-10 09:00:00
  const waiting = [
    ask(at, '記憶線合併了嗎'),
    reply('2026-11-10T01:00:05.000Z', '等回報：遊戲線\n先看測試'),
  ];
  const open = A.askpmView(waiting, { cols: 120 });
  assert.equal(open.entries[0].at, '2026-11-10 09:00:00');
  assert.equal(open.entries[0].status, 'waiting');
  assert.deepEqual(open.entries[0].replyLines, ['等回報：遊戲線', '先看測試']);
  const same = A.askpmView([
    ask(at, '記憶線合併了嗎'),
    reply('2026-11-10T01:00:05.000Z', '等回報：遊戲線\n已回報：2026-11-10 09:00:00'),
  ], { cols: 120 });
  assert.equal(same.entries[0].status, 'waiting', 'the same reply does not close its own wait');
  const closed = A.askpmView([
    ...waiting,
    ask('2026-11-10T02:00:00.000Z', '下一題'),
    reply('2026-11-10T02:00:05.000Z', '已回報：2026-11-10 09:00:00\n好了'),
  ], { cols: 120 });
  assert.equal(closed.entries[0].status, 'replied');
  assert.equal(closed.entries[1].status, 'replied');
});

test('a narrow panel shows three entries', () => {
  const rows = [];
  for (let i = 1; i <= 7; i += 1) rows.push(ask(`2026-11-10T0${i}:00:00.000Z`, `窄問題${i}`));
  const narrow = A.askpmView(rows, { cols: 76 });
  assert.equal(narrow.narrow, true);
  assert.equal(narrow.limit, 3);
  assert.equal(narrow.entries.length, 3);
  assert.equal(narrow.entries[0].summary.includes('窄問題5'), true);
  const forced = A.askpmView(rows, { narrow: true, cols: 120 });
  assert.equal(forced.entries.length, 3);
  const wide = A.askpmView(rows, { cols: 100 });
  assert.equal(wide.entries.length, 5);
});

test('summary is the first 40 code points and the section renders beside a wide queue', () => {
  const text = '甲'.repeat(50);
  const rows = [ask('2026-11-10T01:00:00.000Z', text), reply('2026-11-10T01:00:05.000Z', '好\n第二行')];
  const view = A.askpmView(rows, { cols: 120 });
  assert.equal([...view.entries[0].summary].length, 40);
  const u = { t: I.makeT('zh-TW'), cols: 40 };
  const lines = A.askpmLines(view, u);
  const joined = lines.map((l) => (l.segs ? l.segs.map((s) => s.text).join('') : l.text)).join('\n');
  assert.equal(joined.includes('我問的問題'), true);
  assert.equal(joined.includes('已回覆'), true);
  assert.equal(joined.includes('2026-11-10 09:00:00'), true);
  assert.equal(joined.includes('Z'), false);
});
