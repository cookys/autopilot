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
import { frameBottomFit, frameHintMin, frameHintShort, frameHintText, frameRows } from './pages/frame'
import { PAGES } from './pages/index'
import { Pane } from './pane'
import { paneKey, v74KeysHeldNext } from './register'
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
  // (a) 75 cols retains shortened line alert (spaced glyph + count) + QC alert
  const a = layoutOneRowBand(sampleInput(), 75, t)
  expect(displayWidth(oneRowText(a))).toBeLessThanOrEqual(75)
  expect(oneRowText(a)).toContain(GLYPHS.state.failed + ' 2')
  expect(oneRowText(a)).toContain(GLYPHS.state.stalled + ' 4')
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

const FIVE_CARDS: DecideCard[] = [
  ...CARDS,
  {
    id: 'd-c3',
    title: '預覽先拍幾欄',
    question: '截圖要包含哪幾個寬度？',
    background: '目前規則涵蓋 160、120、80 三種寬度。',
    options: [
      { label: '全拍四尺寸', detail: '', recommended: true },
      { label: '只拍窄版', detail: '', recommended: false },
    ],
  },
  {
    id: 'd-c4',
    title: '外掛更新時機',
    question: '何時把新版推進快取？',
    background: '測試全綠後再推。',
    options: [
      { label: '立即更新', detail: '', recommended: true },
      { label: '等明天', detail: '', recommended: false },
    ],
  },
  {
    id: 'd-c5',
    title: '驗收測試卡',
    question: '這張卡是否要一起驗證雙欄清單？',
    background: null,
    options: [
      { label: '是', detail: '', recommended: true },
      { label: '否', detail: '', recommended: false },
    ],
  },
]

test('decide C layout at 155/22, 115/20, and 75/12: dual-column >=3 left cards at 155 & 115, single-column card at 75', () => {
  const drawBox5 = (bodyColumns: number, maxRows: number, nav: Partial<DecideNav> = {}) => {
    const innerCols = Math.max(20, bodyColumns - 4)
    const boxRows = Math.max(4, Math.min(maxRows - 1, 28))
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
      v74: { pm: null, pmFetchedMs: null, decide: FIVE_CARDS, todo: null, nav: { cursor: nav.cursor ?? 0, picks: {}, notes: {}, noteMode: false } },
    }
    const rows = frameRows(decidePage, ctx as never, { topAnchor: true, pages: PAGES })
    return { rows: rows.map(rowText), boxRows }
  }

  // 160x45 (bodyColumns=155, maxRows=22) and 120x40 (bodyColumns=115, maxRows=20), plus real tmux heights (16, 14):
  // dual-column with >=3 cards in the left list and card detail on the right.
  for (const [bodyCols, maxRows] of [[155, 22], [115, 20], [155, 16], [115, 14]] as const) {
    const res = drawBox5(bodyCols, maxRows)
    const joined = res.rows.join('\n')
    expect(res.boxRows + 1, `${bodyCols}x${maxRows} fits maxRows`).toBeLessThanOrEqual(maxRows)
    expect(joined, `${bodyCols}x${maxRows} dual header`).toContain('卡 #01 / 5')
    expect(joined, `${bodyCols}x${maxRows} not single-card`).not.toContain('第 1 張，共 5 張')
    const splitRows = res.rows.filter(r => r.includes(' │ '))
    const leftCardRows = splitRows.map(r => r.split(' │ ')[0]).filter(l => /\b0[1-5]\s/.test(l))
    expect(leftCardRows.length, `${bodyCols}x${maxRows} left column has >=3 cards`).toBeGreaterThanOrEqual(3)
    const rightJoined = splitRows.map(r => r.split(' │ ').slice(1).join(' │ ')).join('\n')
    expect(rightJoined.replace(/\s+/g, ''), `${bodyCols}x${maxRows} right column shows question`).toContain('是否要將shared-tui分支合併進develop？')
    expect(rightJoined, `${bodyCols}x${maxRows} right column shows option`).toContain('立刻合併')
  }

  // Wide but short (maxRows < 10): collapses to single-column 1-row-per-card list, not single-card detail.
  for (const bodyCols of [155, 115] as const) {
    const compact = drawBox5(bodyCols, 9, { compactExpanded: false })
    const joined = compact.rows.join('\n')
    expect(joined, `${bodyCols}x9 compact list shows cards`).toContain('01 合併 shared-tui')
    expect(joined, `${bodyCols}x9 compact list shows 3+ cards`).toContain('03 預覽先拍幾欄')
    expect(joined, `${bodyCols}x9 not dual column`).not.toContain(' │ ')
    expect(joined, `${bodyCols}x9 not single-card detail`).not.toContain('第 1 張，共 5 張')
  }

  // 80x24 (bodyColumns=75, maxRows=12): single column showing one card's question and option rows.
  const at75 = drawBox5(75, 12)
  const joined75 = at75.rows.join('\n')
  expect(at75.boxRows + 1).toBeLessThanOrEqual(12)
  expect(joined75).not.toContain('卡 #01 / 5')
  expect(joined75).not.toContain(' │ ')
  expect(joined75).toContain('是否要將 shared-tui 分支合併進 develop？')
  expect(joined75).toContain('立刻合併')
  expect(joined75).toContain('暫緩一天')

  // Tight 80x24 expanded card (maxRows=6 and maxRows=5): still fits question + options inside maxRows.
  for (const maxRows of [6, 5] as const) {
    const tight = drawBox5(75, maxRows, { compactExpanded: true })
    const joined = tight.rows.join('\n')
    expect(tight.boxRows + 1, `75x${maxRows} fits maxRows`).toBeLessThanOrEqual(maxRows)
    expect(joined, `75x${maxRows} shows question`).toContain('合併 shared-tui')
    expect(joined, `75x${maxRows} shows option a`).toContain('立刻合併')
    expect(joined, `75x${maxRows} shows option b`).toContain('暫緩一天')
  }
})

test('80x24 mounted AbovePrompt opens Decide page via digit hotkey 2 at maxRows=6 and maxRows=12', async ($, on: On) => {
  const HOME = '/fake/onerow-80-home'
  const LIVE = '/fake/onerow-80-live'
  const REPO = '/work/onerow-80-repo'
  const SID = 'onerow-80-sid'
  const KEY = '0000000000000098'
  const PUBLISHED = '2026-10-04T10:00:00.000Z'
  const files: Record<string, string> = {
    [HOME + '/.autopilot/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: HOME + '/.autopilot' }),
    [HOME + '/.autopilot/session-mode/' + SID + '.json']: JSON.stringify({ session_id: SID, project_key: KEY, expires_at: '2026-10-05T10:00:00.000Z' }),
    [LIVE + '/runs/' + KEY + '.json']: JSON.stringify({ schema: 'autopilot.runs-live/1', scope: { project_key: KEY, root_run_id: null }, published_at: PUBLISHED, valid_for_s: 180, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 } }),
    [REPO + '/.git/HEAD']: 'ref: refs/heads/main\n',
  }
  const decideJson = JSON.stringify({
    cards: CARDS.map(c => ({
      card: {
        card_id: c.id,
        kind: c.title,
        question: c.question,
        background: c.background,
        options: c.options.map(o => ({ label: o.label, description: o.detail })),
        recommendation: c.options.find(o => o.recommended)?.label ?? null,
      },
    })),
  })
  const clock = mock.clock(on, { now: Date.parse(PUBLISHED) + 120_000 })
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
  on('process.run', (_, e) => {
    const argv = (e as { argv?: readonly string[] }).argv ?? []
    if (argv[0] === 'fleet' && argv[1] === 'decision') {
      return { value: { exitCode: 0, stdout: decideJson, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

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

  // Starts collapsed at 80x24 (maxRows=6): digit hotkey 2 is bound on OneRowBand and opens Decide page inside 6 rows.
  const b6 = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 6, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const closedTree = await b6.drawn() as Node
  expect(countRows(closedTree)).toBe(1)
  const hk2 = walk(closedTree).find(n => n.type === 'Button' && n.props?.hotkey === '2')
  expect(hk2?.props?.key).toBe('band-hotkey:2')
  await b6.press({ key: 'band-hotkey:2' })
  await clock.advance(0)
  await b6.unmount()

  const b6Open = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 6, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const open6 = await b6Open.drawn() as Node
  expect(countRows(open6)).toBeLessThanOrEqual(6)
  expect(countRows(open6)).toBeGreaterThanOrEqual(5)
  const text6 = text(open6)
  expect(text6).toContain('╭')
  expect(text6).toContain('待決')
  await b6Open.unmount()

  // At 80x24 with maxRows=12: Decide page stays open and shows card question and options.
  const b12 = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const open12 = await b12.drawn() as Node
  expect(countRows(open12)).toBeLessThanOrEqual(12)
  const text12 = text(open12)
  expect(text12).toContain('是否要將 shared-tui 分支合併進 develop？')
  expect(text12).toContain('立刻合併')
  expect(text12).toContain('暫緩一天')
  await b12.unmount()

  await $.session.end({ reason: 'exit' })
})

test('R3 codex Critical: single-card mode (v) shrinks pane height to content with zero blank filler rows below background', () => {
  const mk = (type: string) => (props: any) => ({ type, props, children: props.children })
  const el = { Box: mk('Box'), Text: mk('Text'), Link: mk('Link'), Button: mk('Button'), Input: mk('Input') }
  const tree = Pane(
    el,
    null,
    'decide',
    () => {},
    t,
    195,
    () => {},
    new Set(),
    () => {},
    new Set(),
    null,
    null,
    null,
    null,
    null,
    {
      pages: PAGES,
      pageId: 'decide',
      console: null,
      nowMs: NOW,
      rows: 18,
      maxRows: 19,
      bodyColumns: 195,
      v74Box: true,
      decide: { ...NO_NAV, style: 'C' },
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
    },
  )
  const rowBoxes = walk(tree).filter(n => n.type === 'Box' && typeof n.props?.key === 'string' && /^v74-row\d+$/.test(n.props.key))
  const innerLines = rowBoxes.map(b => text(b).replace(/^│ /, '').replace(/ │$/, '').trim())
  // Shrunk well below fixed 16 inner rows (rows: 18 - 2 borders)
  expect(rowBoxes.length).toBeLessThan(16)
  // At most 1 single blank separator line between options — never a multi-row blank filler block
  let consecutiveBlanks = 0
  let maxBlankRun = 0
  for (const line of innerLines) {
    if (line === '') {
      consecutiveBlanks += 1
      if (consecutiveBlanks > maxBlankRun) maxBlankRun = consecutiveBlanks
    } else {
      consecutiveBlanks = 0
    }
  }
  expect(maxBlankRun).toBeLessThanOrEqual(1)
  // Options sit directly after the background line (zero filler rows between them)
  const bgIdx = innerLines.findIndex(l => l.includes('背景'))
  const optAIdx = innerLines.findIndex(l => l.includes('立刻合併'))
  expect(bgIdx).toBeGreaterThan(-1)
  expect(optAIdx).toBe(bgIdx + 1)
  expect(innerLines.join('\n')).toContain('暫緩一天')
})

test('R3 Major3 & Carbon M1/M3: bottom border hints list w and v across widths, and 80x24 compact list shows visible key hints', () => {
  const tabItems = PAGES.filter(p => p.id !== 'pet').map(p => ({ key: p.key, id: p.id, text: p.key + ' ' + t('tab.' + p.id) }))
  const baseV74 = { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } }

  // Dual / normal Decide across 200 (195), 160 (155), 120 (115), 80 (75)
  for (const cols of [195, 155, 115, 75] as const) {
    const ctx = { live: null, console: null, size: { cols: cols - 4, rows: 14 }, bodyColumns: cols, maxRows: 14, t, nowMs: NOW, box: true as const, decide: { ...NO_NAV, style: 'D' as const }, v74: baseV74 }
    const fit = frameBottomFit(cols, frameHintText(decidePage, ctx as never), frameHintShort(decidePage, ctx as never), tabItems, 'decide', frameHintMin(decidePage, ctx as never))
    expect(fit.hint.length, `decide hint non-empty at ${cols}`).toBeGreaterThan(0)
    expect(fit.hint, `decide hint includes w at ${cols}`).toContain('w')
    expect(fit.hint, `decide hint includes v at ${cols}`).toContain('v')
    expect(fit.hint, `decide hint includes Esc at ${cols}`).toContain('Esc')
  }

  // Single-card Decide (v) across 200, 120, 80
  for (const cols of [195, 115, 75] as const) {
    const ctx = { live: null, console: null, size: { cols: cols - 4, rows: 14 }, bodyColumns: cols, maxRows: 14, t, nowMs: NOW, box: true as const, decide: { ...NO_NAV, style: 'C' as const }, v74: baseV74 }
    const fit = frameBottomFit(cols, frameHintText(decidePage, ctx as never), frameHintShort(decidePage, ctx as never), tabItems, 'decide', frameHintMin(decidePage, ctx as never))
    expect(fit.hint, `decide_c hint includes w at ${cols}`).toContain('w')
    expect(fit.hint, `decide_c hint includes v at ${cols}`).toContain('v')
  }

  // 80x24 compact list (maxRows=6, bodyColumns=75): non-empty key hint (never blank ╰─    ───)
  const compactCtx = { live: null, console: null, size: { cols: 71, rows: 6 }, bodyColumns: 75, maxRows: 6, t, nowMs: NOW, box: true as const, decide: { ...NO_NAV, style: 'D' as const, compactExpanded: false }, v74: baseV74 }
  const compactFit = frameBottomFit(75, frameHintText(decidePage, compactCtx as never), frameHintShort(decidePage, compactCtx as never), tabItems, 'decide', frameHintMin(decidePage, compactCtx as never))
  expect(compactFit.hint.length).toBeGreaterThan(0)
  expect(compactFit.hint).toContain('Enter')
  expect(compactFit.hint).toContain('w')
  expect(compactFit.hint).toContain('Esc')

  // Non-decide pages (e.g. now) also list w across widths
  const nowPage = PAGES[0]
  for (const cols of [195, 115, 75] as const) {
    const ctx = { live: null, console: null, size: { cols: cols - 4, rows: 14 }, bodyColumns: cols, maxRows: 14, t, nowMs: NOW, box: true as const, v74: baseV74 }
    const fit = frameBottomFit(cols, frameHintText(nowPage, ctx as never), frameHintShort(nowPage, ctx as never), tabItems, 'now', frameHintMin(nowPage, ctx as never))
    expect(fit.hint, `now hint includes w at ${cols}`).toContain('w')
  }
})

test('R3 Carbon M3: 120-col dual-column right detail orders 背景 before 選項 (matching C) and aligns scrollbar █ with zero 1-cell shift on option rows', () => {
  const longCards: DecideCard[] = [
    {
      id: 'd-scroll-1',
      title: '合併 shared-tui',
      question: '是否立即合併進 develop？',
      background: '已完成三輪審查，等待最後核准。',
      options: [
        { label: '立刻合併', detail: '採用 --no-ff 合併並保留完整提交歷史紀錄', recommended: true },
        { label: '暫緩一天', detail: '先觀察夜間自動測試結果再做決定', recommended: false },
        { label: '退回重修', detail: '補齊更多實機截圖證據後再送審', recommended: false },
      ],
    },
    CARDS[1],
  ]
  const dualCtx = {
    live: null,
    console: null,
    size: { cols: 111, rows: 14 },
    bodyColumns: 115,
    maxRows: 14,
    t,
    nowMs: NOW,
    box: true as const,
    pendingScroll: { list: newScroll(), detail: newScroll(), cursor: '' },
    decide: { ...NO_NAV, style: 'D' as const },
    v74: { pm: null, pmFetchedMs: null, decide: longCards, todo: null, nav: { cursor: 0, picks: {}, notes: {}, noteMode: false } },
  }
  const dualOut = decidePage.render(dualCtx as never)
  const rightLines = dualOut.body.map(r => rowText(r).split(' │ ').slice(1).join(' │ '))
  const bgIdxDual = rightLines.findIndex(l => l.includes('背景'))
  const optAIdxDual = rightLines.findIndex(l => l.includes('立刻合併'))
  expect(bgIdxDual).toBeGreaterThan(-1)
  expect(optAIdxDual).toBeGreaterThan(bgIdxDual)

  // Matches single-card C order (背景 before 選項)
  const singleOut = decidePage.render({ ...dualCtx, decide: { ...NO_NAV, style: 'C' as const }, size: { cols: 111, rows: 22 }, maxRows: 22 } as never)
  const singleLines = singleOut.body.map(rowText)
  expect(singleLines.findIndex(l => l.includes('背景'))).toBeLessThan(singleLines.findIndex(l => l.includes('立刻合併')))

  // Verify scrollbar alignment under host hotkey rendering (pane.tsx stripLead + host `x: ` prefix):
  // Previously `[a] ` (4 cells) was stripped and drawn as `a: ` (3 cells), shifting █ left by 1 cell.
  const hostRenderedWidth = (row: { text: string; press?: string }[]): number => {
    let total = 0
    const used = new Set<string>()
    for (let j = 0; j < row.length; j++) {
      const sg = row[j]
      if (sg.press !== undefined && sg.press.startsWith('key:')) {
        let e = j
        while (e + 1 < row.length && row[e + 1].press === sg.press) e++
        const run = row.slice(j, e + 1)
        const keyLetter = sg.press.slice(4)
        const letter = /^[a-z]$/.test(keyLetter) && !used.has(keyLetter) ? keyLetter : null
        if (letter !== null) used.add(letter)
        const stripLead = (x: string) => letter === null ? x : x.replace(new RegExp('^\\[' + letter + '\\] |^' + letter + ': |^' + letter + ' '), '')
        const drawn = run.map((x, n) => (n === 0 && letter !== null ? letter + ': ' + stripLead(x.text) : x.text)).join('')
        total += displayWidth(drawn)
        j = e
        continue
      }
      total += displayWidth(sg.text)
    }
    return total
  }
  const scrollRows = dualOut.body.filter(r => {
    const last = r[r.length - 1]?.text ?? ''
    return last === GLYPHS.scrollbar.thumb || last === GLYPHS.scrollbar.track
  })
  expect(scrollRows.some(r => r[r.length - 1]?.text === GLYPHS.scrollbar.thumb)).toBe(true)
  expect(scrollRows.some(r => r.some(s => s.press === 'key:a'))).toBe(true)
  for (const r of scrollRows) {
    expect(hostRenderedWidth(r), 'scrollbar row width aligned: ' + rowText(r)).toBe(111)
  }
})

test('R3 Major3 & Carbon M1/M3: 80x24 no-pane never shows ▴收合, toggle expands/collapses, and Esc releases focus to input', async ($, on: On) => {
  // Unit assertions for Esc returning focus to input box
  expect(v74KeysHeldNext(true, { kind: 'key', key: 'close' })).toBe(false)
  expect(v74KeysHeldNext(true, { kind: 'focus', named: undefined, origin: { kind: 'person' } })).toBe(false)
  expect(routeKey('Escape', { page: 'decide', paneFocus: true, focusedButton: false, textMode: false })).toEqual({ kind: 'close' })
  expect(routeKey('Escape', { page: 'decide', paneFocus: false, focusedButton: false, textMode: false })).toEqual({ kind: 'pass' })
  const fakeEngine = { ui: { invalidate: () => {}, close: async () => {} } } as any
  expect(await paneKey(fakeEngine, 'Escape')).toEqual({ kind: 'close' })

  const HOME = '/fake/onerow-r3-home'
  const LIVE = '/fake/onerow-r3-live'
  const REPO = '/work/onerow-r3-repo'
  const SID = 'onerow-r3-sid'
  const KEY = '0000000000000097'
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

  // 1. Collapsed initially: 1 row, shows ▾展開, never ▴收合
  const bCollapsed = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const tCollapsed = await bCollapsed.drawn() as Node
  expect(countRows(tCollapsed)).toBe(1)
  expect(text(tCollapsed)).toContain('▾展開')
  expect(text(tCollapsed)).not.toContain('▴收合')
  await bCollapsed.press({ key: 'pane-toggle' })
  await clock.advance(0)
  await bCollapsed.unmount()

  // 2. Expanded with room (maxRows=12): pane visible, band shows ▴收合
  const bExpanded = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const tExpanded = await bExpanded.drawn() as Node
  expect(countRows(tExpanded)).toBeGreaterThan(1)
  expect(text(tExpanded)).toContain('▴收合')
  expect(text(tExpanded)).not.toContain('▾展開')
  await bExpanded.unmount()

  // 3. Open state but viewport too short for pane (maxRows=4 -> height=3 < V74_FRAME_MIN=4):
  //    no pane drawn -> band MUST show ▾展開 and NEVER ▴收合 (Codex R3 Major3 / Carbon R3 M1)
  const bNoPane = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 4, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const tNoPane = await bNoPane.drawn() as Node
  expect(countRows(tNoPane)).toBe(1)
  expect(text(tNoPane)).toContain('▾展開')
  expect(text(tNoPane)).not.toContain('▴收合')
  await bNoPane.unmount()

  // 4. Press w hotkey on expanded pane to collapse back to 1 row
  const bCollapseKey = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  await bCollapseKey.press({ key: 'letter:w' })
  await clock.advance(0)
  await bCollapseKey.unmount()

  const bAfterCollapse = await $.ui.mount({ plugin: 'autopilot', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 75, maxRows: 12, view: { agentId: undefined } }, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  const tAfterCollapse = await bAfterCollapse.drawn() as Node
  expect(countRows(tAfterCollapse)).toBe(1)
  expect(text(tAfterCollapse)).toContain('▾展開')
  expect(text(tAfterCollapse)).not.toContain('▴收合')
  await bAfterCollapse.unmount()

  await $.session.end({ reason: 'exit' })
})
