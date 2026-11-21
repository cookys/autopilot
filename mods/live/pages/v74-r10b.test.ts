// v74-r10b.test.ts — r10b UX review fixes (carbon / astra on the r8-6 tmux shots).
import { test, expect } from 'claude-code/testing'
import { GLYPHS } from '../../tux/glyphs.ts'
import decideFx from '../fixtures/v74/decide.fixture'
import { decidePage, decideReduce, NO_NAV } from './decide'
import { routeKey } from './keys'
import { renderHelp } from './help'
import { makeT } from '../i18n'
import type { DecideCard, V74Ctx } from '../v74/contract'
import type { Row } from './rows'

const t = makeT('zh-TW')
const decide = decideFx as DecideCard[]
const v74 = (o: Partial<V74Ctx> = {}): V74Ctx => ({ pm: null, pmFetchedMs: null, decide, todo: [], nav: { cursor: 0, picks: {}, notes: {}, noteMode: false }, ...o })
const ctxOf = (o: Partial<V74Ctx>, rows = 40, cols = 120) => ({ live: null, console: null, size: { cols, rows }, t, nowMs: 1794200000000, v74: v74(o), box: true }) as never
const text = (r: Row): string => r.map(s => s.text).join('')

test('r10b #1: a picked answer is marked with the answer arrow, never the pending-card diamond', () => {
  const ctx = { ...(ctxOf({}) as object), decide: { ...NO_NAV, cursor: 0, picks: { [decide[0].id]: 0 } } } as never
  const { actions, body } = decidePage.render(ctx)
  const all = [...body, ...actions].map(text).join('\n')
  expect(all).toContain(GLYPHS.structure.answer)
  expect(all).not.toContain(GLYPHS.structure.decisions + ' a')
})

test('r10b #1: the help legend lists the pending diamond, the answer arrow and the proxy-record mark apart', () => {
  const all = renderHelp(ctxOf({}) as never).body.map(text).join('\n')
  expect(all).toContain(GLYPHS.structure.decisions + ' 等你決定')
  expect(all).toContain(GLYPHS.structure.answer + ' 你選的答案')
  expect(all).toContain(GLYPHS.state.done + ' 我替你決定的紀錄')
  expect(all).not.toContain('等你決定 · 你選的答案')
})

// ---- #2 s previews first ----
const picked = { ...NO_NAV, picks: { [decide[0].id]: 1, [decide[1].id]: 0 } }
test('r10b #2: the first s only arms a preview (no send effect, no hold); the second s sends', () => {
  const c = ctxOf({})
  const first = decideReduce(picked, { kind: 'submit' }, c, 5)
  expect(first.effect).toBeNull()
  expect(first.nav.armed).toBe(true)
  expect(first.nav.hold).toBeUndefined()
  const second = decideReduce(first.nav, { kind: 'submit' }, c, 6)
  expect(second.effect?.kind).toBe('send')
  expect(second.nav.armed).toBe(false)
  expect(Object.keys(second.nav.hold ?? {}).sort()).toEqual([decide[0].id, decide[1].id].sort())
})

test('r10b #2: s with nothing picked never arms (negative control)', () => {
  const r = decideReduce(NO_NAV, { kind: 'submit' }, ctxOf({}), 5)
  expect(r.effect).toBeNull()
  expect(r.nav.armed).not.toBe(true)
})

test('r10b #2: Esc cancels the preview (and only then); any other key cancels it and does its own work', () => {
  const c = ctxOf({})
  const armed = decideReduce(picked, { kind: 'submit' }, c, 5).nav
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false, armed: true })).toEqual({ kind: 'disarm' })
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'close' })
  expect(decideReduce(armed, { kind: 'disarm' }, c, 6).nav.armed).toBe(false)
  const moved = decideReduce(armed, { kind: 'move', by: 1 }, c, 6)
  expect(moved.nav.armed).toBe(false)
  expect(moved.nav.cursor).toBe(1)
  // after a cancel the next s starts over: previews again, sends nothing
  expect(decideReduce(moved.nav, { kind: 'submit' }, c, 7).effect).toBeNull()
})

test('r10b #2: the armed send row lists card→letter and how to confirm or cancel; the unarmed row is unchanged', () => {
  const rows = (nav: object) => decidePage.render({ ...(ctxOf({}) as object), decide: nav } as never).actions.map(text).join('\n')
  expect(rows(picked)).toContain('[s] 送出已選 2 張')
  const armed = rows({ ...picked, armed: true })
  expect(armed).toContain('將送出 1→b、2→a')
  expect(armed).toContain('再按 s 確認')
  expect(armed).toContain('Esc 取消')
  expect(armed).not.toContain('[s] 送出已選')
})

test('r10b #2: the send feedback after sending stays', () => {
  const { actions } = decidePage.render(ctxOf({ sendResult: { n: 2, left: 1 } }))
  expect(actions.map(text).join('\n')).toContain('已送出 2 張 · 尚有 1 張待決')
})
