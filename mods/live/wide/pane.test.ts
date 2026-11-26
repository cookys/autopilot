// console v5 P2: the wide pane (wide/pane.ts) against the design's steps 1-N, 2-N, 7-N and 4-L (fixtures/pane-*.testkit.ts, copied from the design's screen.txt rows 0-41, columns 116-208).
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, fitList, fitReply, wideBand } from './band'
import { PANE_ROWS, PANE_TOP_N, paneUpper, widePane } from './pane'
import type { PaneModel } from './pane'
import { PANE_1_N } from './fixtures/pane-1-N.testkit'
import { PANE_2_N } from './fixtures/pane-2-N.testkit'
import { PANE_4_L } from './fixtures/pane-4-L.testkit'
import { PANE_7_N } from './fixtures/pane-7-N.testkit'

const modelOf = (f: { model: Record<string, unknown> }): PaneModel => ({ tabs: WIDE_TABS, ...f.model } as unknown as PaneModel)
const FIXTURES = [PANE_1_N, PANE_2_N, PANE_7_N, PANE_4_L]
const isOthersTitle = (r: string): boolean => r.includes('其他頁')

for (const f of FIXTURES) {
  test(`P2 wide pane ${f.id}: 42 rows, every row 93 columns, equal to the design`, () => {
    const out = widePane(modelOf(f))
    expect(out.rows.length).toBe(PANE_ROWS)
    for (const r of out.rows) expect(displayWidth(r)).toBe(93)
    expect(out.rows).toEqual(f.rows)
  })

  test(`P2 wide pane ${f.id}: frame, block titles, 其他頁 title and the eight page names are verbatim`, () => {
    const out = widePane(modelOf(f))
    expect(out.rows[0]).toBe(f.rows[0])
    expect(out.rows[41]).toBe(f.rows[41])
    expect(out.rows[0].startsWith('╭─') && out.rows[0].endsWith('╮')).toBe(true)
    expect(out.rows[41].startsWith('╰─ 數字鍵 跳到那一頁 · e 展開來龍去脈 ') && out.rows[41].endsWith('╯')).toBe(true)
    const titles = (rows: string[]): string[] => rows.filter(r => /^│ (艦隊 ·|12 條產線|來龍去脈|清單（續）|.* · 最近 \d+ 筆)/.test(r))
    expect(titles(out.rows)).toEqual(titles(f.rows))
    expect(out.rows.findIndex(isOthersTitle)).toBe(32)
    const names = out.rows.slice(33, 41).map(r => /^│ (\d \S+)/.exec(r)![1])
    expect(names).toEqual(f.rows.slice(33, 41).map(r => /^│ (\d \S+)/.exec(r)![1]))
    expect(names.length).toBe(8)
    expect(names.some(n => n.startsWith(`${(f.model as { page: number }).page} `))).toBe(false)
  })

  test(`P2 wide pane ${f.id}: at least 32 of the 40 inner rows carry text (pane_fill.py rule), the 31st stays blank`, () => {
    const out = widePane(modelOf(f))
    const inner = out.rows.slice(1, 41)
    expect(inner.filter(r => r.slice(1, -1).trim() !== '').length).toBeGreaterThanOrEqual(32)
    expect(out.rows[31].slice(1, -1).trim()).toBe('')
  })

  test(`P2 wide pane ${f.id}: the eight summary rows are the click targets, row 33 on, page numbers ascending`, () => {
    const out = widePane(modelOf(f))
    expect(out.clicks.map(c => c.row)).toEqual([33, 34, 35, 36, 37, 38, 39, 40])
    const pages = out.clicks.map(c => c.page)
    expect(pages.includes((f.model as { page: number }).page)).toBe(false)
    expect([...pages].sort((a, b) => a - b)).toEqual(pages)
  })
}

test('P2 wide pane: the upper half never passes 30 rows, a cuttable block needs 1 row or it is left out', () => {
  const m = modelOf(PANE_1_N)
  expect(paneUpper(m).length).toBeLessThanOrEqual(PANE_TOP_N)
  const tight: PaneModel = { ...m, pin: Array.from({ length: 24 }, (_, i) => `行 ${i}`), lanes: null, events: m.events }
  // 24 pin rows: 30 - 24 - 2 = 4 rows left for history, then nothing is left for the events
  const up = paneUpper(tight).map(r => r.map(s => s[0]).join(''))
  expect(up.some(r => r.startsWith('今天結束的事 · 最近 4 筆'))).toBe(true)
  expect(up.some(r => r.startsWith('本機事件'))).toBe(false)
  const tighter: PaneModel = { ...tight, pin: Array.from({ length: 27 }, (_, i) => `行 ${i}`) }
  expect(paneUpper(tighter).length).toBe(30) // 30 - 27 - 2 = 1 row left: the history is placed with its one row (design 1-L)
  const none: PaneModel = { ...tight, pin: Array.from({ length: 28 }, (_, i) => `行 ${i}`) }
  expect(paneUpper(none).length).toBe(28) // 30 - 28 - 2 = 0 rows: not placed
})

test('P2 wide pane: a CJK line is cut by display width with an ellipsis, the row stays 93 wide', () => {
  const m: PaneModel = { ...modelOf(PANE_1_N), pin: ['很長'.repeat(60), 'x'.repeat(200)] }
  const out = widePane(m)
  for (const r of out.rows) expect(displayWidth(r)).toBe(93)
  expect(out.rows[1].includes('…')).toBe(true)
  expect(out.rows[2].includes('…')).toBe(true)
})

test('P2 wide pane: a missing summary reads 無, a page with no source is left out, not invented', () => {
  const m: PaneModel = { ...modelOf(PANE_1_N), summaries: Array(9).fill(null), lanes: null, hist: null, events: null }
  const out = widePane(m)
  expect(out.rows.slice(33, 41).every(r => r.includes('  無'))).toBe(true)
  expect(out.rows.some(r => r.includes('艦隊 ·'))).toBe(false)
})

test('P2 wide pane: the folded context is one row; the open context is a header plus its rows', () => {
  const m = modelOf(PANE_2_N)
  const up = (x: PaneModel): string[] => paneUpper(x).map(r => r.map(s => s[0]).join(''))
  expect(up(m)[0]).toBe('來龍去脈 2 列 · 收起')
  const open = up({ ...m, ctxOpen: true })
  expect(open.slice(0, 3)).toEqual(['來龍去脈 2 列 · 展開', '來龍去脈第 1 列', '來龍去脈第 2 列'])
})

test('P2 band hand-off: list rows over 12 leave 11, a row says how many are in the pane, and the pane draws them under 清單（續）', () => {
  const many = Array.from({ length: 20 }, (_, i) => `列 ${i}`)
  const fit = fitList(many)
  expect(fit.shown.length).toBe(12)
  expect(fit.shown[11]).toBe('另 9 列在右邊「清單（續）」')
  expect(fit.overflow).toEqual(many.slice(11))
  const m: PaneModel = { ...modelOf(PANE_1_N), more: fit.overflow, pin: [] }
  const up = paneUpper(m).map(r => r.map(s => s[0]).join(''))
  expect(up[0]).toBe('清單（續）')
  expect(up.slice(1, 10)).toEqual(fit.overflow)
  expect(fitList(many.slice(0, 12)).overflow).toEqual([])
})

test('P2 band hand-off: reply steps between the question and the options move to the pane; the band keeps question, a pointer and options', () => {
  const reply = ['問題', ...Array.from({ length: 8 }, (_, i) => `步驟 ${i}`), 'a: 選項一', 'b: 選項二', 'c: 選項三', 'd: 選項四']
  const fit = fitReply(reply, 9)
  expect(fit.shown).toEqual(['問題', '步驟在右邊，不用捲', 'a: 選項一', 'b: 選項二', 'c: 選項三', 'd: 選項四'])
  expect(fit.overflow).toEqual(reply.slice(1, 9))
  expect(fitReply(reply.slice(0, 12), undefined).overflow).toEqual([])
  const tail = fitReply(Array.from({ length: 15 }, (_, i) => `r${i}`), undefined)
  expect(tail.shown.length).toBe(12)
  expect(tail.shown[11]).toBe('步驟在右邊，不用捲')
  expect(tail.overflow).toEqual(['r11', 'r12', 'r13', 'r14'])
})

test('P2 band hand-off: wideBand returns the overflow it cut and still draws 17 rows of 110', () => {
  const list = Array.from({ length: 20 }, (_, i) => `列 ${i}`)
  const band = wideBand({ page: 1, tabs: WIDE_TABS, stepTitle: '', list, reply: ['問題', '步驟 1', '步驟 2', 'a: 選項'], status: '', hints: '', replyKeep: 3 })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(110)
  expect(band.overflow.list.length).toBe(9)
  expect(band.overflow.reply).toEqual([])
})

test('wide pane: every drawn row is 93 display columns', () => {
  const out = widePane(modelOf(PANE_1_N))
  expect(out.rows.map(displayWidth)).toEqual(Array(PANE_ROWS).fill(93))
})
