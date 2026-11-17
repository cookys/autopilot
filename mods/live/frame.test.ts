// mods/live/frame.test.ts — S0 of the pane tab merge (plan r2 §3.1, §3.2, §5): the fixed-height frame, the page registry and the pane's key table.
// Pure: frameRows and paneKey are called directly; the strip is also drawn through the real Pane with fake elements.
import { test, expect } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane } from './pane'
import { makeT } from './i18n'
import { actionRows, brokenRow, frameRows, mostSevere } from './pages/frame'
import type { Page, PageCtx, Row } from './pages/frame'
import { PAGES } from './pages/index'
import * as M from './model'
import { displayWidth } from './model'
import { parseConsole } from './console'
import full from './fixtures/console/console-full.fixture'

const t = makeT('zh-TW')
const SIZES = [{ cols: 160, rows: 40 }, { cols: 120, rows: 30 }, { cols: 80, rows: 24 }]
const NOW = 1794200000000
const line = (s: string): Row => [{ text: s }]
const SNAP = parseConsole(JSON.stringify(full))
const ctxOf = (size: { cols: number; rows: number }, console: PageCtx['console'] = null): PageCtx => ({ live: null, console, size, t, nowMs: NOW })
const withBody = (p: Page, body: number, actions: number): Page => ({ ...p, render: () => ({ body: Array.from({ length: body }, (_, i) => line('body ' + i)), actions: Array.from({ length: actions }, (_, i) => line('act ' + i)) }) })
const text = (r: Row): string => r.map(s => s.text).join('')
const stale = (): NonNullable<PageCtx['console']> => ({ ...(SNAP as NonNullable<typeof SNAP>), sources: { fleet: { at_ms: NOW - 6 * 60000, state: 'stale' }, quota: { at_ms: null, state: 'no_source' } } })

test('registry: eleven pages in key order 1-8, 9 pet, 0 forge, ? help; shells are empty, the pet page is a placeholder (g2 folds A6)', () => {
  expect(PAGES.map(p => p.id + p.key)).toEqual(['now1', 'decide2', 'fleet3', 'quota4', 'dispatch5', 'review6', 'spend7', 'hygiene8', 'pet9', 'forge0', 'help?'])
  for (const p of PAGES) {
    const r = p.render(ctxOf(SIZES[0]))
    if (p.id === 'pet') expect(r.body.map(x => x.map(g => g.text).join(''))).toEqual(['寵物分頁還沒上線'])
    else expect(r).toEqual({ body: [], actions: [] })
  }
})

for (const size of SIZES) {
  for (const page of PAGES) {
    const states: [string, Page, PageCtx['console']][] = [
      ['empty', page, null],
      ['overflowing body', withBody(page, 200, 0), null],
      ['body one over', withBody(page, size.rows - 2 - actionRows(size.rows) + 1, 0), null],
      ['actions full', withBody(page, 3, actionRows(size.rows)), null],
      ['stale source', withBody(page, 5, 2), stale()],
      ['wide text', { ...page, render: () => ({ body: [line('字'.repeat(300))], actions: [line('x'.repeat(300))] }) }, null],
    ]
    for (const [name, p, con] of states) {
      test('frame: ' + page.id + ' ' + name + ' at ' + size.cols + 'x' + size.rows + ' is exactly ' + size.rows + ' rows, none wider than the pane', () => {
        const rows = frameRows(p, ctxOf(size, con), { pages: PAGES })
        expect(rows.length).toBe(size.rows)
        for (const r of rows) expect(displayWidth(text(r))).toBeLessThanOrEqual(size.cols)
      })
    }
  }
}

test('frame: layout, header on row 0, strip on the last row, A = 6 from 32 rows else 4, actions bottom-up, the overflow hint takes the last body row', () => {
  expect([actionRows(40), actionRows(32), actionRows(31), actionRows(24)]).toEqual([6, 6, 4, 4])
  const page = withBody(PAGES[1], 200, 2)
  const rows = frameRows(page, ctxOf({ cols: 120, rows: 30 }), { pages: PAGES })
  expect(text(rows[0])).toBe('待決')
  expect(text(rows[29])).toContain('1 現況')
  expect(text(rows[29])).toContain('2 待決')
  expect(text(rows[29])).toContain('? 說明  Esc 收起')
  expect(text(rows[28])).toBe('act 1') // the last action is the bottom row, directly over the strip
  expect(text(rows[27])).toBe('act 0')
  const bodyRoom = 30 - 2 - 4
  expect(text(rows[bodyRoom])).toBe('↓ 還有 ' + (200 - (bodyRoom - 1)) + ' 列（PgDn）') // the last body row; the total did not change
  expect(text(rows[bodyRoom - 1])).toBe('body ' + (bodyRoom - 2))
})

test('frame: no action says 沒有要你處理的事 on the bottom action row only; a short body is bottom-anchored', () => {
  const rows = frameRows(withBody(PAGES[0], 2, 0), ctxOf({ cols: 80, rows: 24 }), { pages: PAGES })
  expect(text(rows[22])).toBe('沒有要你處理的事')
  expect(rows.filter(r => text(r) === '沒有要你處理的事').length).toBe(1)
  expect(text(rows[24 - 2 - 4])).toBe('body 1') // the body ends right over the action area
})

test('frame: scroll moves the window, and an offset past the end is clamped (still H rows)', () => {
  const rows = frameRows(withBody(PAGES[0], 100, 0), ctxOf({ cols: 80, rows: 24 }), { pages: PAGES, scroll: 9999 })
  expect(rows.length).toBe(24)
  const body = rows.slice(1, 1 + 18)
  expect(text(body[17])).toBe('body 99') // clamped to the end: the window shows the last rows and no hint
  expect(text(body[0])).toBe('body 82')
  expect(frameRows(withBody(PAGES[0], 100, 0), ctxOf({ cols: 80, rows: 24 }), { pages: PAGES, scroll: 10 }).slice(1, 19).map(text)[17]).toBe('↓ 還有 73 列（PgDn）')
})

test('frame: more actions than the area holds throws (a programming error), at both A sizes', () => {
  expect(() => frameRows(withBody(PAGES[0], 0, 7), ctxOf({ cols: 160, rows: 40 }))).toThrow()
  expect(() => frameRows(withBody(PAGES[0], 0, 5), ctxOf({ cols: 80, rows: 24 }))).toThrow()
  expect(() => frameRows(withBody(PAGES[0], 0, 6), ctxOf({ cols: 160, rows: 40 }))).not.toThrow()
})

test('§5: a broken source is a red text colour (the broken palette key, no background, no inverse) with its reason; the header shows the most severe', () => {
  const m = mostSevere(ctxOf({ cols: 120, rows: 30 }, stale()))
  expect(m?.text).toBe('✗ quota 無來源') // no_source outranks stale
  expect(m?.color).toBe('error')
  expect(Object.keys(m as object).filter(k => k !== 'text' && k !== 'color')).toEqual([])
  expect(brokenRow('x')[0].color).toBe('error')
  const only = { ...(SNAP as NonNullable<typeof SNAP>), sources: { fleet: { at_ms: NOW - 6 * 60000, state: 'stale' as const } } }
  expect(mostSevere(ctxOf({ cols: 120, rows: 30 }, only))?.text).toBe('✗ fleet 資料過期，6 分鐘前')
  expect(mostSevere(ctxOf({ cols: 120, rows: 30 }, null))).toBeNull()
  const rows = frameRows(PAGES[2], ctxOf({ cols: 120, rows: 30 }, stale()), { pages: PAGES })
  expect(text(rows[0])).toContain('✗ quota 無來源')
  expect(rows[0].some(s => s.color === 'error')).toBe(true)
})

// ---- the pane draws the strip: no `›` chip, digits are the hotkeys ----
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
const flat = (n: Node): string => { const c = n.props.children; return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : '' }

test('pane strip: no `›` next chip anywhere, every digit tab is a Button with its digit as hotkey (old strip and framed page)', () => {
  const live = { state: 'ok', text: 'x', header: 'x', band: { kind: 'idle', verdict: '', reason: null, project: 'x', elapsed: '1m', phase: '', slots: [] }, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
  const old = walk(Pane(EL as never, live, 'now', () => {}, t, 120))
  expect(old.filter(n => n.kind === 'Button').map(n => n.props.key)).not.toContain('next')
  expect(old.some(n => n.kind === 'Text' && flat(n).trim() === '›')).toBe(false)
  expect(Object.fromEntries(old.filter(n => n.kind === 'Button' && n.props.hotkey !== undefined).map(n => [n.props.key, n.props.hotkey]))).toEqual({ now: '1', decide: '2', fleet: '3', spend: '4', dispatch: '5', review: '6', hygiene: '8' })
  const shown: Page[] = PAGES.map(p => ({ ...p, framed: true as const }))
  const framed = walk(Pane(EL as never, live, 'decide', () => {}, t, 120, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: null, nowMs: NOW, rows: 30 }))
  const anchor = framed.filter(n => n.kind === 'Button' && n.props.autoFocus === true)
  expect(anchor.map(n => n.props.key), 'the one autoFocus Button is the inert anchor (g2 fold A5), not a tab').toEqual([FOCUS_ANCHOR_KEY])
  const btn = framed.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY)
  expect(btn.map(n => n.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  expect(btn.some(n => flat(n).includes('›'))).toBe(false)
  expect(framed.find(n => n.kind === 'Box' && n.props.height === 30)).toBeDefined()
})
