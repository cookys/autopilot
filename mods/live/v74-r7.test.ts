// v7.4 r7: cursor is not reset by focus on the current card, narrow band keeps whole segments, s writes the store without a model turn.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { NO_NAV, decideReduce, cardToLive } from './pages/decide'
import { makeT } from './i18n'
import { BAND_NARROW_STEPS, layoutBandLine, slotFleet, v74FitBand } from './model'
import { v74FocusCursor } from './register'
import { writeV74Answers } from './decideundo'
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
const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: null, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { now_ms: 1 } } as never
const ctx = {
  live, console: null, size: { cols: 80, rows: 24 }, t, nowMs: 1,
  v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
} as never

function draw() {
  const keys: { kind: string; at?: number; by?: number }[] = []
  const tree = Pane(EL as never, live, 'decide', () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES.map(p => ({ ...p, framed: true as const })), pageId: 'decide', console: null, nowMs: 1, rows: 24, v74Box: true,
    onKey: (k: { kind: string; at?: number; by?: number }) => { keys.push(k) },
    v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
    decide: { ...NO_NAV },
  })
  return { nodes: walk(tree), keys }
}

test('r7 down: focus on the current card does not reset the cursor; the next card button moves it', () => {
  const d = draw()
  const keys = d.nodes.filter(n => n.kind === 'Button').map(n => String(n.props.key))
  expect(keys.includes('card:0'), 'the selected head is not a button, so Down is not eaten as cursor-at-0').toBe(false)
  expect(keys.includes('card:1')).toBe(true)
  // Host order from the r6 key log: ui.focus element=card:0, then a cursor event.
  expect(v74FocusCursor(0, 'card:0')).toBeNull()
  const btn = d.nodes.find(n => n.kind === 'Button' && n.props.key === 'card:1')
  btn?.props.onPress()
  expect(d.keys).toEqual([{ kind: 'cursor', at: 1 }])
  let nav = { ...NO_NAV }
  const focus = v74FocusCursor(nav.cursor, 'card:0')
  if (focus !== null) nav = decideReduce(nav, focus, ctx, 1).nav
  nav = decideReduce(nav, d.keys[0], ctx, 1).nav
  expect(nav.cursor).toBe(1)
  nav = decideReduce(nav, { kind: 'move', by: -1 }, ctx, 1).nav
  expect(nav.cursor).toBe(0)
})

const V74_NARROW = BAND_NARROW_STEPS.map(step => step.filter(id => id !== 'speed' && id !== 'fleetWord')).filter(step => step.length > 0)

function bandAt(cols: number): string {
  const fleet = slotFleet({ stuck: 1, running: 2, waiting: 0, failed: 1, normal: 3 }, t)
  const slots = [
    { id: 'verdict' as const, segs: [{ text: '▲ 要你決定' }] },
    fleet,
    { id: 'decide' as const, segs: [{ text: '待決', tag: 'chip' as const }, { text: ' ', tag: 'chip' as const }, { text: '4', tag: 'chip' as const }] },
    { id: 'hygiene' as const, segs: [{ text: '開發 ⚑ 1' }] },
  ]
  const speed = [{ role: 'bolt' as const, text: 'ϟ ' }, { role: 'value' as const, text: '—' }, { role: 'unit' as const, text: ' tok/s' }]
  const room = Math.max(1, cols - 4)
  const fitted = layoutBandLine(slots, room, speed, V74_NARROW, false)
  const kept = fitted.speed ?? speed
  const segs = v74FitBand(fitted.band.segs, kept, false, room)
  return segs.map(s => s.text).join('') + kept.map(s => s.text).join('')
}

test('r7 narrow: 100 and 80 columns keep fleet, 待決 and tok/s, and do not leave an empty segment', () => {
  for (const cols of [100, 80]) {
    const line = bandAt(cols)
    expect(line, 'cols ' + cols).toContain('艦隊')
    expect(line, 'cols ' + cols).toContain('待決')
    expect(line, 'cols ' + cols).toContain('tok/s')
    expect(line.includes('│  │') || line.includes('│ │'), 'cols ' + cols + ' ' + line).toBe(false)
  }
  // The room that r6 actually fitted (tab strip subtracted from row 1) used to print "│  │".
  const fleet = slotFleet({ stuck: 1, running: 2, waiting: 0, failed: 1, normal: 3 }, t)
  const slots = [
    { id: 'verdict' as const, segs: [{ text: '▲ 要你決定' }] },
    fleet,
    { id: 'decide' as const, segs: [{ text: '待決' }, { text: ' ' }, { text: '4' }] },
    { id: 'hygiene' as const, segs: [{ text: '開發 ⚑ 1' }] },
  ]
  const speed = [{ role: 'bolt' as const, text: 'ϟ ' }, { role: 'value' as const, text: '—' }, { role: 'unit' as const, text: ' tok/s' }]
  const fitted = layoutBandLine(slots, 40, speed, V74_NARROW, false)
  const line = v74FitBand(fitted.band.segs, fitted.speed ?? speed, false, 40).map(s => s.text).join('')
  expect(line.includes('│  │') || line.includes('│ │'), line).toBe(false)
  expect(line).toContain('艦隊')
  expect(line).toContain('待決')
})

test('r7 send: s writes the card store even when the model never answers', async () => {
  const nav = decideReduce({ ...NO_NAV, picks: { [cards[0].id]: 0 }, notes: { [cards[0].id]: 'test note' } }, { kind: 'submit' }, ctx, 5).nav
  const runs: string[][] = []
  let posted = false
  const next = await writeV74Answers({
    cards: cards.map(cardToLive),
    state: nav,
    now: 5,
    run: async (args) => { runs.push(args) },
    post: () => { posted = true; return new Promise(() => undefined) },
  })
  expect(runs.some(a => a[0] === 'close' && a.includes(cards[0].id) && a.includes('--option'))).toBe(true)
  expect(next.sent[cards[0].id]).toBe(5)
  expect(decideReduce(next, { kind: 'submit' }, ctx, 6).effect).toBeNull()
  expect(posted).toBe(true)
  await new Promise(r => setTimeout(r, 0))
  expect(next.sent[cards[0].id]).toBe(5)
})
