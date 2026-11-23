// Acceptance tests for band single-row layout (01M837HGTX) and Decide page C maxRows fit (01M837ZECP).
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { OneRowBand } from './band'
import {
  BAND_COL_WIDTHS,
  bandBottomHint,
  bandExpandOnPageChange,
  bandExpandOnRefresh,
  bandExpandOnResize,
  bandSlotPage,
  initialBandExpand,
  layoutOneRowBand,
  oneRowText,
  toggleBandExpand,
} from './band-onerow'
import type { BandSegmentId, OneRowInput } from './band-onerow'
import { makeT } from './i18n'
import { displayWidth } from '../tux/width.ts'
import { GLYPHS } from '../tux/glyphs.ts'
import { routeKey } from './pages/keys'
import { decideColumnWidths, decideLayoutMode, decidePage, decideReduce, NO_NAV } from './pages/decide'
import type { DecideNav } from './pages/decide'
import { frameRows } from './pages/frame'
import { PAGES } from './pages/index'
import { newScroll } from './scrollmath'
import type { DecideCard } from './v74/contract'

const t = makeT('zh-TW')
const NOW = 1794200000000
type Node = { type?: string; props?: Record<string, any>; children?: any[] }
const text = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props?.label ?? text(n?.children ?? []))
const walk = (n: any): Node[] => (!n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.children)])
const rowText = (r: { text: string }[]): string => r.map(s => s.text).join('')

const sampleInput = (over: Partial<OneRowInput> = {}): OneRowInput => ({
  reminder: { text: '要你決定：合併 shared-tui plan 進 develop？', cardId: 'd-001', state: 'normal', hasRec: true, ...over.reminder },
  line: { stalled: 4, running: 3, failed: 2, waiting: 0, state: 'normal', ...over.line },
  source: { label: '開發', flags: 1, state: 'normal', ...over.source },
  pend: { count: 21, hasRec: true, state: 'normal', ...over.pend },
  qc: { status: 'alert', state: 'normal', ...over.qc },
  tps: { value: 78, state: 'normal', ...over.tps },
  spark: { bars: '▇█▆▅▆', state: 'normal', ...over.spark },
  pet: { text: 'Ferris Lv.1', state: 'normal', ...over.pet },
  expanded: over.expanded ?? false,
})

const CARDS: DecideCard[] = [
  {
    id: 'd-c1',
    title: '合併 shared-tui 進 develop',
    question: '是否要將 shared-tui 分支合併進 develop？',
    background: '已經完成所有審查，等待最後核准。',
    options: [
      { label: '立刻合併', detail: '採用 --no-ff 合併並保留歷史', recommended: true },
      { label: '暫緩一天', detail: '先觀察本輪回歸結果', recommended: false },
    ],
  },
  {
    id: 'd-c2',
    title: '清理舊 worktree',
    question: '是否清理三個閒置的 worktree？',
    background: '皆已合併回主幹。',
    options: [
      { label: '全部清理', detail: '', recommended: true },
      { label: '保留觀察', detail: '', recommended: false },
    ],
  },
]

test('band-onerow routing: segment click and digit key reach identical pages; hidden segment digit keys stay active', () => {
  const mk = (type: string) => (props: any) => ({ type, props, children: props.children })
  const el = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') }
  const clicked: BandSegmentId[] = []
  const lay = layoutOneRowBand(sampleInput(), 195, t)
  const tree = OneRowBand(el, lay, id => clicked.push(id), () => {})
  const btns = walk(tree).filter(n => n.type === 'Button')
  const keys = btns.map(b => b.props?.key)
  expect(keys).toContain('band:remind')
  expect(keys).toContain('band:line')
  expect(keys).toContain('band:source')
  expect(keys).toContain('band:pend')
  expect(keys).toContain('band:qc')
  expect(keys).toContain('band:tps')
  expect(keys).toContain('pane-toggle')
  expect(keys).not.toContain('band:spark')
  expect(keys).not.toContain('band:pet')

  const digitBySeg: [BandSegmentId, string][] = [
    ['pend', '2'],
    ['line', '3'],
    ['qc', '4'],
    ['tps', '5'],
    ['source', '8'],
  ]
  for (const [segId, digit] of digitBySeg) {
    const keyAct = routeKey(digit, { page: 'now', paneFocus: true, focusedButton: false, textMode: false })
    expect(keyAct).toEqual({ kind: 'page', to: bandSlotPage(segId) })
  }
  // Narrow width hides source and tps, yet digit keys 8 and 5 still route cleanly
  const narrow = layoutOneRowBand(sampleInput(), 75, t)
  expect(narrow.dropped).toContain('source')
  expect(narrow.dropped).toContain('tps')
  expect(routeKey('8', { page: 'now', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'page', to: 'todo' })
  expect(routeKey('5', { page: 'now', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'page', to: 'spend' })
  expect(routeKey('w', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'toggle_expand' })
  expect(bandBottomHint(75, false, t)).toContain('2')
  expect(bandBottomHint(75, false, t)).toContain('w')
})

test('band-onerow max values & alerts: Carbon Critical (a)+(b) and Codex Major (5)', () => {
  // (a) 75 cols retains shortened line alert + QC alert
  const a = layoutOneRowBand(sampleInput(), 75, t)
  expect(displayWidth(oneRowText(a))).toBeLessThanOrEqual(75)
  expect(oneRowText(a)).toContain(GLYPHS.state.failed + '2')
  expect(oneRowText(a)).toContain(GLYPHS.state.stalled + '4')
  expect(oneRowText(a)).toContain(GLYPHS.state.need_you)

  // (b) Max values obey §2.2 widths exactly
  const max = layoutOneRowBand(sampleInput({
    line: { stalled: 120, running: 200, failed: 300, waiting: 400, state: 'normal' },
    source: { label: '開發', flags: 150, state: 'normal' },
    pend: { count: 210, hasRec: true, state: 'normal' },
    tps: { value: 1250, state: 'normal' },
  }), 195, t)
  expect(max.segments.find(s => s.id === 'line')?.width).toBe(BAND_COL_WIDTHS.line)
  expect(max.segments.find(s => s.id === 'pend')?.width).toBe(BAND_COL_WIDTHS.pend)
  expect(max.segments.find(s => s.id === 'tps')?.width).toBe(BAND_COL_WIDTHS.tps)

  // Codex Major (5): tok/s 9 -> 78 -> 120 keeps suffix column fixed
  const colOf = (v: number) => {
    const s = oneRowText(layoutOneRowBand(sampleInput({ tps: { value: v, state: 'normal' } }), 195, t))
    return displayWidth(s.slice(0, s.indexOf(' tok/s')))
  }
  expect(colOf(78)).toBe(colOf(9))
  expect(colOf(120)).toBe(colOf(9))
})

test('band-onerow expand/collapse regressions: refresh, narrow->widen, page switch', () => {
  let st = initialBandExpand('decide')
  st = toggleBandExpand(st)
  expect(st.expanded).toBe(true)
  expect(st.activePage).toBe('now')
  st = bandExpandOnPageChange(st, 'review')
  expect(st.expanded).toBe(true)
  st = toggleBandExpand(st)
  expect(st.expanded).toBe(false)
  st = bandExpandOnRefresh(st)
  expect(st.expanded).toBe(false)
  st = bandExpandOnResize(st, 75)
  st = bandExpandOnResize(st, 195)
  expect(st.expanded).toBe(false)
})

test('decide C layout: bodyColumns 82/83/84, +/-2 hysteresis, equal columns, maxRows 12 and 9', () => {
  const drawBox = (bodyColumns: number, maxRows: number, nav: Partial<DecideNav> = {}) => {
    const innerCols = Math.max(20, bodyColumns - 4)
    const boxRows = Math.max(6, maxRows - 1)
    const stripN = innerCols < 66 ? 2 : 1
    const ctx = {
      live: null,
      console: null,
      size: { cols: innerCols, rows: boxRows + stripN },
      bodyColumns,
      maxRows,
      t,
      nowMs: NOW,
      box: true as const,
      pendingScroll: { list: newScroll(), detail: newScroll(), cursor: '' },
      decide: { ...NO_NAV, style: 'D' as const, ...nav },
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: { cursor: nav.cursor ?? 0, picks: {}, notes: {}, noteMode: false } },
    }
    const rows = frameRows(decidePage, ctx as never, { topAnchor: true, pages: PAGES })
    return { rows: rows.map(rowText), boxRows }
  }

  // 82 -> single; 83 -> dual; 84 -> dual
  expect(decideLayoutMode(82, null)).toBe('single')
  expect(decideLayoutMode(83, null)).toBe('dual')
  expect(decideLayoutMode(84, null)).toBe('dual')
  expect(decideLayoutMode(82, 'dual')).toBe('dual')
  expect(decideLayoutMode(80, 'dual')).toBe('single')
  expect(decideLayoutMode(84, 'single')).toBe('single')
  expect(decideLayoutMode(85, 'single')).toBe('dual')

  const dual83 = drawBox(83, 16)
  expect(dual83.rows.join('\n')).toContain('卡 #01 / 2')
  expect(dual83.rows.join('\n')).toContain(' │ ')
  const single82 = drawBox(82, 16)
  expect(single82.rows.join('\n')).toContain('第 1 張，共 2 張')

  // Equal column widths at 83 (40 + 3 + 40) and 120 (58 + 3 + 59)
  expect(decideColumnWidths(83)).toEqual({ leftW: 40, rightW: 40, sepW: 3 })
  expect(decideColumnWidths(120)).toEqual({ leftW: 58, rightW: 59, sepW: 3 })

  // 80x24 (bodyColumns=75, maxRows=12): shows card question and options inside maxRows
  const at12 = drawBox(75, 12)
  const joined12 = at12.rows.join('\n')
  expect(at12.boxRows + 1).toBeLessThanOrEqual(12)
  expect(joined12).toContain('是否要將 shared-tui 分支合併進 develop？')
  expect(joined12).toContain('立刻合併')
  expect(joined12).toContain('暫緩一天')

  // maxRows=9 (< 10): collapses to 1-row-per-card list, expands on press
  const compact9 = drawBox(75, 9, { compactExpanded: false })
  expect(compact9.boxRows + 1).toBeLessThanOrEqual(9)
  expect(compact9.rows.join('\n')).toContain('01 合併 shared-tui')
  expect(compact9.rows.join('\n')).toContain('02 清理舊 worktree')
  expect(compact9.rows.join('\n')).not.toContain('立刻合併')

  // Pressing card 0 expands it within maxRows=9
  const ctx9 = {
    live: null,
    console: null,
    size: { cols: 71, rows: 9 },
    bodyColumns: 75,
    maxRows: 9,
    t,
    nowMs: NOW,
    box: true as const,
    v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
  }
  const expandedNav = decideReduce({ ...NO_NAV, compactExpanded: false }, { kind: 'cursor', at: 0 }, ctx9 as never, NOW).nav
  expect(expandedNav.compactExpanded).toBe(true)
  const expanded9 = drawBox(75, 9, expandedNav)
  expect(expanded9.boxRows + 1).toBeLessThanOrEqual(9)
  expect(expanded9.rows.join('\n')).toContain('立刻合併')
})

test('mounted AbovePrompt band height never exceeds maxRows at 12, 9, and 5 rows', async ($, on: On) => {
  const HOME = '/fake/onerow-home'
  const LIVE = '/fake/onerow-live'
  const REPO = '/work/onerow-repo'
  const SID = 'onerow-sid'
  const KEY = '0000000000000099'
  const PUBLISHED = '2026-10-04T10:00:00.000Z'
  const files: Record<string, string> = {
    [HOME + '/.autopilot/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: HOME + '/.autopilot' }),
    [HOME + '/.autopilot/session-mode/' + SID + '.json']: JSON.stringify({ session_id: SID, project_key: KEY, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '.json']: JSON.stringify({ schema: 'autopilot.runs-live/1', scope: { project_key: KEY, root_run_id: null }, published_at: PUBLISHED, valid_for_s: 180, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 } }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
  }
  const clock = mock.clock(on, { now: Date.parse(PUBLISHED) + 30_000 })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : e.name === 'AUTOPILOT_LOCALE' ? 'zh-TW' : undefined }))
  on('fs.read', (_, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', (_, e) => { if (!(e.path in files) && e.path !== REPO) throw new Error('ENOENT'); return { value: { kind: e.path === REPO ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } } })
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: REPO }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: REPO }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ surface: 'terminal', cwd: REPO })
  await clock.advance(5000)

  const countRows = (tree: Node): number => {
    const kids = (tree.children || []) as Node[]
    let total = 0
    for (const c of kids) {
      if (c?.props?.key?.startsWith('v74:') || (c?.type === 'Box' && c?.props?.flexDirection === 'column')) {
        total += (c.children || []).length
      } else {
        total += 1
      }
    }
    return total
  }

  // Expand via toggle
  const b0 = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  await b0.press({ key: 'pane-toggle' })
  await clock.advance(0)
  await b0.unmount()

  for (const maxRows of [12, 9, 5]) {
    const b = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows, view: { agentId: undefined } }, viewport: { columns: 80, rows: maxRows * 2, isFullscreen: true } })
    const tree = await b.drawn() as Node
    expect(countRows(tree), 'band rows <= maxRows ' + maxRows).toBeLessThanOrEqual(maxRows)
    await b.unmount()
  }
  await $.session.end({ reason: 'exit' })
})
