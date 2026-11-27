import { describe, expect, test } from 'claude-code/testing'
import { askBandRows } from './askband'
import type { AskRow } from './v74/feeds'
import { displayWidth } from './model'

const rowText = (segs: { text: string }[]): string => segs.map(s => s.text).join('')
const rowWidth = (segs: { text: string }[]): number => displayWidth(rowText(segs))

function makeAsk(i: number, overrides: Partial<AskRow> = {}): AskRow {
  return {
    status: '未答',
    count: 1,
    at: '2026-11-24T10:59:00Z',
    ask: `問題${i}`,
    answer: null,
    ...overrides,
  }
}

describe('askBandRows', () => {
  test('(a) empty array returns []', () => {
    expect(askBandRows([], 120, 0)).toEqual([])
  })

  test('(b) 1 unanswered row returns 1 row with "1 未答" and summary', () => {
    const rows = [makeAsk(1, { ask: '需要確認部署嗎？' })]
    const out = askBandRows(rows, 120, 0)
    expect(out.length).toBe(1)
    const text = rowText(out[0])
    expect(text).toContain('1 未答')
    expect(text).toContain('需要確認部署嗎？')
  })

  test('(c) 7 rows, cols=120: 2 rows, 2nd row has exactly 4 items', () => {
    const rows = Array.from({ length: 7 }, (_, i) => makeAsk(i + 1))
    const out = askBandRows(rows, 120, 0)
    expect(out.length).toBe(2)
    const items = rowText(out[1]).split('　')
    expect(items.length).toBe(4)
    expect(rowWidth(out[0])).toBeLessThanOrEqual(120)
    expect(rowWidth(out[1])).toBeLessThanOrEqual(120)
  })

  test('(d) 7 rows, cols=80: 2 rows, 2nd row has at most 3 items, each row width <= 80', () => {
    const rows = Array.from({ length: 7 }, (_, i) => makeAsk(i + 1))
    const out = askBandRows(rows, 80, 0)
    expect(out.length).toBe(2)
    const items = rowText(out[1]).split('　')
    expect(items.length).toBeLessThanOrEqual(3)
    expect(rowWidth(out[0])).toBeLessThanOrEqual(80)
    expect(rowWidth(out[1])).toBeLessThanOrEqual(80)
  })

  test('(e) Chinese summary truncation does not exceed cols=40', () => {
    const longAsk = '中'.repeat(60)
    const rows = [makeAsk(1, { ask: longAsk })]
    const out = askBandRows(rows, 40, 0)
    expect(out.length).toBe(1)
    expect(rowWidth(out[0])).toBeLessThanOrEqual(40)
  })

  test('(f) UTC 2026-11-24T10:59:00Z formats as 11-24 18:59 (Taipei UTC+8)', () => {
    const rows = [makeAsk(1, { at: '2026-11-24T10:59:00Z' })]
    const out = askBandRows(rows, 120, 0)
    expect(rowText(out[0])).toContain('11-24 18:59')
  })
})

test('(g) only rows with status 未答 are counted; answered rows are not', () => {
  const rows = [
    { status: '未答', count: 1, at: '2026-11-24T10:59:00Z', ask: 'a', answer: null },
    { status: '已答', count: 1, at: '2026-11-24T10:00:00Z', ask: 'b', answer: 'ok' },
    { status: '已處置', count: 1, at: '2026-11-24T09:00:00Z', ask: 'c', answer: null },
  ]
  const text = askBandRows(rows, 120, 0)[0].map(s => s.text).join('')
  expect(text).toContain('1 未答')
  expect(text).toContain('18:59 未答 a')
})

test('(h) every item in row 1 and row 2 (wide and narrow) carries its status', () => {
  const rows = [
    makeAsk(1, { status: '未答', ask: 'q1' }),
    makeAsk(2, { status: '已答', ask: 'q2', answer: 'a2' }),
    makeAsk(3, { status: '已處置', ask: 'q3' }),
  ]
  const wide = askBandRows(rows, 120, 0)
  expect(rowText(wide[0])).toContain('未答 q1')
  expect(rowText(wide[1])).toContain('已答')
  expect(rowText(wide[1])).toContain('已處置')
  expect(rowWidth(wide[0])).toBeLessThanOrEqual(120)
  expect(rowWidth(wide[1])).toBeLessThanOrEqual(120)

  const narrow = askBandRows(rows, 80, 0)
  expect(rowText(narrow[0])).toContain('未答 q1')
  expect(rowText(narrow[1])).toContain('已答')
  expect(rowWidth(narrow[0])).toBeLessThanOrEqual(80)
  expect(rowWidth(narrow[1])).toBeLessThanOrEqual(80)
})
