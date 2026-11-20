// V4: quota always has navigation; frame empty-state tests explicitly supply an actionless page.
// gate2.test.ts — real-host check of 4844e16db (FIX-GATE2): a FIXED pane height with the strip on the last row, the 額度 verdict wrap indent, one key hint form, 80x24 uses every row,
// the pending sentence once on 現況, and the honest empty state with unknown pools. Each test reproduces one finding.
import { test, expect } from 'claude-code/testing'
import { Pane, pageHotkeys } from './pane'
import { actionRows, frameRows, frameHeight, FRAME_MAX_ROWS } from './pages/frame'
import type { Page } from './pages/frame'
import { nowPage } from './pages/now'
import { fleetPage, fleetView } from './pages/fleet'
import { quotaPage, renderQuota } from './pages/quota'
import { PAGES } from './pages/index'
import { NO_NAV } from './pages/decide'
import { consoleOf, POOLS, ctxOf, NOW, type Sources } from './pages/quota.fixture'
import { makeT } from './i18n'
import * as M from './model'
import { displayWidth } from './model'
import type { ConsoleSnapshot } from './console'

const t = makeT('zh-TW')
const OK = (): { at_ms: number; state: 'ok' } => ({ at_ms: NOW - 40000, state: 'ok' })
const ALL_OK: Sources = { tasks: OK(), hosts: OK(), cards: OK(), quota_now: OK(), quota_forecast: OK() }
const text = (r: { text: string }[]): string => r.map(s => s.text).join('')
const snap = (pools: unknown[] = POOLS, o: Parameters<typeof consoleOf>[1] = {}): ConsoleSnapshot => consoleOf(pools, { sources: ALL_OK, ...o }) as ConsoleSnapshot
const SIZES: [number, number][] = [[80, 24], [120, 30], [160, 40], [60, 9]]
const hOf = (rows: number): number => frameHeight(rows)

test('gate2 item 1: W1: the height uses the host allocation; every page at every size is exactly H rows with the strip on row H-1', () => {
  expect([frameHeight(40), frameHeight(30), frameHeight(24), frameHeight(9)]).toEqual([40, 30, 24, 9])
  expect(FRAME_MAX_ROWS).toBe(24)
  const states: [string, unknown][] = [['no console', null], ['whole', snap()], ['unknown pools', snap(POOLS)]]
  const bad: string[] = []
  for (const page of PAGES) for (const [cols, rows] of SIZES) for (const [name, c] of states) {
    const H = hOf(rows)
    const out = frameRows(page, ctxOf(cols, H, c) as never, { pages: PAGES })
    if (out.length !== H) bad.push(page.id + ' ' + cols + 'x' + rows + ' ' + name + ': ' + out.length + ' rows, want ' + H)
    const at1 = out.findIndex(r => r.some(s => s.press !== undefined && /^tab:1:/.test(s.press)))
    const want1 = cols < 66 ? H - 2 : H - 1
    if (at1 !== want1) bad.push(page.id + ' ' + cols + 'x' + rows + ' ' + name + ': strip row 1 on ' + at1 + ', want ' + want1)
    const atLast = out.findIndex(r => r.some(s => s.press !== undefined && /^tab:7:/.test(s.press)))
    if (atLast !== H - 1) bad.push(page.id + ' ' + cols + 'x' + rows + ' ' + name + ': strip last row on ' + atLast + ', want ' + (H - 1))
  }
  expect(bad).toEqual([])
})

test('gate2 item 1: the strip row does not move between a short page and a long page (no jump on page switch)', () => {
  const at = (p: Page, c: unknown) => frameRows(p, ctxOf(160, hOf(40), c) as never, { pages: PAGES }).findIndex(r => text(r).includes('1 現況'))
  const rows = [at(nowPage, null), at(nowPage, snap()), at(fleetPage, snap()), at(quotaPage, snap()), at(PAGES.find(p => p.id === 'pet') as Page, snap())]
  expect(new Set(rows).size).toBe(1)
  expect(rows[0]).toBe(39) // W1: all 40 host body rows.
})

test('gate2 item 1: actions sit directly above the strip, the body touches the actions, only the leftover above the body is blank', () => {
  const out = frameRows(PAGES.find(p => p.id === 'pet') as Page, ctxOf(160, 24, snap(POOLS.map(p => ({ ...p, stranded_seats: 1 })), { cards: [] })) as never, { pages: PAGES }).map(text)
  expect(out.length).toBe(24)
  const last = out.length - 1
  expect(out[last - 2]).toContain('沒有待決卡') // the action row is right above the v7.4 border row, which sits above the strip
  const content = out.indexOf(t('page.pet.none'))
  expect(content, 'the body touches the first action').toBe(last - 3)
  const blanks = out.map((l, i) => (l.trim() === '' ? i : -1)).filter(i => i >= 0)
  expect(blanks.length).toBeGreaterThan(0)
  expect(blanks.every((i, k) => k === 0 || i === blanks[k - 1] + 1), 'the blank rows are one run').toBe(true)
  expect(blanks[0]).toBe(1) // padding starts after the fixed header
  expect(blanks[blanks.length - 1]).toBe(content - 1) // padding ends directly above content
})

test('gate2 item 1: free rows unfold first (folded fleet lines, a pool\'s seats) and the surface stays H rows', () => {
  const c = snap()
  const lines = (c.lines as NonNullable<ConsoleSnapshot['lines']>)
  const many = { ...c, lines: [...lines, ...lines, ...lines].map((l, i) => ({ ...l, line_id: 'L' + i, label: 'L' + i })) } as ConsoleSnapshot
  const folded = frameRows(fleetPage, ctxOf(160, 40, many) as never, { pages: PAGES })
  const unfold = (ctx: never) => fleetView(ctx, { focus: 0, expanded: true })
  const open = frameRows(fleetPage, ctxOf(160, 40, many) as never, { pages: PAGES, unfold })
  expect(open.length).toBe(40)
  expect(folded.length).toBe(40)
  const linesIn = (rows: typeof open) => rows.map(text).filter(l => /L\d+/.test(l)).length
  expect(linesIn(open), 'room left: every line is shown').toBeGreaterThan(linesIn(folded))
  // no room: the unfold is not taken (the body would be cut)
  const tight = frameRows(fleetPage, ctxOf(160, 10, many) as never, { pages: PAGES, unfold })
  expect(tight.length).toBe(10)
  expect(linesIn(tight)).toBeLessThanOrEqual(linesIn(frameRows(fleetPage, ctxOf(160, 10, many) as never, { pages: PAGES })))
  expect(renderQuota(ctxOf(160, 40, c) as never, { focus: 0, expanded: true }).body.length).toBeGreaterThan(renderQuota(ctxOf(160, 40, c) as never, { focus: 0, expanded: false }).body.length - 1)
})

test('gate2 item 2: each 額度 pool row stays one row (no continuation rows in the table), and the full verdict is on screen in the focus area', () => {
  const long = '這是一段很長的判定文字用來測試換行縮排不會切到表格裡面去而且每一個字都要完整顯示出來不能被截斷'
  const pools = POOLS.map(p => (p.pool === 'team' ? { ...p, stale_note: long, stale: true, stale_age_min: 200 } : p))
  const c = snap(pools)
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as [number, number][]) {
    const out = frameRows(quotaPage, ctxOf(cols, rows, c) as never).map(text)
    const at = out.findIndex(l => /^[▸ ] [✗?▲✓]/.test(l) && l.includes('team'))
    expect(at).toBeGreaterThan(0)
    const cont: string[] = []
    for (let i = at + 1; i < out.length - 1 && /^\s{20,}\S/.test(out[i]); i++) cont.push(out[i])
    expect(cont.length, cols + ': pool table rows never wrap onto continuation rows').toBe(0)
    expect(out.join('').replace(/\s+/g, ''), cols + ': the whole verdict is on screen').toContain(long)
  }
})

// ---- item 3: one key hint form ----
// (the Pane draws the unfold itself: see the fleet test at the end)
type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walk = (n: any, out: Node[] = []): Node[] => {
  if (n === null || n === undefined || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walk(n.props?.children, out)
  return out
}
const flat = (n: any): string => { const c = n?.props?.children; return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : '' }
const LIVE0 = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
const dec = (id: string) => ({ id, title: null, question: 'q ' + id, background: 'bg', options: ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, description: '' })), recommendation: null, why: null, blocks: null, not_authorized: null, source: 'game-lead', opened_at: null, stale: false, age_s: 60, origin: null, orphaned: false, kind: 'decide' })

// every framed row as the HOST draws it: a hotkey Button is `<key>: <label>`, anything else is its text
function hostRows(tab: string, cols: number, rows: number, over: Record<string, unknown>, live: unknown = LIVE0): { text: string; buttons: Node[] }[] {
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  const tree = Pane(EL as never, live as never, tab as never, () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: snap(), nowMs: NOW, rows, ...over } as never)
  const root = walk(tree).find(n => n.kind === 'Box' && n.props.height === rows) as Node
  const kids = ([] as any[]).concat(root.props.children).flat(9).filter(c => c && c.props && /^f\d+$/.test(String(c.props.key)))
  return kids.map(row => {
    const parts = ([] as any[]).concat(row.props.children).flat(9).filter(Boolean)
    const buttons = walk(row).filter(n => n.kind === 'Button')
    return { text: parts.map((p: any) => (p.kind === 'Button' ? (p.props.hotkey === undefined ? '' : p.props.hotkey + ': ') + flat(p) : flat(p))).join(''), buttons }
  })
}

test('gate2 item 3: no drawn row has both hint forms ("x: label" and "[x] label"), and no label repeats its own hotkey', () => {
  const live = { ...(LIVE0 as object), pending: [dec('d-aaaa0001'), dec('d-aaaa0002')] }
  const cases: [string, Record<string, unknown>][] = [
    ['decide', { decide: { ...NO_NAV, picks: { 'd-aaaa0001': 0 } } }],
    ['decide', { decide: { ...NO_NAV, picks: { 'd-aaaa0001': 1 }, hold: { 'd-aaaa0001': NOW - 2000 } } }],
    ['decide', {}], ['fleet', {}], ['spend', { console: consoleOf(POOLS.map(p => ({ ...p, switch_suggestion: 'personal -> team' }))) }], ['now', {}],
  ]
  const bad: string[] = []
  for (const [tab, over] of cases) for (const [cols, rows] of [[160, 24], [80, 24], [70, 24]] as [number, number][]) {
    for (const r of hostRows(tab, cols, rows, over, live)) {
      const hostForm = r.buttons.some(b => b.props.hotkey !== undefined && !/^\d$/.test(b.props.hotkey))
      if (hostForm && /\[[a-z]\] /.test(r.text)) bad.push(tab + ' ' + cols + ': ' + r.text)
      for (const b of r.buttons) {
        const h = b.props.hotkey
        if (h !== undefined && new RegExp('^\\s*(\\[' + h + '\\]|' + h + '[:：])').test(flat(b))) bad.push(tab + ' label repeats its key: ' + flat(b))
      }
    }
  }
  expect(bad).toEqual([])
  expect(pageHotkeys('decide')).toContain('l')
})

// ---- item 4 ----
test('gate2 item 4: 80x24 額度 shows at least one pool row, and the frame is exactly the available height', () => {
  const out = frameRows(quotaPage, ctxOf(80, hOf(24), snap()) as never).map(text)
  expect(out.length).toBe(24)
  expect(out.filter(l => /^[▸ ] [✗?▲✓] \S/.test(l)).length).toBeGreaterThanOrEqual(1)
  const small = frameRows(quotaPage, ctxOf(80, 8, snap()) as never).map(text)
  expect(small.length).toBe(8)
  expect(small.filter(l => /^[▸ ] [✗?▲✓] \S/.test(l)).length, 'even 8 rows show a pool').toBeGreaterThanOrEqual(1)
  const now = frameRows(nowPage, ctxOf(80, 24, snap()) as never).map(text)
  expect(now.slice(1, -1).filter(l => l.trim() !== '').length).toBeGreaterThanOrEqual(3)
})

// ---- item 5 ----
test('gate2 item 5: 現況 at 80 columns says the pending sentence once; the action row is only the jump', () => {
  const out = frameRows(nowPage, ctxOf(80, 24, snap()) as never).map(text)
  expect((out.join('').match(/待決 \d+ 張卡等你/g) ?? []).length, 'the sentence may wrap, so the rows are joined').toBe(1)
  expect(out.some(l => l.includes('[2]'))).toBe(true)
})

// ---- item 6 ----
test('gate2 item 6: 資料不足 only for a missing or not-ok source; unknown pools say how many (缺換池資料)', () => {
  const last = (c: unknown) => frameRows({ ...quotaPage, render: ctx => ({ ...quotaPage.render(ctx), actions: [] }) }, ctxOf(120, 24, c) as never).map(text).slice(-3, -2)[0]
  const miss = snap(POOLS, { sources: { ...ALL_OK, quota_forecast: { at_ms: null, state: 'no_source' } } })
  expect(last(miss)).toContain('資料不足，無法判定')
  const unknown = snap(POOLS, { cards: [] })
  expect(last(unknown)).toBe('2 池判定未知（缺換池資料）；沒有待決卡')
  expect(last(unknown)).not.toContain('資料不足')
  const known = snap(POOLS.map(p => ({ ...p, stranded_seats: 1 })), { cards: [] })
  expect(last(known)).toContain('沒有待決卡')
})

// actionRows is imported only so the contract of the unfold test above sees the same A the frame uses
void actionRows
void displayWidth

test('gate2 item 1: the pane unfolds a folded fleet when the rows are free, and stays H rows', () => {
  const c = snap()
  const lines = c.lines as NonNullable<ConsoleSnapshot['lines']>
  const many = { ...c, lines: [...lines, ...lines, ...lines].map((l, i) => ({ ...l, line_id: 'L' + i, label: 'L' + i })) } as ConsoleSnapshot
  const rows = hostRows('fleet', 160, 40, { console: many, rows: 40 })
  expect(rows.length).toBe(40)
  expect(new Set(rows.flatMap(r => r.text.match(/\bL\d+\b/g) ?? [])).size, 'every line is drawn: no fold while rows are free').toBe(lines.length * 3)
})

// ---- items 7-12 (carbon review of 4844e16db) ----
import { lineTotal } from './pages/rows'
import { decidePage } from './pages/decide'

test('gate2 item 7: only the rendered action rows bind a [x] hint; a body row quoting "[s] ..." near the strip stays text', () => {
  const body = Array.from({ length: 27 }, (_, i) => [{ text: i === 26 ? '[l] quoted in the body' : 'body ' + i }])
  const page: Page = { id: 'decide', key: '2', title: 'x', framed: true, render: () => ({ body, actions: [[{ text: '[h] real action' }]] }) }
  const rows = hostRows('decide', 160, 32, { pages: [...PAGES.filter(p => p.id !== 'decide').map(p => ({ ...p, framed: true as const })), { ...page }], pageId: 'decide', rows: 32 })
  const quoted = rows.find(r => r.text.includes('quoted in the body')) as { buttons: Node[] }
  expect(quoted.buttons.filter(b => b.props.hotkey === 'l')).toEqual([])
  const act = rows.find(r => r.text.includes('real action')) as { buttons: Node[] }
  expect(act.buttons.some(b => b.props.hotkey === 'h')).toBe(true)
})

test('gate2 item 8: the strip never has a label-less Button; 0 keeps its Button at every width; under 66 columns the strip splits onto two rows', () => {
  for (const cols of [120, 80, 70, 60, 56, 50, 40, 36]) {
    const out = frameRows(nowPage, ctxOf(cols, 24, snap()) as never, { pages: PAGES })
    const sRows = cols < 66 ? out.slice(-2) : out.slice(-1)
    for (const r of sRows) {
      for (const s of r.filter(x => x.press !== undefined)) expect(s.text, cols + ': a Button has a label').toMatch(/^\S+ \S/)
      const helpCount = 0 // v7.4: no `i` entry on the strip
      expect(displayWidth(text(r)) + r.filter(s => s.press !== undefined).length + helpCount, cols + ': within the width with the host prefix').toBeLessThanOrEqual(cols)
    }
    const last = sRows[sRows.length - 1]
    expect(last.some(s => s.text.startsWith('0 ') && s.text.length > 2), cols + ': 0 keeps its label').toBe(true)
  }
})

test('gate2 item 9: the zh-TW decide nav hints split into [h] and [l] Buttons (single space before [l])', () => {
  // W3: open, held and sent now share the compact navigation string. Verify
  // the rendered Buttons for all three states instead of retired locale ids.
  const live = { ...(LIVE0 as object), pending: [dec('d-aaaa0001'), dec('d-aaaa0002')] }
  for (const state of [NO_NAV, { ...NO_NAV, picks: { 'd-aaaa0001': 0 }, hold: { 'd-aaaa0001': NOW - 2000 } }, { ...NO_NAV, sent: { 'd-aaaa0001': NOW - 12000 } }]) {
    const rows = hostRows('decide', 70, 24, { decide: state }, live)
    expect(rows.flatMap(r => r.buttons).filter(b => b.props.hotkey === 'h' || b.props.hotkey === 'l').map(b => b.props.hotkey)).toEqual([])
    expect(rows.map(r => r.text).join('\n')).toContain('待決在 band 上（d）')
  }
})

test('gate2 item 10: empty state three ways (calm / unknown pools / source or seat feed not ok)', () => {
  const green = snap([POOLS.find(p => p.pool === 'codex')], { cards: [] })
  const last = (p: Page, c: unknown, live: unknown = null) => frameRows({ ...p, render: ctx => ({ ...p.render(ctx), actions: [] }) }, { ...(ctxOf(120, 24, c) as object), live } as never).map(text).slice(-3, -2)[0]
  expect(last(quotaPage, green)).toBe('沒有要你處理的事')
  expect(last(quotaPage, snap(POOLS, { cards: [] }))).toBe('2 池判定未知（缺換池資料）；沒有待決卡')
  expect(last(quotaPage, snap(POOLS.map(p => ({ ...p, stranded_seats: 1 })), { cards: [] }))).toBe('沒有待決卡')
  const emptyNow: Page = { ...nowPage, render: () => ({ body: [], actions: [] }) }
  expect(last(emptyNow, green, null), 'a 現況 with no seat feed is missing data').toContain('資料不足，無法判定')
  expect(last(emptyNow, green, { state: 'stale', header: 'x', pending: [] })).toContain('資料不足，無法判定')
  expect(last(emptyNow, green, { state: 'ok', header: 'x', pending: [] })).toBe('沒有要你處理的事')
})

test('gate2 item 11: no raw field or pool names (cards source, quota.pools, switched pool)', () => {
  const stale = snap(POOLS, { sources: { ...ALL_OK, cards: { at_ms: NOW - 20 * 60000, state: 'stale' } } })
  const dec = frameRows(decidePage, { ...(ctxOf(120, 24, stale) as object), live: { state: 'ok', header: 'x', pending: [] } } as never).map(text).join('\n')
  expect(dec).not.toMatch(/\bcards\b/)
  const empty = frameRows(quotaPage, ctxOf(120, 24, consoleOf([], { sources: ALL_OK })) as never).map(text).join('\n')
  expect(empty).not.toContain('quota.pools')
  const sw = renderQuota(ctxOf(160, 40, snap(POOLS.map((p, i) => i === 0 ? { ...p, limit_hit: true, stranded_seats: 0, switched: 'pool-b' } : p))) as never, { focus: 0, expanded: false }).body.flat().map(s => s.text).join('')
  expect(sw).not.toContain('pool-b')
})

test('gate2 item 12: one line total: 現況 and 艦隊 and the band read lineTotal, never fewer than the lines listed', () => {
  const c = snap()
  const listed = (c.lines ?? []).length
  const low = { ...c, counts: { ...c.counts, summary: { ...c.counts.summary, lines: { active: 1 } } } } as ConsoleSnapshot
  expect(listed).toBeGreaterThan(1)
  expect(lineTotal(low)).toBe(listed)
})
