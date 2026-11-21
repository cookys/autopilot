// v74-r10b.test.ts — r10b UX review fixes (carbon / astra on the r8-6 tmux shots).
import { test, expect } from 'claude-code/testing'
import { GLYPHS } from '../../tux/glyphs.ts'
import decideFx from '../fixtures/v74/decide.fixture'
import { decidePage, NO_NAV } from './decide'
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
