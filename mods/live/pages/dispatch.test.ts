// pages/dispatch.test.ts — page 5 派工 (plan r2 §2 row 5, §3.1, §3.2, §5): golden rows against the 160x40, 120x30 and 80x24 mockups
// (expanded, collapsed fold pair, and empty state), fixed-height frameRows across every size and state, overflow hint, §5 stale/no-source wrapping,
// and G11 Button/hotkey coverage through Pane.
import { test, expect } from 'claude-code/testing'
import { PAGES } from './index'
import { frameRows, actionRows, staleBadge as frameBadge, brokenRow as frameBroken } from './frame'
import type { PageCtx } from './frame'
import { dispatchPage, dispatchView, DEFAULT_VIEW } from './dispatch'
import type { DispatchCtx, DispatchView } from './dispatch'
import { brokenRow, staleBadge } from './rows'
import { FOCUS_ANCHOR_KEY, Pane, pageHotkeys } from '../pane'
import { EN, ZH_TW } from '../locales'
import { makeT } from '../i18n'
import * as M from '../model'
import type { ForemanView, LivePaneRow, LiveSnapshot } from '../model'
import { PALETTE, displayWidth } from '../ui'
import { closeGap, consoleOf, POOLS } from './quota.fixture'
import type { ConsoleSnapshot } from '../console'

const t = makeT('zh-TW')
const NOW = 1794200000000
const MIN = 60_000
const HOUR = 3_600_000
const text = (row: { text: string }[]): string => row.map(s => s.text).join('').replace(/\s+$/, '')

// Calm console snapshot (all sources ok, 0 open cards, healthy pool) so an empty action area draws `沒有要你處理的事`
const CALM_CONSOLE = consoleOf(
  POOLS.filter(p => p.pool === 'codex'),
  {
    cards: [],
    decisions: 0,
    items: [],
    lines: [],
    sources: {
      tasks: { at_ms: NOW - 12_000, state: 'ok' },
      hosts: { at_ms: NOW - 12_000, state: 'ok' },
      cards: { at_ms: NOW - 12_000, state: 'ok' },
      quota_now: { at_ms: NOW - 40_000, state: 'ok' },
      quota_forecast: { at_ms: NOW - 40_000, state: 'ok' },
    },
  },
) as ConsoleSnapshot

const runRow = (over: Partial<LivePaneRow> & Pick<LivePaneRow, 'run_id'>): LivePaneRow => ({
  stall: false,
  role: 'hand',
  runner: 'sonnet',
  model: null,
  started_at: new Date(NOW - 23 * MIN).toISOString(),
  elapsed_s: 23 * 60,
  phase: 'running',
  rc: null,
  final_status: null,
  probe_age_s: 60,
  ended_at: null,
  ended: false,
  fresh: true,
  starting: false,
  ...over,
})

const WIDE_RUNS: LivePaneRow[] = [
  runRow({ run_id: 'console-source', role: 'hand', runner: 'sonnet', model: null, elapsed_s: 23 * 60, probe_age_s: 60 }),
  runRow({ run_id: 'plan-review astra g1', role: 'reviewer', runner: 'codex', model: 'astra', elapsed_s: 18 * 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 5 * HOUR).toISOString() }),
  runRow({ run_id: 'plan-review carbon g1', role: 'reviewer', runner: 'agy', model: 'carbon', elapsed_s: 21 * 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 5 * HOUR).toISOString() }),
  runRow({ run_id: 'inventory', role: 'explore', runner: 'sonnet', model: null, elapsed_s: 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 4 * MIN).toISOString() }),
]

const NARROW_RUNS: LivePaneRow[] = [
  runRow({ run_id: 'console-source', role: 'hand', runner: 'sonnet', model: null, elapsed_s: 23 * 60, probe_age_s: 60 }),
  runRow({ run_id: 'astra g1', role: 'reviewer', runner: 'codex', model: 'astra', elapsed_s: 18 * 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 5 * HOUR).toISOString() }),
  runRow({ run_id: 'carbon g1', role: 'reviewer', runner: 'agy', model: 'carbon', elapsed_s: 21 * 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 5 * HOUR).toISOString() }),
  runRow({ run_id: 'inventory', role: 'explore', runner: 'sonnet', model: null, elapsed_s: 60, probe_age_s: null, ended: true, fresh: false, rc: 0, final_status: 'completed', ended_at: new Date(NOW - 4 * MIN).toISOString() }),
]

const liveOf = (rows: LivePaneRow[] | null, over: Partial<LiveSnapshot> = {}, foreman: ForemanView | null = null): LiveSnapshot => ({
  state: 'ok',
  text: '',
  header: '工作階段 s1 · 本機 $1.20 · ctx 35%',
  band: null,
  pending: [],
  project_key: 'plan/shared-tui',
  root_run_id: null,
  link: null,
  rows,
  gates: null,
  sections: { ...M.NO_SECTIONS, foreman },
  review: null,
  published_at: null,
  watcher_note: null,
  session_as_of: null,
  host_as_of: null,
  detail: { ...M.NO_DETAIL, now_ms: NOW, project: 'plan/shared-tui' },
  ...over,
})

const ctxOf = (cols: number, rows: number, live: LiveSnapshot | null, console: ConsoleSnapshot | null = CALM_CONSOLE, loc: 'zh-TW' | 'en' = 'zh-TW'): PageCtx => ({
  live,
  console,
  size: { cols, rows },
  t: makeT(loc),
  nowMs: NOW,
})

const withView = (ctx: PageCtx, view?: DispatchView): DispatchCtx => (view === undefined ? ctx : { ...ctx, dispatch: view })

const drawn = (cols: number, rows: number, live: LiveSnapshot | null, view?: DispatchView, console: ConsoleSnapshot | null = CALM_CONSOLE): string[] => {
  const ctx = withView(ctxOf(cols, rows, live, console), view)
  const out = frameRows(dispatchPage, ctx, { pages: PAGES })
  expect(out.length, `${cols}x${rows} fixed height`).toBe(rows)
  expect(text(out[out.length - 1]), `${cols}x${rows} strip last`).toMatch(/1\D*2\D*3\D*4\D*5/)
  const acts = Math.max(1, dispatchPage.render(ctx).actions.length)
  return closeGap(out.slice(0, -1).map(text), acts)
}

const GOLDEN_WIDE = [
  '派工',
  '── 執行中 1 ──────────────────────────────────────────────',
  '  run                         角色        引擎             經過     上次',
  '▸ ● console-source            hand        sonnet           23 分    1 分前',
  '── foreman ──',
  '  ○ 無',
  '── 已完成 3（z 收合）───────────────────────────────',
  '  ✓ plan-review astra g1      reviewer    codex/astra      18 分    5 時前',
  '  ✓ plan-review carbon g1     reviewer    agy/carbon       21 分    5 時前',
  '  ✓ inventory                 explore     sonnet           1 分     4 分前',
  '[z] 收合已完成',
]

const GOLDEN_80_EXPANDED = [
  '派工',
  '── 執行中 1 ──',
  '▸● console-source hand sonnet 23分',
  '── 已完成 3（z 收合）──',
  ' ✓ astra g1 reviewer 18分 5時前',
  ' ✓ carbon g1 reviewer 21分 5時前',
  ' ✓ inventory explore 1分 4分前',
  '[z] 收合已完成',
]

const GOLDEN_80_FOLDED = [
  '派工',
  '── 執行中 1 ──',
  '▸● console-source hand sonnet 23分',
  '── 已完成 3（z 展開）──',
  '[z] 展開已完成',
]

const GOLDEN_EMPTY = [
  '派工',
  '○ 沒有執行中的派工，也沒有最近完成的',
  '沒有要你處理的事',
]

test('dispatch registry: page 5 in PAGES is framed dispatchPage', () => {
  expect(PAGES[4]).toBe(dispatchPage)
  expect(dispatchPage.id).toBe('dispatch')
  expect(dispatchPage.key).toBe('5')
  expect(dispatchPage.title).toBe('派工')
  expect(dispatchPage.framed).toBe(true)
})

test('dispatch golden: 160x40 and 120x30 match the wide mockups with fixed height 40 and 30', () => {
  const live = liveOf(WIDE_RUNS)
  expect(drawn(160, 40, live)).toEqual(GOLDEN_WIDE)
  expect(drawn(120, 30, live)).toEqual(GOLDEN_WIDE)

  // Folded state on wide widths flips the rule hint and action Button together
  const foldedWide = drawn(160, 40, live, { focus: 0, expanded: false })
  expect(foldedWide).toEqual([
    '派工',
    '── 執行中 1 ──────────────────────────────────────────────',
    '  run                         角色        引擎             經過     上次',
    '▸ ● console-source            hand        sonnet           23 分    1 分前',
    '── foreman ──',
    '  ○ 無',
    '── 已完成 3（z 展開）───────────────────────────────',
    '[z] 展開已完成',
  ])
})

test('dispatch golden: 80x24 fold pair (expanded & collapsed) and empty state match the mockups', () => {
  const live = liveOf(NARROW_RUNS)
  expect(drawn(80, 24, live)).toEqual(GOLDEN_80_EXPANDED)
  expect(drawn(80, 24, live, { focus: 0, expanded: true })).toEqual(GOLDEN_80_EXPANDED)
  expect(drawn(80, 24, live, { focus: 0, expanded: false })).toEqual(GOLDEN_80_FOLDED)

  const empty = liveOf([])
  expect(drawn(80, 24, empty)).toEqual(GOLDEN_EMPTY)
  expect(drawn(120, 30, empty)).toEqual(GOLDEN_EMPTY)
  expect(drawn(160, 40, empty)).toEqual(GOLDEN_EMPTY)
})

test('dispatch negative control: golden comparator catches a single-character drift', () => {
  const got = drawn(80, 24, liveOf(NARROW_RUNS))
  const mutated = GOLDEN_80_EXPANDED.slice()
  mutated[2] = '▸● console-source hand sonnet 24分'
  expect(got).not.toEqual(mutated)
})

test('dispatch: fixed height H, actions <= A, row width <= cols, strip last across 160x40, 120x30, 80x24 and shortBody, plus overflow row', () => {
  const activeForeman: ForemanView = {
    binding: 'session',
    agents: [
      { id: 'fm-1', description: 'b2-foreman', label: 'foreman', at_ms: NOW - 2 * MIN, age_s: 120, stale: false, stamped: true, ended: false },
      { id: 'fm-2', description: 'stalled-foreman', label: 'foreman', at_ms: NOW - 12 * MIN, age_s: 720, stale: true, stamped: true, ended: false },
    ],
    stage: 'implement',
    stage_source: 'marker',
    stage_at_ms: NOW - 5 * MIN,
    stage_age_s: 300,
  }
  const manyFinished = [
    WIDE_RUNS[0],
    ...Array.from({ length: 30 }, (_, i) =>
      runRow({
        run_id: `batch-worker-${String(i).padStart(2, '0')}-with-extra-long-identifier`,
        role: 'implementer',
        runner: 'codex',
        model: 'astra',
        elapsed_s: (i + 1) * 60,
        probe_age_s: null,
        ended: true,
        fresh: false,
        rc: i % 5 === 0 ? 1 : 0,
        final_status: i % 5 === 0 ? 'failed' : 'completed',
        ended_at: new Date(NOW - (i + 1) * MIN).toISOString(),
      }),
    ),
  ]
  const agedOut = [
    runRow({
      run_id: 'old-finished-run',
      role: 'reviewer',
      runner: 'codex',
      model: 'astra',
      elapsed_s: 300,
      probe_age_s: null,
      ended: true,
      fresh: false,
      rc: 0,
      final_status: 'completed',
      ended_at: new Date(NOW - 7 * HOUR).toISOString(),
    }),
  ]

  const states: [string, LiveSnapshot | null, DispatchView | undefined, ConsoleSnapshot | null][] = [
    ['wide default', liveOf(WIDE_RUNS), undefined, CALM_CONSOLE],
    ['folded', liveOf(WIDE_RUNS), { focus: 0, expanded: false }, CALM_CONSOLE],
    ['focus row 2', liveOf(WIDE_RUNS), { focus: 2, expanded: true }, CALM_CONSOLE],
    ['focus past end', liveOf(WIDE_RUNS), { focus: 99, expanded: true }, CALM_CONSOLE],
    ['empty', liveOf([]), undefined, CALM_CONSOLE],
    ['aged-out >6h becomes empty', liveOf(agedOut), undefined, CALM_CONSOLE],
    ['only running', liveOf([WIDE_RUNS[0]]), undefined, CALM_CONSOLE],
    ['only finished', liveOf(WIDE_RUNS.slice(1)), undefined, CALM_CONSOLE],
    ['only finished folded', liveOf(WIDE_RUNS.slice(1)), { focus: 0, expanded: false }, CALM_CONSOLE],
    ['active foreman', liveOf([WIDE_RUNS[0]], {}, activeForeman), undefined, CALM_CONSOLE],
    ['active foreman + finished folded', liveOf(WIDE_RUNS, {}, activeForeman), { focus: 0, expanded: false }, CALM_CONSOLE],
    ['foreman only', liveOf([], {}, activeForeman), undefined, CALM_CONSOLE],
    ['30 finished overflow', liveOf(manyFinished), undefined, CALM_CONSOLE],
    ['null live', null, undefined, null],
    ['null rows', liveOf(null), undefined, CALM_CONSOLE],
    ['stale with rows', liveOf(WIDE_RUNS, { state: 'stale', header: '資料過舊 · watcher 沒有在發佈' }), undefined, CALM_CONSOLE],
    ['stale without rows', liveOf(null, { state: 'stale', header: '資料過舊 · watcher 沒有在發佈' }), undefined, CALM_CONSOLE],
  ]

  const bad: string[] = []
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24], [80, 7]] as const) {
    for (const loc of ['zh-TW', 'en'] as const) {
      for (const [name, live, view, con] of states) {
        const ctx = withView(ctxOf(cols, rows, live, con, loc), view)
        const out = frameRows(dispatchPage, ctx, { pages: PAGES })
        if (out.length !== rows) bad.push(`${loc}:${name}@${cols}x${rows}=${out.length}`)
        if (dispatchPage.render(ctx).actions.length > actionRows(rows)) bad.push(`${loc}:${name}@${cols}x${rows}:actions`)
        for (const r of out) {
          if (displayWidth(r.map(s => s.text).join('')) > cols) bad.push(`${loc}:${name}@${cols}x${rows}:width`)
        }
        if (!/1\D*2\D*3\D*4\D*5/.test(text(out[out.length - 1]))) bad.push(`${loc}:${name}@${cols}x${rows}:strip`)
      }
    }
  }
  expect(bad).toEqual([])

  // Aged-out (> 6h) finished run is excluded so the page renders the empty state
  expect(drawn(80, 24, liveOf(agedOut))).toEqual(GOLDEN_EMPTY)

  // Overflow at 80x24 and 120x30 ends the body area with `↓ 還有 N 列` directly above `[z] 收合已完成`
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const over = frameRows(dispatchPage, ctxOf(cols, rows, liveOf(manyFinished)), { pages: PAGES }).map(text)
    expect(over.length).toBe(rows)
    expect(over[rows - 3]).toMatch(/^↓ 還有 \d+ 列$/)
    expect(over[rows - 2]).toBe('[z] 收合已完成')
  }
})

test('dispatch [short-body-foreman-loss]: shortBody appends active foreman rows even when run rows are rendered and lets frameRows handle overflow', () => {
  const activeForeman: ForemanView = {
    binding: 'session',
    agents: [
      { id: 'fm-1', description: 'b2-foreman', label: 'foreman', at_ms: NOW - 2 * MIN, age_s: 120, stale: false, stamped: true, ended: false },
      { id: 'fm-2', description: 'stalled-foreman', label: 'foreman', at_ms: NOW - 12 * MIN, age_s: 720, stale: true, stamped: true, ended: false },
    ],
    stage: 'implement',
    stage_source: 'marker',
    stage_at_ms: NOW - 5 * MIN,
    stage_age_s: 300,
  }

  const oneRunWithForeman = liveOf([NARROW_RUNS[0]], {}, activeForeman)
  const shortNarrow = dispatchPage.render({ ...ctxOf(80, 7, oneRunWithForeman), shortBody: true })
  expect(shortNarrow.actions).toEqual([])
  expect(shortNarrow.body.map(text)).toEqual([
    '▸● console-source hand sonnet 23分',
    ' ● b2-foreman 2分前',
    ' ⊘ stalled-foreman 12分前',
    ' 階段 implement · 5分前',
  ])

  // Real dispatchPage render path through frameRows at 80x7 and 120x7 (auto shortBody when room <= 4)
  const framed80x7 = frameRows(dispatchPage, ctxOf(80, 7, oneRunWithForeman), { pages: PAGES }).map(text)
  expect(framed80x7.length).toBe(7)
  expect(framed80x7.slice(1, 5)).toEqual([
    '▸● console-source hand sonnet 23分',
    ' ● b2-foreman 2分前',
    ' ⊘ stalled-foreman 12分前',
    ' 階段 implement · 5分前',
  ])
  expect(framed80x7[5]).toBe('沒有要你處理的事')

  const framed120x7 = frameRows(dispatchPage, ctxOf(120, 7, oneRunWithForeman), { pages: PAGES }).map(text)
  expect(framed120x7.length).toBe(7)
  expect(framed120x7.slice(1, 5)).toEqual([
    '▸ ● console-source            hand        sonnet           23 分    1 分前',
    '  ● b2-foreman · foreman · 2 分前',
    '  ⊘ stalled-foreman · foreman · 12 分前 · 久未動',
    '  階段 implement · 5 分前',
  ])

  // When running + foreman rows exceed shortBody room, foreman rows stay appended in body so frameRows owns overflow/scroll
  const threeRunning = [
    runRow({ run_id: 'run-alpha', role: 'hand', runner: 'sonnet', elapsed_s: 5 * 60, probe_age_s: 30 }),
    runRow({ run_id: 'run-beta', role: 'reviewer', runner: 'codex', model: 'astra', elapsed_s: 10 * 60, probe_age_s: 30 }),
    runRow({ run_id: 'run-gamma', role: 'implementer', runner: 'agy', model: 'carbon', elapsed_s: 15 * 60, probe_age_s: 30 }),
  ]
  const manyWithForeman = liveOf(threeRunning, {}, activeForeman)
  const shortOverflow = dispatchPage.render({ ...ctxOf(80, 7, manyWithForeman), shortBody: true })
  expect(shortOverflow.body.length).toBe(6)
  expect(shortOverflow.body.slice(3).map(text)).toEqual([
    ' ● b2-foreman 2分前',
    ' ⊘ stalled-foreman 12分前',
    ' 階段 implement · 5分前',
  ])
  const scrolled80x7 = frameRows(dispatchPage, ctxOf(80, 7, manyWithForeman), { pages: PAGES, scroll: 2 }).map(text)
  expect(scrolled80x7.length).toBe(7)
  expect(scrolled80x7.slice(1, 5)).toEqual([
    ' ● run-gamma implementer agy/carbon 15分',
    ' ● b2-foreman 2分前',
    ' ⊘ stalled-foreman 12分前',
    ' 階段 implement · 5分前',
  ])
})

test('dispatch [short-body-false-empty]: shortBody renders recent finished runs when expanded=false instead of a false empty state', () => {
  const onlyFinished = liveOf(NARROW_RUNS.slice(1))

  const direct = dispatchView({ ...ctxOf(80, 7, onlyFinished), shortBody: true }, { focus: 1, expanded: false })
  expect(direct.actions).toEqual([])
  expect(direct.body.map(text)).toEqual([
    ' ✓ astra g1 reviewer 18分 5時前',
    '▸✓ carbon g1 reviewer 21分 5時前',
    ' ✓ inventory explore 1分 4分前',
  ])

  const framed80x7 = frameRows(
    dispatchPage,
    withView(ctxOf(80, 7, onlyFinished), { focus: 0, expanded: false }),
    { pages: PAGES },
  ).map(text)
  expect(framed80x7.length).toBe(7)
  expect(framed80x7.some(l => l.includes('沒有執行中的派工，也沒有最近完成的'))).toBe(false)
  expect(framed80x7.slice(2, 5)).toEqual([
    '▸✓ astra g1 reviewer 18分 5時前',
    ' ✓ carbon g1 reviewer 21分 5時前',
    ' ✓ inventory explore 1分 4分前',
  ])
  expect(framed80x7[5]).toBe('沒有要你處理的事')

  const framed120x7 = frameRows(
    dispatchPage,
    withView(ctxOf(120, 7, liveOf(WIDE_RUNS.slice(1))), { focus: 0, expanded: false }),
    { pages: PAGES },
  ).map(text)
  expect(framed120x7.length).toBe(7)
  expect(framed120x7.slice(2, 5)).toEqual([
    '▸ ✓ plan-review astra g1      reviewer    codex/astra      18 分    5 時前',
    '  ✓ plan-review carbon g1     reviewer    agy/carbon       21 分    5 時前',
    '  ✓ inventory                 explore     sonnet           1 分     4 分前',
  ])

  // Running + finished with expanded=false in shortBody also includes finished rows since fold controls are suppressed
  const mixed = frameRows(
    dispatchPage,
    withView(ctxOf(80, 7, liveOf(NARROW_RUNS)), { focus: 0, expanded: false }),
    { pages: PAGES },
  ).map(text)
  expect(mixed.length).toBe(7)
  expect(mixed.slice(1, 5)).toEqual([
    '▸● console-source hand sonnet 23分',
    ' ✓ astra g1 reviewer 18分 5時前',
    ' ✓ carbon g1 reviewer 21分 5時前',
    ' ✓ inventory explore 1分 4分前',
  ])
})

test('dispatch §5: null live, null rows, and stale live draw red PALETTE.broken rows that wrap without ellipsis truncation', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))

  const noLive = dispatchPage.render(ctxOf(80, 24, null, null))
  expect(noLive.actions).toEqual([])
  expect(text(noLive.body[0])).toBe('✗ 派工：無來源（本席沒有 live 資料）')
  expect(noLive.body[0][0].color).toBe(PALETTE.broken)

  const noRuns = dispatchPage.render(ctxOf(80, 24, liveOf(null)))
  expect(noRuns.actions).toEqual([])
  expect(text(noRuns.body[0])).toBe('✗ 派工：無來源（沒有派工資料）')
  expect(noRuns.body[0][0].color).toBe(PALETTE.broken)

  const longWhy = '資料過舊 · 上次發佈 2026-11-18T03:00:00Z · watcher 已停止發佈且工作目錄之後有新的派工紀錄變化需要重新啟動'
  const staleSnap = liveOf(NARROW_RUNS, { state: 'stale', header: longWhy })
  const stale70 = dispatchPage.render(ctxOf(70, 24, staleSnap))
  const brokenBanner = stale70.body.filter(r => r.length === 1 && r[0].color === PALETTE.broken)
  expect(brokenBanner.length, 'long stale reason wraps onto multiple rows at 70 cols').toBeGreaterThanOrEqual(2)
  for (const r of brokenBanner) expect(displayWidth(text(r))).toBeLessThanOrEqual(70)
  const joinedReason = brokenBanner.map(text).join(' ')
  expect(joinedReason).toBe('✗ 本席派工資料不是最新：' + longWhy)
  expect(joinedReason.includes('…'), 'stale reason is wrapped, never cut with ellipsis').toBe(false)

  // Cached run ages/durations under a stale snapshot carry ✗ in PALETTE.broken
  const runRows70 = stale70.body.filter(r => /^[▸ ][●✓]/.test(text(r)))
  expect(runRows70.length).toBe(4)
  for (const r of runRows70) {
    expect(r.some(s => s.color === PALETTE.broken && s.text.includes('✗')), `stale marker on ${text(r)}`).toBe(true)
  }
})

test('dispatch G11 & Pane integration: [z] action is a clickable Button bound to z with non-empty label, no empty-label Buttons, and locale hints match pageHotkeys', () => {
  type Node = { kind: string; props: Record<string, any> }
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
  const walk = (n: any, out: Node[] = []): Node[] => {
    if (!n || typeof n !== 'object') return out
    if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
    if (n.kind !== undefined) out.push(n)
    walk(n.props?.children, out)
    return out
  }
  const flat = (n: any): string => {
    const c = n?.props?.children
    return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : ''
  }

  // Every [x] hint in EN and ZH_TW page.dispatch.* is in pageHotkeys('dispatch')
  const bound = pageHotkeys('dispatch')
  const badHints: string[] = []
  for (const [loc, table] of [['en', EN], ['zh-TW', ZH_TW]] as const) {
    for (const [id, val] of Object.entries(table)) {
      if (!id.startsWith('page.dispatch.')) continue
      for (const m of val.matchAll(/\[([^\]\s]+)\]/g)) {
        if (!bound.includes(m[1])) badHints.push(`${loc}:${id}:[${m[1]}]`)
      }
    }
  }
  expect(badHints).toEqual([])

  // Render through Pane at 80x24 and 160x40: z Button is mounted, non-empty, and triggers fold onKey
  for (const [cols, rows, live] of [[80, 24, liveOf(NARROW_RUNS)], [160, 40, liveOf(WIDE_RUNS)]] as const) {
    const keys: unknown[] = []
    const tree = walk(
      Pane(
        EL as never,
        live,
        'dispatch',
        () => {},
        t,
        cols,
        () => {},
        new Set(),
        () => {},
        new Set(),
        null,
        null,
        null,
        null,
        null,
        { pages: PAGES, pageId: 'dispatch', console: CALM_CONSOLE, nowMs: NOW, rows, view: { dispatch: DEFAULT_VIEW }, onKey: k => keys.push(k) },
      ),
    )
    expect(tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flat(n).trim() === '')).toEqual([])
    const zBtn = tree.find(n => n.kind === 'Button' && n.props.hotkey === 'z')
    expect(zBtn, `z Button at ${cols}x${rows}`).toBeDefined()
    expect(flat(zBtn).trim()).toBe('收合已完成')
    zBtn!.props.onPress()
    expect(keys).toEqual([{ kind: 'fold' }])

    const iBtn = tree.find(n => n.kind === 'Button' && n.props.hotkey === 'i')
    expect(iBtn).toBeDefined()
    expect(flat(iBtn).trim()).toBe('說明')
    const digits = tree.filter(n => n.kind === 'Button' && /^[0-9]$/.test(n.props.hotkey ?? '')).map(n => n.props.hotkey)
    expect(digits).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
  }

  // DispatchCtx override on dispatchPage.render directly supports folded state & custom focus
  const foldedDirect = dispatchPage.render({ ...ctxOf(80, 24, liveOf(NARROW_RUNS)), dispatch: { focus: 0, expanded: false } } as never)
  expect(foldedDirect.actions.map(text)).toEqual(['[z] 展開已完成'])
})
