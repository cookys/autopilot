// mods/live/scroll.test.ts — the scrolling window's arithmetic (design plan §12.10): the thumb, the clamp, every ui.scroll key, the cell wrap. The drawing is tested where it is used:
// the 待決 tab in live.test.ts ("SCROLL decide ...") and the viewer window in viewer.test.ts.
import { test, expect } from 'claude-code/testing'
import { applyScroll, frameOf, newScroll, roomOf, thumbOf, wrapCells } from './scrollmath'

test('thumb: flush with the top at offset 0, in the middle halfway, flush with the bottom at the last offset', () => {
  // 100 rows through a 20-row window: the thumb is 4 cells, 16 cells of travel for 80 rows of offset
  expect(thumbOf(100, 20, 0)).toEqual({ top: 0, len: 4 })
  expect(thumbOf(100, 20, 40)).toEqual({ top: 8, len: 4 })
  expect(thumbOf(100, 20, 80)).toEqual({ top: 16, len: 4 })
})
test('thumb: sticks to the bottom at the end for any length (a rounding that stops one short is the defect this pins)', () => {
  for (const total of [21, 22, 37, 99, 1000]) for (const room of [3, 7, 20]) {
    if (total <= room) continue
    const t = thumbOf(total, room, total - room)
    expect(t !== null && t.top + t.len, `total ${total} room ${room}`).toBe(room)
    expect(thumbOf(total, room, 0)?.top).toBe(0)
  }
})
test('thumb: at least one cell, and none at all when the content fits', () => {
  expect(thumbOf(100000, 10, 0)?.len).toBe(1)
  expect(thumbOf(20, 20, 0)).toBeNull()
  expect(thumbOf(5, 20, 0)).toBeNull()
  expect(thumbOf(10, 0, 0)).toBeNull()
})
test('thumb: an offset outside the range is clamped, not drawn outside the track', () => {
  expect(thumbOf(100, 20, -5)).toEqual({ top: 0, len: 4 })
  expect(thumbOf(100, 20, 999)).toEqual({ top: 16, len: 4 })
})

test('ui.scroll: every key moves the offset as the engine reports it, clamped to [0, max]', () => {
  const m = { key: 'k', offset: 10, max: 50 }
  const total = 70 // contentRows
  expect(applyScroll(m, { by: 1, contentRows: total }) && m.offset).toBe(11) // down arrow
  expect(applyScroll(m, { by: -1, contentRows: total }) && m.offset).toBe(10) // up arrow
  expect(applyScroll(m, { by: 20, contentRows: total }) && m.offset).toBe(30) // PgDn: a window
  expect(applyScroll(m, { by: -20, contentRows: total }) && m.offset).toBe(10) // PgUp
  expect(applyScroll(m, { by: total, contentRows: total }) && m.offset).toBe(50) // End: the whole tree, clamped to max
  expect(applyScroll(m, { by: -total, contentRows: total }) && m.offset).toBe(0) // Home
})
test('ui.scroll: past either end stays at the end and reports no change', () => {
  const m = { key: 'k', offset: 50, max: 50 }
  expect(applyScroll(m, { by: 1, contentRows: 70 })).toBe(false)
  expect(applyScroll(m, { by: 20, contentRows: 70 })).toBe(false)
  expect(m.offset).toBe(50)
  m.offset = 0
  expect(applyScroll(m, { by: -1, contentRows: 70 })).toBe(false)
  expect(m.offset).toBe(0)
})
test('ui.scroll: a window with nothing to scroll never moves', () => {
  const m = newScroll() // max 0
  expect(applyScroll(m, { by: 20, contentRows: 15 })).toBe(false)
  expect(m.offset).toBe(0)
})

test('frame room: the head, one rule and the action strip come off the pane height; never below one row', () => {
  expect(roomOf({ rows: 30, headRows: 3, barRows: 2 })).toBe(24)
  expect(roomOf({ rows: 4, headRows: 3, barRows: 2 })).toBe(1)
})
test('frameOf: needs both the body rows and the body columns, else the plain tree is drawn', () => {
  expect(frameOf({ scroll: { offset: 0, bodyRows: 30 }, bodyColumns: 100 })).toEqual({ rows: 30, cols: 100 })
  expect(frameOf({ bodyColumns: 100 })).toBeNull()
  expect(frameOf({ scroll: { offset: 0, bodyRows: 0 }, bodyColumns: 100 })).toBeNull()
  expect(frameOf(undefined)).toBeNull()
})
test('wrapCells: rows of at most the width in terminal cells (a CJK character is two), a newline starts a row', () => {
  expect(wrapCells('abcdef', 4)).toEqual(['abcd', 'ef'])
  expect(wrapCells('你好嗎', 4)).toEqual(['你好', '嗎'])
  expect(wrapCells('ab\ncd', 10)).toEqual(['ab', 'cd'])
})
