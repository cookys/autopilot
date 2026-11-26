// console v5 P1: the wide-band switch (hysteresis) and the Tab page cycle.
import { test, expect } from 'claude-code/testing'
import { wideNext, BAND_ROWS, BAND_COLS, BAND_LIST_COLS, BAND_REPLY_COLS } from './geometry'
import { routeKey } from '../pages/keys'
import { V74_PAGES } from '../v74/contract'

test('P1 wide switch: 199 columns or 16 rows stay on the v7.4 frame; 200 x 17 is wide', () => {
  expect(wideNext(false, 199, 17)).toBe(false)
  expect(wideNext(false, 209, 16)).toBe(false)
  expect(wideNext(false, 200, 17)).toBe(true)
  expect(wideNext(false, 209, 17)).toBe(true)
})

test('P1 wide switch: hysteresis, 197 stays wide, 196 leaves; too few rows always leaves', () => {
  expect(wideNext(true, 197, 17)).toBe(true)
  expect(wideNext(true, 196, 17)).toBe(false)
  expect(wideNext(true, 209, 16)).toBe(false)
  expect(wideNext(false, 197, 17)).toBe(false)
})

test('P1 geometry constants match the design', () => {
  expect([BAND_ROWS, BAND_LIST_COLS, BAND_REPLY_COLS, BAND_COLS]).toEqual([17, 38, 73, 115])
})

const st = (page: string, wide: boolean) => ({ page, paneFocus: true, focusedButton: false, textMode: false, wide })

test('P1 keys: in the wide band Tab cycles the pages 1 -> 9 -> 1', () => {
  let page = 'now'
  const seen: string[] = []
  for (let i = 0; i < 10; i++) {
    const act = routeKey('Tab', st(page, true))
    expect(act.kind).toBe('page')
    page = (act as { to: string }).to
    seen.push(page)
  }
  expect(seen.slice(0, 9)).toEqual([...V74_PAGES.slice(1), 'now'])
  expect(seen[9]).toBe('decide')
  expect((routeKey('Tab', st('help', true)) as { to: string }).to).toBe('now')
})

test('P1 keys: outside the wide band Tab changes nothing', () => {
  expect(routeKey('Tab', st('now', false)).kind).toBe('none')
  expect(routeKey('Tab', { page: 'now', paneFocus: true, focusedButton: false, textMode: false }).kind).toBe('none')
})
