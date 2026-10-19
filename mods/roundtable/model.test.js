// # RED at 0de69d4e5: model.ts missing — import of parseRoomLog / wrapToWidth / visibleLines / nextOffset / rowRole fails (ERR_MODULE_NOT_FOUND).
// mods/roundtable/model.test.js — pure room-log display. Run: node --test mods/roundtable/model.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

let m
let ui
test.before(async () => {
  m = await import(path.join(__dirname, 'model.ts'))
  ui = await import(path.join(__dirname, '../live/ui.ts'))
})

const row = (over) => ({
  ts: '2026-10-19T00:00:00.000Z', room: 'design', seq: 1, from: 'owner', kind: 'say', text: '你好', reply_to: null, ...over,
})
const line = (over) => JSON.stringify(row(over))

test('parse: Chinese and a newline inside text stay one row; a trailing partial line is ignored; a malformed line is skipped', () => {
  const good = line({ text: '第一行\n第二行：圓桌', seq: 1 })
  const bad = '{not json'
  const partial = '{"seq":2,"text":"cut'
  const text = good + '\n' + bad + '\n' + partial
  const rows = m.parseRoomLog(text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, '第一行\n第二行：圓桌')
  assert.equal(rows[0].seq, 1)
  // negative control: a reader that keeps the partial line would report 2 rows
  const withNl = text + '\n'
  assert.equal(m.parseRoomLog(withNl).length, 1, 'the partial object is still not a row once it is a complete line of bad JSON')
  const closed = good + '\n' + JSON.stringify(row({ seq: 2, text: 'seat', from: 'cuda', kind: 'say' })) + '\n'
  assert.equal(m.parseRoomLog(closed).length, 2)
  assert.equal(m.parseRoomLog('').length, 0)
  assert.equal(m.parseRoomLog(good).length, 0, 'no terminating newline: the only line is partial')
})

test('wrap: every line is within the display width and a wide character is never split', () => {
  const width = 4
  const lines = m.wrapToWidth('中文ab', width)
  for (const l of lines) assert.ok(ui.displayWidth(l) <= width, JSON.stringify(l))
  assert.ok(lines.includes('中文') || (lines.includes('中') && lines.includes('文')))
  const joined = lines.join('')
  assert.equal(joined, '中文ab')
  // a width of 3 cannot hold two wide chars on one line and must not cut 文 in half
  const w3 = m.wrapToWidth('中文', 3)
  for (const l of w3) {
    assert.ok(ui.displayWidth(l) <= 3, JSON.stringify(l))
    assert.ok(!l.includes('中') || ui.displayWidth(l) >= 2)
  }
  assert.equal(w3.join(''), '中文')
})

test('display lines indent the text by two cells and name seq, from, kind, and round', () => {
  const rows = m.parseRoomLog(line({ seq: 7, from: 'owner', kind: 'say', text: '你好世界', round: 2 }) + '\n')
  const lines = m.displayLines(rows, 40)
  assert.equal(lines[0].text, '7 owner say round 2')
  assert.ok(lines.slice(1).every(l => l.text.startsWith('  ')))
  for (const l of lines) assert.ok(ui.displayWidth(l.text) <= 40, JSON.stringify(l.text))
  const narrow = m.displayLines(rows, 6)
  for (const l of narrow) assert.ok(ui.displayWidth(l.text) <= 6, JSON.stringify(l.text))
})

test('scroll window and tail-follow: an offset at the bottom stays at the bottom; an offset above it stays put', () => {
  const lines = [0, 1, 2, 3, 4].map(i => ({ text: String(i), role: 'text' }))
  assert.deepEqual(m.visibleLines(lines, 2, 2).map(l => l.text), ['2', '3'])
  assert.deepEqual(m.visibleLines(lines, 99, 2).map(l => l.text), ['3', '4'])
  // was at bottom (offset 3 of 5 in a room of 2: max is 3)
  assert.equal(m.nextOffset(3, 5, 7, 2), 5)
  // scrolled up
  assert.equal(m.nextOffset(1, 5, 7, 2), 1)
})

test('roles: owner is here, system is attention, a send failure is broken, a seat is text', () => {
  assert.equal(m.rowRole(row({ from: 'owner', kind: 'say' })), 'here')
  assert.equal(m.rowRole(row({ from: 'moderator', kind: 'system', text: 'seat added' })), 'attention')
  assert.equal(m.rowRole(row({ from: 'moderator', kind: 'system', text: 'send failed handle=cuda status=1 stderr=nope' })), 'broken')
  assert.equal(m.rowRole(row({ from: 'cuda', kind: 'say', text: 'position' })), 'text')
  assert.equal(ui.PALETTE.here, 'claude')
  assert.equal(ui.PALETTE.attention, 'warning')
  assert.equal(ui.PALETTE.broken, 'error')
  assert.equal(ui.PALETTE.structure, 'subtle')
})
