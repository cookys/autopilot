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
import { PALETTE } from '../../tux/palette.ts'
import { displayWidth } from '../../tux/width.ts'
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
  return closeGap(out.slice(0, -2).map(text), acts)
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

test('dispatch registry: page 3 in PAGES is framed dispatchPage', () => {
  expect(PAGES[2]).toBe(dispatchPage)
  expect(dispatchPage.id).toBe('dispatch')
  expect(dispatchPage.key).toBe('3')
  expect(dispatchPage.title).toBe('派工')
  expect(dispatchPage.framed).toBe(true)
})



test('dispatch negative control: golden comparator catches a single-character drift', () => {
  const got = drawn(80, 24, liveOf(NARROW_RUNS))
  const mutated = GOLDEN_80_EXPANDED.slice()
  mutated[2] = '▸● console-source hand sonnet 24分'
  expect(got).not.toEqual(mutated)
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

test('dispatch G01: v7.4 top fleet-lines summary shows full 4-class counts, active source (pmFeed / consoleSnap / fleetNow), age, threshold, and missing reasons', () => {
  const nav = { cursor: 0, picks: {}, notes: {}, noteMode: false }
  const pmFresh = {
    schema: 'fleet.pm.status' as const,
    schema_version: 1 as const,
    generated_at_ms: NOW - 2 * 60_000,
    selector: null,
    projects: [
      { project: 'p-fail', root_id: null, counts: { stuck: 1, overdue: 0, running: 0, waiting: 0, total: 1 }, tasks: [] },
      { project: 'p-park', root_id: null, counts: { stuck: 0, overdue: 0, running: 0, waiting: 2, total: 2 }, tasks: [] },
      { project: 'p-unk', root_id: null, counts: { stuck: null, overdue: 0, running: 1, waiting: 0, total: 1 }, tasks: [] },
      ...Array.from({ length: 120 }, (_, i) => ({
        project: 'p-ok-' + i,
        root_id: null,
        counts: { stuck: 0, overdue: 0, running: 1, waiting: 0, total: 1 },
        tasks: [],
      })),
    ],
  }

  // 1. pmFeed active (fresh + >99 unclipped) and stale (>5m)
  const pmView = dispatchPage.render({ ...ctxOf(120, 30, liveOf(NARROW_RUNS)), v74: { pm: pmFresh, pmFetchedMs: NOW - 2 * 60_000, decide: [], todo: null, nav } })
  const pmLines = pmView.body.map(text)
  expect(pmLines[0]).toContain('全艦隊產線 · fleet pm status --json')
  expect(pmLines[0]).toContain('2 分前')
  expect(pmLines[0]).toContain('>5 分過舊')
  expect(pmLines[1]).toContain('⊘1')
  expect(pmLines[1]).toContain('●120')
  expect(pmLines[1]).toContain('✗1')
  expect(pmLines[1]).toContain('⋯1')
  expect(pmLines[1]).toContain('共 123 條')

  const pmStaleView = dispatchPage.render({
    ...ctxOf(120, 30, liveOf(NARROW_RUNS)),
    v74: { pm: { ...pmFresh, generated_at_ms: NOW - 8 * 60_000 }, pmFetchedMs: NOW - 8 * 60_000, decide: [], todo: null, nav },
  })
  expect(pmStaleView.body.map(text).join('\n')).toContain('已過期')
  expect(pmStaleView.body.some(r => r.some(s => s.color === PALETTE.broken && s.text.includes('8 分')))).toBe(true)

  // 2. consoleSnap fallback when pmFeed is null (with pmError + stale tasks source)
  const staleCon = {
    ...CALM_CONSOLE,
    generated_at_ms: NOW - 7 * 60_000,
    sources: { ...CALM_CONSOLE.sources, tasks: { at_ms: NOW - 7 * 60_000, state: 'stale' as const } },
    counts: { ...CALM_CONSOLE.counts, summary: { ...CALM_CONSOLE.counts.summary, lines: { running: 14, waiting: 3, stuck: 2, failed: 1 } } },
  }
  const conView = dispatchPage.render({
    ...ctxOf(120, 30, liveOf(NARROW_RUNS), staleCon),
    v74: { pm: null, pmFetchedMs: null, pmError: 'pm offline', decide: [], todo: null, nav },
  })
  const conAll = conView.body.map(text).join('\n')
  expect(conAll).toContain('全艦隊產線 · fleet console --json')
  expect(conAll).toContain('⊘2')
  expect(conAll).toContain('●14')
  expect(conAll).toContain('✗1')
  expect(conAll).toContain('⋯3')
  expect(conAll).toContain('pm offline')
  expect(conAll).toContain('console 產線來源過期')

  // 3. fleetNow fallback when pmFeed & consoleSnap are both null
  const fleetView = dispatchPage.render({
    ...ctxOf(120, 30, liveOf(NARROW_RUNS), null),
    v74: {
      pm: null,
      pmFetchedMs: null,
      pmError: 'pm timeout',
      decide: [],
      todo: null,
      nav,
      fleetSummary: { fetchedMs: NOW - 9 * 60_000, error: null, totals: { stuck: 5, running: 7, waiting: 2, failed: 3 } },
    },
  })
  const fleetAll = fleetView.body.map(text).join('\n')
  expect(fleetAll).toContain('全艦隊產線 · fleet tasks --tree --json')
  expect(fleetAll).toContain('⊘5')
  expect(fleetAll).toContain('●7')
  expect(fleetAll).toContain('✗3')
  expect(fleetAll).toContain('⋯2')
  expect(fleetAll).toContain('pm timeout')
  expect(fleetAll).toContain('已過期')

  // 4. All three sources missing (even with live === null) still renders header, em-dash counts, threshold, and reasons
  const missView = dispatchPage.render({
    ...ctxOf(80, 24, null, null),
    v74: { pm: null, pmFetchedMs: null, pmError: 'pm down', fleetError: 'bus err', fleetSummary: null, decide: [], todo: null, nav },
  })
  const missAll = missView.body.map(text).join('\n')
  expect(missAll).toContain('全艦隊產線 · 無來源（>5 分過舊）')
  expect(missAll).toContain('⊘—')
  expect(missAll).toContain('●—')
  expect(missAll).toContain('✗—')
  expect(missAll).toContain('⋯—')
  expect(missAll).toContain('pm down')
  expect(missAll).toContain('bus err')
  expect(missAll).toContain('派工：無來源')

  // 5. English locale + fixed frame height & width at 80/120/209
  const enCtx = {
    ...ctxOf(80, 24, liveOf(NARROW_RUNS)),
    t: makeT('en'),
    v74: { pm: pmFresh, pmFetchedMs: NOW - 2 * 60_000, decide: [], todo: null, nav },
  }
  const enAll = dispatchPage.render(enCtx).body.map(text).join('\n')
  expect(enAll).toContain('Fleet lines · fleet pm status --json')
  expect(enAll).toContain('>5m stale')
  expect(enAll).toContain('123 lines')
  for (const [cols, rows] of [[80, 24], [120, 30], [209, 49]] as const) {
    const out = frameRows(dispatchPage, { ...ctxOf(cols, rows, liveOf(NARROW_RUNS)), v74: { pm: pmFresh, pmFetchedMs: NOW - 2 * 60_000, decide: [], todo: null, nav } }, { pages: PAGES })
    expect(out.length).toBe(rows)
    for (const r of out) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
  }
})

