import { test, expect } from 'claude-code/testing'
import { BandBar } from './band'
import { consoleOf, ctxOf, POOLS, NOW, MIN } from './pages/quota.fixture'
import { makeT } from './i18n'
import * as M from './model'
import { displayWidth } from '../tux/width.ts'

type Node = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }
const flat = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : n?.props ? flat(n.props.children) : ''
const live = { state: 'ok', text: 'x', header: 'x', band: null, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as any
const band = (cols: number, con: any, snap = live, preset: any = null) => BandBar(EL as never, snap, cols, makeT('zh-TW'), { onInfo() {}, onSlot() {}, onTab() {} }, null, null, true, null, { snap: con, tab: 'command', cols } as never, preset, null, true).node as Node
const bandRows = (node: Node) => (node.props.children as Node[]).flat().filter(Boolean)

test('R4-1: 120x30 open pane keeps stale fleet class, age and quota cause above the full repair command', () => {
  const con = consoleOf(POOLS) as any
  con.sources = { tasks: { state: 'expired', at_ms: NOW - 12 * MIN }, quota_forecast: { state: 'no_source', at_ms: null } }
  const rows = bandRows(band(120, con))
  expect(rows.length).toBe(2)
  expect(flat(rows[0])).toContain('x')
  expect(flat(rows[0])).not.toContain('艦隊過期')
  expect(flat(rows[0])).not.toContain('額度無預測來源')
  expect(flat(rows[0])).not.toContain('autopilot status runs --watch')
  expect(flat(rows[1])).toBe('  autopilot status runs --watch')
  for (const row of rows) expect(displayWidth(flat(row))).toBeLessThanOrEqual(116)
})

import { renderQuota } from './pages/quota'
const rowText = (r: { text: string }[]) => r.map(s => s.text).join('')
const quotaCon = () => consoleOf([...POOLS, { ...POOLS[0], pool: 'team-b', projected_pct_at_reset: 88 }])

test('R4-2: 120x30 and 160x40 tables omit repeated labels and align fixed numeric cells', () => {
  // Inject the pane's available width separately from the terminal size; no real-session measurement is claimed.
  for (const [termCols, termRows, bodyCols] of [[120, 30, 120], [160, 40, 160], [120, 30, 76], [160, 40, 116]]) {
    const out = renderQuota(ctxOf(bodyCols, termRows - 5, quotaCon()))
    const rows = out.body.filter(r => r.some(s => s.press?.startsWith('quota:pool:')))
    expect(rows.length, termCols + ' table has fixture rows').toBeGreaterThan(0)
    for (const r of rows) {
      expect(rowText(r)).not.toContain('7天')
      expect(rowText(r)).not.toContain('5時')
      expect(r[3].text.endsWith(' '), 'fixed numeric column').toBe(true)
      expect(displayWidth(r[3].text)).toBe(displayWidth(rows[0][3].text))
    }
  }
})

test('R4-2: a clipped verdict uses an ellipsis and never keeps a number prefix', () => {
  // A width sweep puts the right edge through every digit of 12% and 98%.
  let clipped = false
  for (let cols = 40; cols <= 160; cols++) {
    const out = renderQuota(ctxOf(cols, 40, quotaCon()))
    for (const r of out.body.filter(r => r.some(s => s.press?.startsWith('quota:pool:')))) {
      const txt = rowText(r).trimEnd()
      expect(txt, cols + ': ' + txt).not.toMatch(/浪費 1$|會用到 9$/)
      if (txt.includes('浪費') && !txt.endsWith('12%') && txt.includes('team-b')) {
        expect(txt).toContain('…')
        clipped = true
      }
    }
  }
  expect(clipped, 'sweep exercises a clipped verdict').toBe(true)
})

import { frameRows } from './pages/frame'
import { decidePage, NO_NAV } from './pages/decide'
const cards = [1, 2, 3].map(i => ({ id: 'd-0000000' + i, question: '測試機第二槽插電 ' + i, status: 'open', opened_at_ms: NOW - (4 - i) * MIN, executor_display: 'lead-x · Claude (h1)' }))
test('R4-3: 80x16 with one body row shows the focused title and card count before controls', () => {
  const con = consoleOf([], { cards })
  for (const cursor of [0, 1, 2]) {
    // The host gives four rows: header, one content row, the v7.4 border row and the single navigation strip.
    const ctx = { ...(ctxOf(80, 4, con) as any), live, decide: { ...NO_NAV, cursor } }
    const rows = frameRows(decidePage, ctx).map(rowText)
    expect(rows.length).toBe(4)
    expect(rows[1]).toContain('待決在 band 上（d）')
    expect(rows[1]).not.toContain(cards[cursor].question)
    expect(rows[1]).not.toContain('第 ' + (cursor + 1) + ' 張／共 3 張')
    expect(rows[1]).not.toContain('h: 上張')
  }
})

test('R4-4: 160x40 open-pane band names the fleet even in a host-reduced band budget', () => {
  const fleet = M.slotFleet({ failed: 2, stuck: 4, normal: 3, running: 0, waiting: 0 }, makeT('zh-TW'))!
  for (const cols of [160, 120, 104, 76]) {
    const segs = fleet.segs.filter(s => s.tag !== 'fleetWord').map(s => ({ ...s, slot: 'fleet' as const }))
    const con = consoleOf([]) as any
    con.generated_at_ms = NOW; con.sources.tasks = { at_ms: NOW, state: 'ok' }
    const rows = bandRows(band(cols, con, live, { segs, width: 20 }))
    expect(flat(rows[0]), 'band budget ' + cols).toContain('艦隊 ✗')
    expect(flat(rows[0])).toContain('✗ 2  ⊘ 4')
    expect(displayWidth(flat(rows[0]))).toBeLessThanOrEqual(cols - 4)
  }
})
