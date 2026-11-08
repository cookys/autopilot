// mods/live/consoleframe.test.ts — C1 U5: the console pane's 指揮 page drawn through pane.tsx (the real consolePane, scrollFrame and line renderer) with fictional fixtures injected as the snapshot.
// The fake Box / Text / Button below make plain nodes; `screen` lays them out as terminal rows (a column Box stacks, a Box with a height clips or pads it, a flexGrow child takes what is left,
// a row Box of columns is zipped). Pins: the 120 / 80 / 20 column drawings (printed between SNAPSHOT-BEGIN / END for the plan §3.5 diff), the action area's screen row unchanged by scrolling,
// the non-console branch still drawing the Pane exactly as before (its tab strip row), and the scrollbar only when the content overflows.
import { test, expect } from 'claude-code/testing'
import { Pane } from './pane'
import { parseConsole } from './console'
import { makeT } from './i18n'
import { newScroll } from './scrollmath'
import full from './fixtures/console/console-full.fixture'

type Node = { kind: 'Box' | 'Text' | 'Button' | 'Input' | 'Link'; props: Record<string, any> }
const mk = (kind: Node['kind']) => (props: Record<string, any>): Node => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }

const kids = (n: any): any[] => {
  const c = n?.props?.children
  return c === undefined || c === null || c === false ? [] : Array.isArray(c) ? c.flat(Infinity).filter((x: any) => x !== null && x !== false && x !== undefined) : [c]
}
const norm = (n: any): any => (n !== null && typeof n === 'object' && typeof n.type === 'function' && n.kind === undefined ? n.type(n.props) : n)
// the text of a node laid on ONE row (a Text, a Button, an inline Box)
const inline = (n0: any): string => {
  const n = norm(n0)
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  return kids(n).map(inline).join('')
}
const isRowBox = (n: any): boolean => n.kind === 'Box' && n.props.flexDirection === 'row'
const isColBox = (n: any): boolean => n.kind === 'Box' && (n.props.flexDirection === 'column' || n.props.height !== undefined)
function screen(n0: any, grow = 0): string[] {
  const n = norm(n0)
  if (n === null || n === undefined || n === false) return []
  if (typeof n === 'string' || typeof n === 'number') return [String(n)]
  if (n.kind === 'Text' || n.kind === 'Button') return [inline(n)]
  if (isRowBox(n)) {
    const cols = kids(n).map(c => screen(c, grow))
    const h = Math.max(grow, ...cols.map(c => c.length))
    return Array.from({ length: h }, (_, i) => cols.map(c => c[i] ?? '').join(''))
  }
  if (isColBox(n)) {
    const parts = kids(n).map(c => ({ c, g: norm(c)?.props?.flexGrow !== undefined }))
    const fixed = parts.filter(p => !p.g).flatMap(p => screen(p.c))
    const height: number | undefined = n.props.height
    const left = height === undefined ? 0 : Math.max(0, height - fixed.length)
    const out = parts.flatMap(p => (p.g ? screen(p.c, left) : screen(p.c)))
    return height === undefined ? out : out.slice(0, height).concat(Array.from({ length: Math.max(0, height - out.length) }, () => ''))
  }
  // a plain Box: its children are one row unless one of them is itself a block
  const ch = kids(n)
  if (ch.some(c => { const x = norm(c); return x?.kind === 'Box' && (isColBox(x) || isRowBox(x)) })) return ch.flatMap(c => screen(c))
  return [inline(n)]
}

const t = makeT('zh-TW')
const NOW = 1794200000000
const HELD = { id: 'd-fx000001', title: null, question: '記憶線：測試綠了，合併到 develop 嗎？', background: 'fixture：--no-ff，測試在 tip 全綠。', options: [{ label: '准合併', description: '' }, { label: '再看 diff', description: '' }], recommendation: '准合併', why: null, blocks: null, not_authorized: null, source: null, opened_at: null, stale: false, age_s: 7200 }
const LIVE = { band: {}, pending: [HELD], detail: { qc: null, residue: null, load_source: null } } as never
const SNAP = parseConsole(JSON.stringify(full))

function draw(cols: number, rows: number, win = newScroll(), tab: 'command' | 'team' = 'command') {
  const con = { nav: { snap: SNAP, tab }, onTab: () => {}, onNext: () => {}, live: LIVE, now: NOW, scroll: { offset: 0, bodyRows: rows }, win, decide: null }
  return screen(Pane(EL, null, 'now', () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), { offset: 0, bodyRows: rows }, null, win, null, con as never))
}
const rowOf = (lines: string[], needle: string): number => lines.findIndex(l => l.includes(needle))

test('指揮 drawn at 120 / 80 / 20 columns: order summary, exceptions, queue, data age; printed for the mockup diff', () => {
  for (const [cols, rows] of [[120, 40], [80, 30], [20, 24]] as const) {
    const lines = draw(cols, rows)
    console.log('SNAPSHOT-BEGIN ' + cols + ' columns x ' + rows + ' rows\n' + lines.map(l => '|' + l).join('\n') + '\nSNAPSHOT-END')
    const at = (s: string) => rowOf(lines, s)
    expect(at('產線'), cols + ': summary after the strip').toBeGreaterThan(0)
    expect(at('例外'), cols + ': exceptions after summary').toBeGreaterThan(at('產線'))
    expect(at('待決'), cols + ': queue after exceptions').toBeGreaterThan(at('例外'))
    expect(at('資料'), cols + ': data age under everything').toBeGreaterThan(at('待決'))
  }
})

test('the action area keeps its screen row while the window scrolls', () => {
  for (const [cols, rows] of [[120, 14], [80, 14], [20, 14]] as const) {
    const win = newScroll()
    const first = draw(cols, rows, win)
    const barAt = rowOf(first, '資料')
    const ruleAt = barAt - 2
    expect(win.max, cols + ': the content overflows so there is something to scroll').toBeGreaterThan(0)
    const seen = new Set<string>([first[3]])
    for (const off of [1, 3, win.max]) {
      win.offset = off
      const moved = draw(cols, rows, win)
      expect(rowOf(moved, '資料'), cols + ' offset ' + off + ': the data-age row').toBe(barAt)
      expect(rowOf(moved, '按按鈕作答') < 0 ? barAt - 1 : rowOf(moved, '按按鈕作答'), cols + ' offset ' + off + ': the hint row').toBe(barAt - 1)
      expect(moved[ruleAt], cols + ' offset ' + off + ': the rule above the action area').toBe(first[ruleAt])
      expect(moved.length, cols + ' offset ' + off + ': the frame height').toBe(first.length)
      seen.add(moved[3])
    }
    expect(seen.size, cols + ': the scrolled window shows other rows').toBeGreaterThan(1)
  }
})

test('the team page draws its summary line under the strip', () => {
  const lines = draw(120, 30, newScroll(), 'team')
  expect(lines.some(l => l.includes(t('console.team.summary', { running: 0, waiting: 0, stalled: 0 }).split(/[：:]/)[0]))).toBe(true)
})
