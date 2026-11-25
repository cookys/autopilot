// v7.4 r4: band focus, arrow cursor, decision hotkeys, both decision sources, status row outside a project.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { NO_NAV } from './pages/decide'
import { makeT } from './i18n'
import { mergeDecideCards } from './v74/feeds'
import { routeKey } from './pages/keys'
import { v74ArrowFromScroll, v74BareBandSlots, v74CursorFromFocus, v74SpeedText } from './register'
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
  // 已改為雙欄：v74Box 內框扣 4 欄，外框 120 欄（內框 116 >= 100）才進雙欄左欄 card:N 清單
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  return walk(Pane(EL as never, live, 'decide', () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
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

test('r5 arrows: the host focus event on card:N is what moves the cursor (ui.scroll is not delivered while the frame is shorter than the viewport)', () => {
  expect(v74CursorFromFocus('card:2')).toBe(2)
  expect(v74CursorFromFocus('card:0')).toBe(0)
  expect(v74CursorFromFocus('tab:decide')).toBeNull()
  expect(v74CursorFromFocus(undefined)).toBeNull()
  const buttons = framed().filter(n => n.kind === 'Button')
  const heads = buttons.filter(b => String(b.props.key).startsWith('card:'))
  expect(heads.length).toBeGreaterThan(1)
  const focus = buttons.filter(b => b.props.autoFocus === true)
  // r7: the selected card head is not a Button. autoFocus stays on the current tab so ctrl+x Tab can land,
  // and a focus event for the card the cursor already names does not write that index back.
  expect(focus.map(b => b.props.key)).toEqual(['tab:decide'])
  expect(v74CursorFromFocus('card:0')).toBe(0)
  focus[0].props.onPress()
})

test('r5 pick: a chosen option changes the line, not only its colour', () => {
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  const tree = walk(Pane(EL as never, live, 'decide', () => {}, t, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: shown, pageId: 'decide', console: null, nowMs: 1, rows: 24, v74Box: true,
    v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: { [cards[0].id]: 1 }, notes: {}, noteMode: false } },
    decide: { ...NO_NAV, picks: { [cards[0].id]: 1 } },
  }))
  const line = walk(tree).filter(n => n.kind === 'Text').map(flat).join('\n')
  expect(line).toContain('→')
  expect(line).toMatch(/b: .*→|→ /)
})

test('r5 note: while typing, the note Input is the only autoFocus and a later digit hotkey is gone', () => {
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  const tree = walk(Pane(EL as never, live, 'decide', () => {}, t, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: shown, pageId: 'decide', console: null, nowMs: 1, rows: 24, v74Box: true,
    v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: true } },
    decide: { ...NO_NAV, textMode: true, textBuf: 'test note' },
  }))
  const nodes = walk(tree)
  const input = nodes.find(n => n.kind === 'Input')
  expect(input?.props.autoFocus).toBe(true)
  expect(input?.props.key).toBe('v74-note')
  const focused = nodes.filter(n => n.props?.autoFocus === true)
  expect(focused.filter(n => n.kind === 'Button')).toEqual([])
  const noteInputs = focused.filter(n => n.kind === 'Input' && n.props.key === 'v74-note')
  expect(new Set(noteInputs).size).toBe(1)
  expect(nodes.some(n => n.kind === 'Button' && n.props.hotkey === '4')).toBe(false)
  expect(nodes.map(flat).join('\n')).toContain('test note')
})

test('r5 speed: the bare band still names tok/s when nothing was timed', () => {
  expect(v74SpeedText([])).toContain('tok/s')
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
  // the clash keeps the list card (its question and options), but takes the store card's title (the real one, the list has none)
  const clash = both?.find(c => c.id === 'from-store')
  expect(clash?.title).toBe('店')
  expect(clash?.question).toBe('q2')
  expect(clash?.options.map(o => o.label)).toEqual(['丙'])
  // a store card without a title keeps the list card's title
  const bareStore: DecideCard[] = [{ id: 'from-store', title: '', question: 'q', background: null, options: [{ label: '甲', detail: '', recommended: false }] }]
  expect(mergeDecideCards(list, bareStore)?.find(c => c.id === 'from-store')?.title).toBe('單上的')
  expect(mergeDecideCards(null, store)?.map(c => c.id)).toEqual(['from-store'])
  expect(mergeDecideCards(null, [])).toBeNull()
  expect(mergeDecideCards([], [])).toEqual([])
})

test('r4 status: outside a project the own-seat segment says no project and the other S2 segments stay', () => {
  const slots = v74BareBandSlots('沒有專案 · 請執行：autopilot status runs --watch', null, 0, t)
  const text = slots.flatMap(s => s.segs.map(g => g.text)).join('')
  expect(slots[0].segs[0].text).toBe('沒有專案')
  expect(text).not.toContain('autopilot status runs --watch')
  expect(text).toContain('產線')
  expect(text).toContain('來源')
  expect(text).toContain('待決')
  expect(text).toContain('0')
})
