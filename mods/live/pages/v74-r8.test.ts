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
  const { body } = decidePage.render(ctxOf({ nav: { cursor: 1, picks: {}, notes: {}, noteMode: false } }))
  const lines = body.map(text)
  const all = lines.join('\n')
  expect(all).toContain('▸  2. ')
  expect(all).toContain('   1. ')
  expect(all).toContain('   3. ')
  expect(lines.filter(l => l.startsWith('    背景')).length).toBe(1)
  expect(lines.filter(l => /^ {4}[abc]: /.test(l)).length).toBeGreaterThan(0)
})

test('r8 #8: a picked answer shows in the card summary', () => {
  const ctx = { ...(ctxOf({}) as object), decide: { ...NO_NAV, cursor: 1, picks: { [decide[0].id]: 0 } } } as never
  const all = decidePage.render(ctx).body.map(text).join('\n')
  expect(all).toContain('已選 a')
})

test('r8 #11: the background wraps on a hanging indent under its own text', () => {
  const long = [{ ...decide[0], background: '很長的背景說明'.repeat(30) }, ...decide.slice(1)]
  const { body } = decidePage.render(ctxOf({ decide: long }, 60, 100))
  const lines = body.map(text)
  const i = lines.findIndex(l => l.startsWith('    背景'))
  expect(i).toBeGreaterThanOrEqual(0)
  const hang = displayWidth('    背景   ')
  const next = lines[i + 1]
  expect(next.startsWith(' '.repeat(Math.min(hang, 7)))).toBe(true)
  expect(next.length - next.trimStart().length).toBeGreaterThanOrEqual(7)
})
