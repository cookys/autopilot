// v7.4 r4: band focus, arrow cursor, decision hotkeys, both decision sources, status row outside a project.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { NO_NAV } from './pages/decide'
import { makeT } from './i18n'
import { mergeDecideCards } from './v74/feeds'
import { routeKey } from './pages/keys'
import { v74ArrowFromScroll, v74BareBandSlots } from './register'
import type { DecideCard } from './v74/contract'
import decideFx from './fixtures/v74/decide.fixture'

const t = makeT('zh-TW')
const cards = decideFx as DecideCard[]
type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any, out: Node[] = []): Node[] => {
  if (n === null || n === undefined || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walk(n.props?.children, out)
  return out
}
const flat = (n: Node): string => {
  const c = n.props.children
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : ''
}
const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: null, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { now_ms: 1 } } as never

function framed() {
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  return walk(Pane(EL as never, live, 'decide', () => {}, t, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: shown, pageId: 'decide', console: null, nowMs: 1, rows: 24, v74Box: true,
    v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
    decide: { ...NO_NAV },
  }))
}

test('r4 focus: the v7.4 frame has a visible autoFocus button (ctrl+x Tab can land)', () => {
  const buttons = framed().filter(n => n.kind === 'Button')
  const focus = buttons.filter(b => b.props.autoFocus === true)
  expect(focus.length).toBeGreaterThan(0)
  expect(focus.every(b => flat(b).trim() !== '')).toBe(true)
  expect(buttons.some(b => b.props.width === 0 || b.props.height === 0)).toBe(false)
})

test('r4 arrows: up and down move the decide and todo cursor by one, and other pages keep scrolling', () => {
  expect(v74ArrowFromScroll('decide', 1)).toEqual({ kind: 'move', by: 1 })
  expect(v74ArrowFromScroll('decide', -1)).toEqual({ kind: 'move', by: -1 })
  expect(v74ArrowFromScroll('todo', 3)).toEqual({ kind: 'move', by: 1 })
  expect(v74ArrowFromScroll('now', 1)).toBeNull()
  expect(v74ArrowFromScroll('fleet', -4)).toBeNull()
})

test('r4 hotkeys: a b c m s are letter buttons; Esc is the host key that closes the frame and returns the keyboard', () => {
  const hot = framed().filter(n => n.kind === 'Button' && n.props.hotkey !== undefined).map(n => n.props.hotkey)
  for (const k of ['a', 'b', 'c', 'm', 's']) expect(hot).toContain(k)
  expect(hot.every(k => /^[a-z0-9]$/.test(k))).toBe(true)
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: true, textMode: false })).toEqual({ kind: 'close' })
})

test('r4 sources: fleet list and the card store merge by id, and the list wins', () => {
  const store: DecideCard[] = [{ id: 'from-store', title: '店', question: 'q', background: null, options: [{ label: '甲', detail: '', recommended: false }] }]
  const list: DecideCard[] = [{ id: 'from-list', title: '單', question: 'q', background: null, options: [{ label: '乙', detail: '', recommended: true }] }, { id: 'from-store', title: '單上的', question: 'q2', background: null, options: [{ label: '丙', detail: '', recommended: false }] }]
  const both = mergeDecideCards(list, store)
  expect(both?.map(c => c.id)).toEqual(['from-list', 'from-store'])
  expect(both?.find(c => c.id === 'from-store')?.title).toBe('單上的')
  expect(mergeDecideCards(null, store)?.map(c => c.id)).toEqual(['from-store'])
  expect(mergeDecideCards(null, [])).toBeNull()
  expect(mergeDecideCards([], [])).toEqual([])
})

test('r4 status: outside a project the own-seat segment says no project and the other S2 segments stay', () => {
  const slots = v74BareBandSlots('沒有專案 · 請執行：autopilot status runs --watch', null, 0, t)
  const text = slots.flatMap(s => s.segs.map(g => g.text)).join('')
  expect(slots[0].segs[0].text).toBe('沒有專案')
  expect(text).not.toContain('autopilot status runs --watch')
  expect(text).toContain('艦隊')
  expect(text).toContain('來源')
  expect(text).toContain('待決')
  expect(text).toContain('0')
})
