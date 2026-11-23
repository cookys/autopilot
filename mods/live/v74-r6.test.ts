// v7.4 r6: current-tab SGR, host scroll/focus, pick a, note Input, send, dirty digit, narrow band, key log.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { PAGES } from './pages/index'
import { NO_NAV, decideReduce, cardToLive } from './pages/decide'
import { makeT } from './i18n'
import { decideLine, layoutBandLine, v74FitBand } from './model'
import { v74BareBandSlots, v74HostScroll, v74FocusAt, v74SpeedText } from './register'
import { v74Keylog } from './v74/keylog'
import type { DecideCard } from './v74/contract'
import decideFx from './fixtures/v74/decide.fixture'

// r10b #2: s previews first, the second s sends
const sendS = (nav: Parameters<typeof decideReduce>[0], c: Parameters<typeof decideReduce>[2], now: number) => decideReduce(decideReduce(nav, { kind: 'submit' }, c, now).nav, { kind: 'confirm' }, c, now)


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

function draw(extra: Record<string, unknown> = {}) {
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  const pages: string[] = []
  const keys: { kind: string; ch?: string }[] = []
  const texts: string[] = []
  let prompt = 'dirty prompt'
  const tree = Pane(EL as never, live, 'decide', () => {}, t, 100, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: shown, pageId: 'decide', console: null, nowMs: 1, rows: 24, v74Box: true,
    onPage: (id: string) => { pages.push(id) },
    onKey: (k: { kind: string; ch?: string }) => { keys.push(k) },
    onText: (v: string) => { texts.push(v) },
    v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
    decide: { ...NO_NAV },
    ...extra,
  })
  return { nodes: walk(tree), pages, keys, texts, prompt: () => prompt, setPrompt: (v: string) => { prompt = v } }
}

const ctx = {
  live, console: null, size: { cols: 80, rows: 24 }, t, nowMs: 1,
  v74: { pm: null, pmFetchedMs: null, decide: cards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
} as never

test('r6 tab: the current tab is its own Text with inverse, not one plain border string', () => {
  const texts = draw().nodes.filter(n => n.kind === 'Text' && n.props.inverse === true)
  expect(texts.length).toBeGreaterThan(0)
  expect(texts.some(n => String(n.props.key).startsWith('tl') && flat(n).includes('待決'))).toBe(true)
})

test('r6 arrows: ui.scroll by ±1 (any component but Pane) is the host event that moves the cursor', () => {
  // scrollmath.ts: e.by is the move. The AbovePrompt hook and the unfiltered ui.scroll hook both call v74HostScroll.
  const down = v74HostScroll({ by: 1, component: 'Transcript' }, 'decide', true, false, false)
  const up = v74HostScroll({ by: -1, component: 'AbovePrompt' }, 'decide', true, false, false)
  expect(down).toEqual({ kind: 'move', by: 1 })
  expect(up).toEqual({ kind: 'move', by: -1 })
  expect(v74HostScroll({ by: 1, component: 'Pane' }, 'decide', true, false, false)).toBeNull()
  expect(v74FocusAt({ element: 'card:2' })).toBe(2)
  expect(v74FocusAt({ key: 'card:1' })).toBe(1)
  let nav = decideReduce({ ...NO_NAV }, down!, ctx, 1).nav
  expect(nav.cursor).toBe(1)
  nav = decideReduce(nav, up!, ctx, 1).nav
  expect(nav.cursor).toBe(0)
})

test('r6 pick-a: index 0 on the next card follows the same pick path as b and raises the send count', () => {
  let nav = decideReduce({ ...NO_NAV }, { kind: 'pick', index: 1 }, ctx, 1).nav
  const ready = (n: typeof nav) => cards.filter(c => decideLine(cardToLive(c), n) !== null).length
  expect(ready(nav)).toBe(1)
  nav = decideReduce(nav, { kind: 'move', by: 1 }, ctx, 1).nav
  nav = decideReduce(nav, { kind: 'pick', index: 0 }, ctx, 1).nav
  expect(nav.picks[cards[1].id]).toBe(0)
  expect(ready(nav)).toBe(2)
})

test('r6 note: Input onInput/onSubmit own the keyboard; Enter saves and the prompt is untouched', () => {
  const d = draw({ decide: { ...NO_NAV, textMode: true, textBuf: '' } })
  const input = d.nodes.find(n => n.kind === 'Input' && n.props.key === 'v74-note')
  expect(input?.props.autoFocus).toBe(true)
  input?.props.onInput('test note')
  expect(d.texts).toEqual(['test note'])
  expect(d.prompt()).toBe('dirty prompt')
  input?.props.onSubmit()
  expect(d.keys).toEqual([{ kind: 'text_save' }])
  expect(d.prompt()).toBe('dirty prompt')
})

test('r6 send: s after the picks is decideReduce submit, which holds the cards', () => {
  let nav = decideReduce({ ...NO_NAV }, { kind: 'pick', index: 0 }, ctx, 1).nav
  nav = decideReduce(nav, { kind: 'move', by: 1 }, ctx, 1).nav
  nav = decideReduce(nav, { kind: 'pick', index: 0 }, ctx, 1).nav
  const sent = sendS(nav, ctx, 5)
  expect(sent.effect?.kind).toBe('send')
  expect(sent.nav.hold?.[cards[0].id]).toBe(5)
  expect(cards.filter(c => decideLine(cardToLive(c), sent.nav) !== null && sent.nav.hold?.[c.id] === undefined).length).toBe(0)
})

test('r6 dirty digit: the hotkey Button the host presses still switches to page 3', () => {
  const d = draw()
  const btn = d.nodes.find(n => n.kind === 'Button' && n.props.hotkey === '3')
  expect(btn).toBeDefined()
  btn?.props.onPress()
  expect(d.pages).toEqual(['dispatch'])
  expect(d.prompt()).toBe('dirty prompt')
})

test('r6 narrow: 產線, 待決 and tok/s stay when the row is about 100 columns', () => {
  const slots = v74BareBandSlots('⏶ 要你決定', { stuck: 1, running: 2, waiting: 3 }, 4, t)
  const speed = [{ role: 'bolt' as const, text: 'ϟ ' }, { role: 'value' as const, text: '—' }, { role: 'unit' as const, text: ' tok/s' }]
  const fitted = layoutBandLine(slots, 100, speed, [['pet'], ['fleetWait'], ['fleetRun', 'fleetWord'], ['trend']], false)
  const keptSpeed = fitted.speed ?? speed
  const segs = v74FitBand(fitted.band.segs, keptSpeed, false, 60)
  const line = segs.map(s => s.text).join('') + keptSpeed.map(s => s.text).join('')
  expect(line).toContain('產線')
  expect(line).toContain('待決')
  expect(line).toContain('tok/s')
  expect(v74SpeedText([])).toContain('tok/s')
})

test('r6 keylog: one JSON line when AUTOPILOT_V74_KEYLOG is set, and nothing when it is not', async () => {
  const files: Record<string, string> = {}
  const host = (name: string | undefined) => ({
    env: { get: async (n: string) => n === 'AUTOPILOT_V74_KEYLOG' ? name : undefined },
    fs: { read: async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] }, write: async (p: string, text: string) => { files[p] = text } },
  })
  await v74Keylog(host(undefined), { handler: 'ui.scroll', by: 1, page: 'decide', cursor: 0, noteOpen: false })
  expect(Object.keys(files)).toEqual([])
  await v74Keylog(host('/tmp/v74-keylog'), { handler: 'input', component: 'Input', element: 'v74-note', len: 9, page: 'decide', cursor: 1, focusOwner: 'v74-note', noteOpen: true })
  const row = JSON.parse(files['/tmp/v74-keylog'].trim()) as { handler: string; len: number; t: number }
  expect(row.handler).toBe('input')
  expect(row.len).toBe(9)
  expect(typeof row.t).toBe('number')
  expect(JSON.stringify(row)).not.toContain('test note')
})
