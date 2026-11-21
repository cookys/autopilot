// v74-d.test.ts — S3 待決 (all cards on one page, Buttons only on the selected card) and S9 待辦. ctx.v74 is built from fixtures/v74/*.json here; the pages never read fixtures.
import { test, expect } from 'claude-code/testing'
import decideFx from '../fixtures/v74/decide.fixture'
import todoFx from '../fixtures/v74/todo.fixture'
import { frameRows } from './frame'
import { PAGES } from './index'
import { decidePage, decideReduce, NO_NAV, v74Pool } from './decide'
import { todoPage, dueText } from './todo'
import { makeT } from '../i18n'
import type { DecideCard, TodoCard, V74Ctx } from '../v74/contract'
import type { Row } from './rows'

// r10b #2: s previews first, the second s sends
const sendS = (nav: Parameters<typeof decideReduce>[0], c: Parameters<typeof decideReduce>[2], now: number) => decideReduce(decideReduce(nav, { kind: 'submit' }, c, now).nav, { kind: 'confirm' }, c, now)


const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const todo = todoFx as TodoCard[]
const v74 = (o: Partial<V74Ctx> = {}): V74Ctx => ({ pm: null, pmFetchedMs: null, decide, todo, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ...o })
const ctxOf = (o: Partial<V74Ctx>, rows = 30, cols = 120) => ({ live: null, console: null, size: { cols, rows }, t, nowMs: 1794200000000, v74: v74(o) }) as never
const text = (r: Row): string => r.map(s => s.text).join('')
const pressed = (rows: Row[]): string[] => rows.flatMap(r => r.filter(s => s.press !== undefined && s.press.startsWith('key:')).map(s => s.press as string))

test('v74-d: 待決 draws every card; only the selected card has a/b/c Buttons (negative: others have none)', () => {
  const { body, actions } = decidePage.render(ctxOf({ nav: { cursor: 2, picks: {}, notes: {}, noteMode: false } }))
  const all = body.map(text).join('\n')
  for (const c of decide) expect(all).toContain(c.title)
  expect(all).toContain('▸  3. 預覽先拍幾欄')
  expect(all).not.toContain('▸  1.')
  expect(all).toContain('· 合併 ★') // card 1: plain text with the recommended mark
  expect(all).toContain('a: 80 欄')
  expect(all).toContain('b: 120 欄 ★')
  expect(all).not.toContain('a: 合併')
  expect(pressed(body).filter(p => /key:[abc]/.test(p))).toEqual(['key:a', 'key:b', 'key:c'])
  expect(pressed(body)).toContain('key:m')
  expect(text(actions[0])).toBe('[s] 預覽並送出已選 0 張 · 另 3 張未選')
})

test('v74-d: cursor on card 1 moves the Buttons to card 1 (negative: card 3 plain again)', () => {
  const { body } = decidePage.render(ctxOf({}))
  const all = body.map(text).join('\n')
  expect(all).toContain('a: 合併 ★')
  expect(all).toContain('· 120 欄 ★')
  expect(all).not.toContain('a: 80 欄')
})

test('v74-d: send-all counts answered cards and a note shows inside the selected card', () => {
  const nav = { ...NO_NAV, cursor: 1, picks: { 'd-a1b2c3e1': 0, 'd-a1b2c3e2': 1 }, notes: { 'd-a1b2c3e2': '今晚太趕' } }
  const ctx = { ...ctxOf({}), decide: nav }
  const { body, actions } = decidePage.render(ctx)
  expect(text(actions[0])).toBe('[s] 預覽並送出已選 2 張 · 另 1 張未選')
  expect(body.map(text).join('\n')).toContain('m 附註：今晚太趕')
})

test('v74-d: reducer on v7.4 cards: j/k move, pick + s holds every answered card (negative: s with no answer sends nothing)', () => {
  const ctx = ctxOf({})
  const t0 = 1794200000000
  expect(sendS(NO_NAV, ctx, t0).effect).toBeNull()
  let n = decideReduce(NO_NAV, { kind: 'move', by: 1 }, ctx, t0).nav
  expect(n.cursor).toBe(1)
  expect(decideReduce({ ...n, cursor: 2 }, { kind: 'move', by: 1 }, ctx, t0).nav.cursor).toBe(2) // clamped
  n = decideReduce(n, { kind: 'pick', index: 1 }, ctx, t0).nav
  expect(n.picks['d-a1b2c3e2']).toBe(1)
  const sent = decideReduce({ ...n, cursor: 0 }, { kind: 'pick', index: 0 }, ctx, t0).nav
  const r = sendS(sent, ctx, t0)
  expect(r.effect?.kind).toBe('send')
  expect(Object.keys(r.nav.hold ?? {}).sort()).toEqual(['d-a1b2c3e1', 'd-a1b2c3e2'])
})

test('v74-d: v74Pool adds the list cards to the send pool once (negative: same id not doubled)', () => {
  const own = v74Pool([], decide)
  expect(own.map(d => d.id)).toEqual(decide.map(c => c.id))
  expect(own[0].options[0].label).toBe('合併')
  expect(v74Pool(own, decide).length).toBe(3)
  expect(v74Pool([], null)).toEqual([])
})

test('v74-d: 待決 with a null source shows the broken row, no cards; the legacy draw (no v74) is unchanged', () => {
  const { body, actions } = decidePage.render(ctxOf({ decide: null }))
  expect(body.length).toBe(1)
  expect(text(body[0])).toContain('沒有待決來源')
  expect(actions.map(text).join('')).toContain('待決在 band 上')
  expect(pressed(actions)).toEqual([])
  expect(decidePage.render({ live: null, console: null, size: { cols: 120, rows: 30 }, t, nowMs: 0 } as never).body).toEqual([])
})

test('v74-d: 待辦 shows due dates and Buttons only for the selected card', () => {
  expect(todoPage.id).toBe('todo')
  expect(todoPage.key).toBe('8')
  expect(PAGES.find(p => p.id === 'todo')).toBe(todoPage)
  const { body, actions } = todoPage.render(ctxOf({ nav: { cursor: 1, picks: {}, notes: {}, noteMode: false } }))
  const all = body.map(text).join('\n')
  expect(all).toContain('待辦 1／2 到期 ' + dueText(todo[0].dueMs))
  expect(all).toContain('待辦 2／2 無期限')
  expect(all).toContain('截圖保留天數')
  expect(pressed(body)).toEqual([]) // the cards themselves carry no Button
  expect(actions.map(text).join('\n')).toContain('對第 2 張')
  expect(pressed(actions)).toEqual(['key:a', 'key:b', 'key:c'])
  expect(dueText(null)).toBeNull()
  expect(dueText(todo[0].dueMs)).toMatch(/^\d\d-\d\d$/)
})

test('v74-d: 待辦 with a null source draws the broken row, never fixture data (negative control)', () => {
  const { body, actions } = todoPage.render(ctxOf({ todo: null }))
  expect(body.length).toBe(1)
  expect(text(body[0])).toContain('無來源：fleet todo 尚未接線')
  expect(body.map(text).join('')).not.toContain('金鑰')
  expect(actions).toEqual([])
})

test('v74-d: both pages keep the fixed frame height at 80 / 120 / 209 columns', () => {
  for (const [cols, rows] of [[80, 24], [120, 30], [209, 49]] as const) {
    for (const page of [decidePage, todoPage]) {
      expect(frameRows(page, ctxOf({}, rows, cols), { pages: PAGES }).length).toBe(rows)
    }
  }
})

test('v74-d: a short allocation keeps the selected card on screen', () => {
  const { body } = decidePage.render(ctxOf({ nav: { cursor: 2, picks: {}, notes: {}, noteMode: false } }, 14, 120))
  expect(body.map(text).join('\n')).toContain('a: 80 欄')
})
