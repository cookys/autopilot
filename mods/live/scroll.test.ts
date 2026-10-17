// mods/live/scroll.test.ts — the scrolling window's arithmetic (design plan §12.10): the thumb, the clamp, every ui.scroll key, the cell wrap. The drawing is tested where it is used:
// the 待決 tab in live.test.ts ("SCROLL decide ...") and the viewer window in viewer.test.ts.
import { test, expect } from 'claude-code/testing'
import { applyScroll, frameOf, jumpOffset, keyedGrow, newScroll, roomOf, scrollHook, takesScroll, thumbOf, wrapCells } from './scrollmath'

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
  const m = { key: 'k', offset: 10, max: 50, room: 0, framed: true }
  const total = 70 // contentRows
  expect(applyScroll(m, { by: 1, contentRows: total }) && m.offset).toBe(11) // down arrow
  expect(applyScroll(m, { by: -1, contentRows: total }) && m.offset).toBe(10) // up arrow
  expect(applyScroll(m, { by: 20, contentRows: total }) && m.offset).toBe(30) // PgDn: a window
  expect(applyScroll(m, { by: -20, contentRows: total }) && m.offset).toBe(10) // PgUp
  expect(applyScroll(m, { by: total, contentRows: total }) && m.offset).toBe(50) // End: the whole tree, clamped to max
  expect(applyScroll(m, { by: -total, contentRows: total }) && m.offset).toBe(0) // Home
})
test('ui.scroll: past either end stays at the end and reports no change', () => {
  const m = { key: 'k', offset: 50, max: 50, room: 0, framed: true }
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

// ---- review round 6 ----
test('takesScroll: only while the last draw was a frame; a plain tree hands ui.scroll to the engine', () => {
  const m = newScroll()
  expect(takesScroll(m, { bodyRows: 30 }), 'nothing drawn yet: the engine scrolls').toBe(false)
  m.framed = true
  expect(takesScroll(m, { bodyRows: 30 })).toBe(true)
  expect(takesScroll(m, { bodyRows: 0 }), 'no room reported').toBe(false)
  // `offset` is the engine's TARGET (window row now + by, clamped), not where the window stands
  expect(takesScroll(m, { bodyRows: 30, by: 1, offset: 1 }), 'down from 0: target 1, window was at 0 -> the mod moves').toBe(true)
  expect(takesScroll(m, { bodyRows: 30, by: -1, offset: 0 }), 'up, clamped at 0: the mod takes it').toBe(true)
  expect(takesScroll(m, { bodyRows: 30, by: 1, offset: 5 }), 'target 5 by 1: the engine window stood at 4, off 0: the engine brings it home').toBe(false)
  expect(takesScroll(m, { bodyRows: 30, by: -1, offset: 3 }), 'up to 3: the window stood at 4: the engine').toBe(false)
  m.framed = false // the next draw was a plain tree (no Button, no bodyColumns, no band, another tab)
  expect(takesScroll(m, { bodyRows: 30 })).toBe(false)
})
test('paging: a page move is capped to the rows on screen, so consecutive pages leave no row out', () => {
  const m = { key: 'k', offset: 0, max: 400, room: 24, framed: true }
  const seen = new Set<number>()
  let at = 0
  for (let i = 0; i < 6; i++) {
    for (let r = m.offset; r < m.offset + m.room; r++) seen.add(r)
    applyScroll(m, { by: 30, contentRows: 31 }) // the engine's PgDn: bodyRows = 30 > room
    at = m.offset
  }
  expect(at).toBe(144)
  for (let r = 0; r < 144; r++) expect(seen.has(r), 'row ' + r + ' was shown').toBe(true)
  applyScroll(m, { by: -30, contentRows: 31 })
  expect(m.offset, 'PgUp is capped the same way').toBe(120)
})
test('keyedGrow: new ids appended keep the place; a removed id starts at the top', () => {
  const m = { key: '', offset: 0, max: 0, room: 0, framed: true }
  keyedGrow(m, ['a', 'b', 'c'])
  m.offset = 7
  keyedGrow(m, ['a', 'b', 'c', 'd'])
  expect(m.offset).toBe(7)
  keyedGrow(m, ['a', 'c', 'd'])
  expect(m.offset).toBe(0)
})

test('scrollHook: a window that drew a plain tree hands the event to next() and moves nothing; a framed one takes it and asks for a redraw', () => {
  const ev = { by: 1, contentRows: 31, bodyRows: 30, offset: 1 } // the engine's target from a window at 0
  for (const [framed, label] of [[false, 'plain tree'], [true, 'frame']] as const) {
    const m = { key: 'k', offset: 0, max: 50, room: 24, framed }
    const calls: string[] = []
    const out = scrollHook(m, ev, () => { calls.push('next'); return 'engine' }, () => calls.push('redraw'))
    if (framed) {
      expect(calls, label).toEqual(['redraw'])
      expect(out).toEqual({})
      expect(m.offset).toBe(1)
    } else {
      expect(calls, label).toEqual(['next'])
      expect(out).toBe('engine')
      expect(m.offset, 'the mod did not move its own offset').toBe(0)
    }
  }
})

test('scrollHook: the wheel down from 0 is taken by the mod and moves it; the wheel up moves it back (bug: offset was read as the window row, so a move down was handed to the engine)', () => {
  const m = { key: 'k', offset: 0, max: 50, room: 24, framed: true }
  const next = () => { throw new Error('the engine must not get a framed event') }
  for (let i = 1; i <= 3; i++) {
    expect(scrollHook(m, { by: 1, contentRows: 31, bodyRows: 30, offset: 1 }, next, () => {})).toEqual({})
    expect(m.offset).toBe(i)
  }
  for (let i = 2; i >= 0; i--) {
    expect(scrollHook(m, { by: -1, contentRows: 31, bodyRows: 30, offset: 0 }, next, () => {})).toEqual({})
    expect(m.offset).toBe(i)
  }
})

test('jumpOffset: the top cell is offset 0, the bottom cell is max, the middle cell the middle', () => {
  expect(jumpOffset(0, 21, 80)).toBe(0)
  expect(jumpOffset(20, 21, 80)).toBe(80)
  expect(jumpOffset(10, 21, 80)).toBe(40)
  expect(jumpOffset(1, 21, 80)).toBe(4)
  expect(jumpOffset(5, 10, 9)).toBe(5) // round(5 / 9 * 9)
})
test('jumpOffset: nothing to scroll (max 0) is always 0; a one-cell track reads as the top; a cell outside the track is clamped', () => {
  expect(jumpOffset(3, 10, 0)).toBe(0)
  expect(jumpOffset(9, 10, 0)).toBe(0)
  expect(jumpOffset(0, 1, 50)).toBe(0)
  expect(jumpOffset(0, 0, 50)).toBe(0)
  expect(jumpOffset(-4, 10, 50)).toBe(0)
  expect(jumpOffset(99, 10, 50)).toBe(50)
})
