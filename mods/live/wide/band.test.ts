// console v5 P1: the wide band (wide/band.ts) against the design's steps 1-N, 2-N and 7-N (fixtures/, copied from the design's screen.txt rows 25-41, columns 0-109).
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import type { WideModel } from './band'
import { STEP_1_N } from './fixtures/step-1-N.testkit'
import { STEP_2_N } from './fixtures/step-2-N.testkit'
import { STEP_7_N } from './fixtures/step-7-N.testkit'

// cut [from, to) by display columns (a CJK glyph is two)
const cols = (s: string, from: number, to: number): string => {
  let out = ''
  let at = 0
  for (const ch of s) {
    const w = displayWidth(ch)
    if (at >= from && at + w <= to) out += ch
    at += w
  }
  return out
}
// the model the page would hand over, read back from the design rows
const modelOf = (rows: string[]): WideModel => {
  const top = rows[0]
  const page = Number(/^╭─ (\d) /.exec(top)![1])
  const body = rows.slice(1, 13)
  const foot = rows[16]
  return {
    page,
    tabs: WIDE_TABS,
    stepTitle: /┬─ (.*?) ─+\[-\]/.exec(top)![1],
    list: body.map(r => cols(r, 2, 36).trimEnd()),
    reply: body.map(r => cols(r, 38, 108).trimEnd()),
    status: cols(rows[14], 2, 108).trimEnd(),
    hints: /^╰─ (.*?) ─+╯$/.exec(foot)![1],
  }
}

for (const step of [STEP_1_N, STEP_2_N, STEP_7_N]) {
  test(`P1 wide band ${step.id}: the 17 rows equal the design, every row 110 columns wide`, () => {
    const out = wideBand(modelOf(step.rows))
    expect(out.rows.length).toBe(17)
    for (const r of out.rows) expect(displayWidth(r)).toBe(110)
    expect(out.rows).toEqual(step.rows)
  })

  test(`P1 wide band ${step.id}: structure rows (top frame, divider, tabs, bottom) are verbatim, bottom ends with Tab hint`, () => {
    const out = wideBand(modelOf(step.rows))
    expect(out.rows[0]).toBe(step.rows[0])
    expect(out.rows[13]).toBe(step.rows[13])
    expect(out.rows[13].startsWith('├') && out.rows[13].includes('┴') && out.rows[13].endsWith('┤')).toBe(true)
    expect(out.rows[15]).toBe(step.rows[15])
    expect(out.rows[16]).toBe(step.rows[16])
    expect(out.rows[16].includes(WIDE_TAB_HINT + ' ─')).toBe(true)
    expect(out.rows[0].includes('[-]')).toBe(true)
  })

  test(`P1 wide band ${step.id}: the status row never says 卡住`, () => {
    const out = wideBand(modelOf(step.rows))
    expect(out.rows[14].includes('卡住')).toBe(false)
    const dirty = wideBand({ ...modelOf(step.rows), status: '● 進行中 │ 艦隊 卡住 2' })
    expect(dirty.rows[14].includes('卡住')).toBe(false)
    expect(dirty.rows[14].includes('⋯')).toBe(true)
  })
}

test('P1 wide band: the current page tab is the warning role, the rest plain', () => {
  const out = wideBand(modelOf(STEP_2_N.rows))
  const tabs = out.segs[15]
  expect(tabs.filter(s => s.role === 'current').map(s => s.text)).toEqual(['2 待決'])
})

test('P1 wide band: more than 12 rows hand the rest to the pane (a pointer row says how many); a long line is cut to its column', () => {
  const many = Array.from({ length: 20 }, (_, i) => `列 ${i}`)
  const out = wideBand({ ...modelOf(STEP_1_N.rows), list: many, reply: ['很長'.repeat(60)] })
  expect(out.rows.length).toBe(17)
  for (const r of out.rows) expect(displayWidth(r)).toBe(110)
  expect(cols(out.rows[12], 2, 36).trim()).toBe('另 9 列在右邊「清單（續）」')
  expect(cols(out.rows[11], 2, 36).trim()).toBe('列 10')
  expect(out.overflow.list).toEqual(many.slice(11))
  expect(cols(out.rows[1], 38, 108).trimEnd().endsWith('…')).toBe(true)
})

test('P1 wide band: hints missing the Tab hint get it appended; an overlong hint line keeps the ending', () => {
  const m = modelOf(STEP_1_N.rows)
  expect(wideBand({ ...m, hints: 'j/k 換段' }).rows[16].includes('j/k 換段 · Tab 換頁 ─')).toBe(true)
  const long = wideBand({ ...m, hints: '鍵'.repeat(100) })
  expect(displayWidth(long.rows[16])).toBe(110)
  expect(long.rows[16].includes('Tab 換頁 ─')).toBe(true)
})

test('P1 wide band: the status text from numbers matches the design line (the running dot is the glyph table circle), no 卡住', () => {
  const text = wideStatusText({ verdict: '進行中', running: 8, failed: 2, stalled: 2, pending: 3, act: 1, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
  expect(text).toBe('◉ 進行中 │ 艦隊 ◉ 8 ✗ 2 ⋯ 2 │ 待決 3 · 動手 1 │ ϟ 41 tok/s ▆▆▄▃▆')
  expect(text.includes('卡住')).toBe(false)
})

test('wide band: every drawn row is 110 display columns', () => {
  const out = wideBand(modelOf(STEP_1_N.rows))
  expect(out.rows.map(displayWidth)).toEqual(Array(17).fill(110))
})
