// v74-r8.test.ts — r8 fixes for the astra r7-3 Majors: narrow hint (1), keyboard words (2), send result (3), 待決 summary rows (8), hanging indent (11).
import { test, expect } from 'claude-code/testing'
import decideFx from '../fixtures/v74/decide.fixture'
import { decidePage, NO_NAV } from './decide'
import { frameHintShort, frameHintText } from './frame'
import { PAGES } from './index'
import { makeT } from '../i18n'
import { displayWidth } from '../model'
import type { DecideCard, V74Ctx } from '../v74/contract'
import type { Row } from './rows'

const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const v74 = (o: Partial<V74Ctx> = {}): V74Ctx => ({ pm: null, pmFetchedMs: null, decide, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ...o })
const ctxOf = (o: Partial<V74Ctx>, rows = 40, cols = 120) => ({ live: null, console: null, size: { cols, rows }, t, nowMs: 1794200000000, v74: v74(o), box: true }) as never
const text = (r: Row): string => r.map(s => s.text).join('')

test('r8 #1: the short hint keeps move, pick, send and Esc (not just the arrows)', () => {
  const decidePg = PAGES.find(p => p.id === 'decide')!
  const short = frameHintShort(decidePg, ctxOf({}))
  expect(short).toContain('a/b/c')
  expect(short).toContain('s')
  expect(short).toContain('Esc')
  expect(short).not.toContain('拿鍵盤')
})

test('r8 #2: the border says in words whether the pane holds the keyboard', () => {
  const pg = PAGES.find(p => p.id === 'decide')!
  expect(frameHintText(pg, ctxOf({}))).toContain('拿鍵盤')
  const held = frameHintText(pg, ctxOf({ keysHeld: true }))
  expect(held).toContain('鍵盤在 pane')
  expect(held).not.toContain('拿鍵盤')
})

test('r8 #3: after s the page says how many cards went out', () => {
  const { actions } = decidePage.render(ctxOf({ sendResult: { n: 2, left: 1 } }))
  expect(actions.map(text).join('\n')).toContain('已送出 2 張')
})

test('r8 #8: other cards are one summary row each; the card at the cursor is open in full', () => {
  // 已改為雙欄：左欄每卡一列（游標列 ‣），右欄展開游標卡詳情
  const { body } = decidePage.render(ctxOf({ nav: { cursor: 1, picks: {}, notes: {}, noteMode: false } }))
  const content = body.slice(2).map(text)
  const left = content.map(l => l.slice(0, l.indexOf(' │ ')))
  const right = content.map(l => l.slice(l.indexOf(' │ ') + 3))
  expect(left.some(l => l.startsWith('‣ 02 ' + decide[1].title))).toBe(true)
  expect(left.some(l => l.startsWith('  01 ' + decide[0].title))).toBe(true)
  expect(left.some(l => l.startsWith('  03 ' + decide[2].title))).toBe(true)
  expect(right.join('\n')).toContain(decide[1].question)
  // card 02 has no background: its row is omitted (operator ruling 01M8879S), not a 沒有補充 placeholder
  expect(right.filter(l => l.startsWith('    背景')).length).toBe(0)
  expect(right.join('\n')).not.toContain('沒有補充')
  const withBg = decidePage.render(ctxOf({ nav: { cursor: 2, picks: {}, notes: {}, noteMode: false } })).body.map(text)
  expect(withBg.filter(l => l.includes('背景')).length).toBe(1)
  expect(right.filter(l => /^ {2}[abc]: /.test(l)).length).toBeGreaterThan(0)
})

test('r8 #8: a picked answer shows in the card summary', () => {
  // 已改為雙欄：左欄非游標卡顯示已選標記 →a，未選卡顯示 ○
  const ctx = { ...(ctxOf({}) as object), decide: { ...NO_NAV, cursor: 1, picks: { [decide[0].id]: 0 } } } as never
  const left = decidePage.render(ctx).body.slice(2).map(r => { const s = text(r); return s.slice(0, s.indexOf(' │ ')) })
  const row1 = left.find(l => l.startsWith('  01 '))
  const row3 = left.find(l => l.startsWith('  03 '))
  expect(row1).toContain('→a')
  expect(row3).not.toContain('→')
})

test('r8 #11: the background wraps on a hanging indent under its own text', () => {
  // 已改為雙欄：右欄詳情區的背景仍維持懸掛縮排
  const long = [{ ...decide[0], background: '很長的背景說明'.repeat(30) }, ...decide.slice(1)]
  const { body } = decidePage.render(ctxOf({ decide: long }, 60, 100))
  const right = body.slice(2).map(r => { const s = text(r); const at = s.indexOf(' │ '); return at >= 0 ? s.slice(at + 3) : s })
  const i = right.findIndex(l => l.startsWith('    背景'))
  expect(i).toBeGreaterThanOrEqual(0)
  const hang = displayWidth('    背景   ')
  const next = right[i + 1]
  expect(next.startsWith(' '.repeat(Math.min(hang, 7)))).toBe(true)
  expect(next.length - next.trimStart().length).toBeGreaterThanOrEqual(7)
})

// ---- band (r8 #12) ----
import { slotFleet } from '../model'
import { v74BareBandSlots } from '../register'
const segText = (s: { segs: { text: string }[] } | null): string => (s === null ? '' : s.segs.map(x => x.text).join(''))

test('r8 #12: the v7.4 fleet chips read stalled, running, failed (design S1), the older order stays for the legacy band', () => {
  const c = { stuck: 4, running: 3, waiting: 0, failed: 2 }
  const v = segText(slotFleet(c, t, true))
  expect(v.indexOf('⊘')).toBeLessThan(v.indexOf('◉'))
  expect(v.indexOf('◉')).toBeLessThan(v.indexOf('✗'))
  const old = segText(slotFleet(c, t))
  expect(old.indexOf('✗')).toBeLessThan(old.indexOf('⊘'))
})

test('r8 #12: the bare v7.4 band orders 艦隊, 來源 (with its label), 待決', () => {
  const row = v74BareBandSlots('x', { stuck: 1, running: 1, waiting: 0 }, 3, t).map(segText).join('|')
  expect(row.indexOf('艦隊')).toBeLessThan(row.indexOf('來源'))
  expect(row.indexOf('來源')).toBeLessThan(row.indexOf('待決'))
})

// ---- help, todo, empty card pages (r8 #5, #9, #10) ----
import { helpPage } from './help'
import { todoPage } from './todo'
const helpLines = (cols = 120): string[] => helpPage.render({ live: null, console: null, size: { cols, rows: 40 }, t, nowMs: 0 } as never).body.map(text)

test('r8 #9: help keys follow S10 — the send key has its own row, and the digit condition is a labelled row after the blank line', () => {
  const l = helpLines()
  const k = l.findIndex(x => x.includes('a b c 選那張的選項'))
  expect(l[k]).toContain('p n 備用換張')
  expect(l[k]).not.toContain('送出已選')
  expect(l[k + 1]).toContain('s 送出已選的卡（待決頁和待辦頁）')
  expect(l[k + 2].trim()).toBe('')
  expect(l[k + 3]).toMatch(/^ {2}為什麼 +hotkey/)
  expect(l[k + 4]).toMatch(/^ {2}數字與字母 +數字鍵/)
  expect(l.slice(0, k + 2).some(x => x.includes('輸入框空著'))).toBe(false)
})

test('r8 #9: a wrapped labelled help row hangs under its own text', () => {
  const l = helpLines(60)
  const i = l.findIndex(x => x.startsWith('  為什麼'))
  expect(l[i + 1].startsWith(' '.repeat(14))).toBe(true)
})

test('r8 #5: the legend names ⋯ and says what ⬥ ▸ ⏶ mean on the decide page and in the band', () => {
  const all = helpLines().join('\n')
  expect(all).toContain('⋯ 等待中')
  expect(all).toContain('⬥ 等你決定')
  expect(all).toContain('→ 你選的答案')
  expect(all).toContain('✓ 我替你決定的紀錄')
  expect(all).toContain('▸ 已摺疊')
  expect(all).toContain('⏶ 要你處理')
})

test('r8 #10: an empty 待辦 says how to recover, and its border hint offers no a/b/c', () => {
  const nul = todoPage.render(ctxOf({ todo: null })).body.map(text).join('\n')
  expect(nul).toContain('無來源：fleet todo 尚未接線')
  expect(nul).toContain('按 2 回待決頁')
  const none = todoPage.render(ctxOf({ todo: [] })).body.map(text).join('\n')
  expect(none).toContain('目前沒有待辦卡')
  expect(none).toContain('延後的卡')
  expect(frameHintText(todoPage, ctxOf({ todo: null }))).not.toContain('a/b/c')
  expect(frameHintShort(todoPage, ctxOf({ todo: [] }))).not.toContain('a/b/c')
  expect(frameHintShort(todoPage, ctxOf({ todo: [{ ...decide[0], due: null } as never] }))).toContain('a/b/c')
})

// ---- r8-1 gate fixes: the open card is the cursor's, and the shrink order keeps the blank row between options ----
const four: DecideCard[] = [0, 1, 2, 3].map(n => ({ ...decide[n % decide.length], id: 'd-r8-' + n, title: 'T' + (n + 1), question: 'Q' + (n + 1) + '？' }))
const nav4 = (cursor: number) => ({ cursor, picks: {}, notes: {}, noteMode: false })

test('r8-1: the open card follows the cursor, ‣ and the head count with it, the others stay one row in order', () => {
  // 已改為雙欄：表頭顯示 卡 #0N / 4，左欄維持 1234 順序與單一 ‣ 游標列，右欄只展開該卡詳情
  for (const at of [0, 1, 2, 3]) {
    const lines = decidePage.render(ctxOf({ decide: four, nav: nav4(at) }, 40)).body.map(text)
    expect(lines[0]).toContain('卡 #0' + (at + 1) + ' / 4')
    const content = lines.slice(2)
    const left = content.map(l => l.slice(0, l.indexOf(' │ ')))
    const right = content.map(l => l.slice(l.indexOf(' │ ') + 3))
    expect(left.filter(l => l.startsWith('‣'))).toEqual([expect.stringContaining('‣ 0' + (at + 1) + ' T' + (at + 1))])
    const order = left.map(l => /^(?:‣ |  )0(\d) T/.exec(l)?.[1]).filter(x => x !== undefined)
    expect(order.join('')).toBe('1234')
    expect(right.join('\n')).toContain('T' + (at + 1) + '：Q' + (at + 1) + '？')
    // only card 03 (index 2) carries a background in the fixture; the others draw no 背景 row
    expect(right.filter(l => l.startsWith('    背景')).length).toBe(at === 2 ? 1 : 0)
  }
})

test('r8-1: through the frame ctx (ctx.decide carries the cursor) the open card is that card', () => {
  // 已改為雙欄：ctx.decide.cursor=3 時左欄游標在 ‣ 04 T4 且右欄顯示卡 #04 與 T4 詳情
  const ctx = { ...(ctxOf({ decide: four }, 40) as object), decide: { ...NO_NAV, cursor: 3 } } as never
  const lines = decidePage.render(ctx).body.map(text)
  expect(lines[0]).toContain('卡 #04 / 4')
  expect(lines.some(l => l.startsWith('‣ 04 T4'))).toBe(true)
  expect(lines.join('\n')).toContain('T4：Q4？')
})

test('r8-1: in a short frame the other cards collapse before the blank row between options or any description goes', () => {
  // 已改為雙欄：17 列短框下左欄保留 4 張卡清單不需摺疊，右欄選項間空列與說明皆保留且總列數不超框
  const withDetail = four.map(c => ({ ...c, options: c.options.map(o => ({ ...o, detail: o.detail === '' ? '說明' : o.detail })) }))
  const lines = decidePage.render(ctxOf({ decide: withDetail, nav: nav4(0) }, 17)).body.map(text)
  const content = lines.slice(2)
  const left = content.map(l => l.slice(0, l.indexOf(' │ ')))
  const right = content.map(l => l.slice(l.indexOf(' │ ') + 3))
  const a = right.findIndex(l => /^ {2}a: /.test(l))
  const b = right.findIndex(l => /^ {2}b: /.test(l))
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(a + 1)
  expect(right.slice(a + 1, b).some(l => l.trim() === '')).toBe(true) // the blank row between [a] and [b]
  expect(right.slice(a, b).some(l => l.includes('說明'))).toBe(true) // the description is still there
  expect(left.some(l => l.startsWith('‣ 01 T1'))).toBe(true)
  expect(left.some(l => l.startsWith('  04 T4'))).toBe(true)
  expect(lines.length).toBeLessThanOrEqual(17 - 1 - 2 - 1)
})

// ---- r8-3 ----
import { frameBottomFit, TAB_GAP } from './frame'
import { mergedPoolRows } from './now'
import { NOW, consoleOf } from './quota.fixture'

const tabsOf = [['1', 'now', '1 現況'], ['2', 'decide', '2 待決'], ['3', 'work', '3 派工']].map(([key, id, tx]) => ({ key, id, text: tx }))

test('r8-3 #4: at a narrow width only the current tab keeps its name', () => {
  const fit = frameBottomFit(30, '↑↓ 換張 · a/b/c 選 · s 送出全部 · Esc 還給輸入框', '↑↓ · s · Esc', tabsOf, 'decide')
  expect(fit.tabs.map(x => x.text)).toEqual(['1', '2 待決', '3'])
})

test('r10 #1: tabs shrink to digits before the hint is dropped', () => {
  const hint = '↑↓ 換張 · a/b/c 選 · s 送出全部 · Esc 還給輸入框'
  const fit = frameBottomFit(40, hint, '↑↓ · s · Esc', tabsOf, 'decide')
  expect(fit.hint).toBe('↑↓ · s · Esc')
  expect(fit.tabs.map(x => x.text)).toEqual(['1', '2 待決', '3'])
  const mid = frameBottomFit(48, hint, '↑↓ · s · Esc', tabsOf, 'decide') // the full hint does not fit with names: the short hint stays, the other tabs are digits
  expect(mid.hint).toBe('↑↓ · s · Esc')
  expect(mid.tabs.map(x => x.text)).toEqual(['1', '2 待決', '3'])
  expect(frameBottomFit(8, hint, '↑↓ · s · Esc', tabsOf, 'decide').hint).toBe('')
})

test('r8-3 #4: tabs are two blanks apart on the border (design)', () => {
  expect(TAB_GAP).toBe(2)
  const fit = frameBottomFit(200, 'h', 'h', tabsOf, 'decide')
  expect(fit.tabs.map(x => x.text)).toEqual(['1 現況', '2 待決', '3 派工'])
})

test('r8-3 #2: the first screen of help states when the digits switch pages', () => {
  const first = helpLines().slice(0, 14).join('\n')
  expect(first).toContain('輸入框空白時')
  expect(first).toContain('ctrl+x')
})

test('r8-3 #5: pools with the same error share one row naming all of them', () => {
  const mk = (pool: string) => ({ pool, limit_hit: true, stranded_seats: null, seven_day_pct: 100, five_hour_pct: 100, stale: false, observed_at_ms: NOW - 40_000 })
  const fx = consoleOf(['alpha', 'beta', 'gamma'].map(mk))
  const ctx = { live: null, console: fx, size: { cols: 120, rows: 40 }, t, nowMs: NOW } as never
  const rows = mergedPoolRows(ctx, fx, true).map(text)
  expect(rows.length).toBe(1)
  for (const n of ['alpha', 'beta', 'gamma']) expect(rows[0]).toContain(n)
})
