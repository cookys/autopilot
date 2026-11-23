// mods/live/pages/trace-s3.test.ts — Traceability gap tests for sub-task s3 (G05, G06, G07, G08, G09, G10, G12, G13 page layer).
// Verifies that band ~ / ? / 99+ / — indicators trace cleanly to full values, source names, ages, 5m/180s thresholds, and failure reasons
// across 現況 (now), 待決 (decide), 審查 (review), 殘留 (hygiene), and 艦隊 (fleet), in both zh-TW and en.
import { test, expect } from 'claude-code/testing'
import { frameRows } from './frame'
import type { PageCtx, Row } from './frame'
import { PAGES } from './index'
import { nowPage } from './now'
import { decidePage } from './decide'
import { renderReview, reviewPage } from './review'
import { hygienePage, hygieneView } from './hygiene'
import { fleetPage, fleetView } from './fleet'
import type { FleetCtx } from './fleet'
import { makeT } from '../i18n'
import { NO_DETAIL, NO_SECTIONS, displayWidth, readLoadSource, readQc, readQcAt, readQcReason } from '../model'
import type { LiveSnapshot, LoadSourceView, ResidueView } from '../model'
import type { ConsoleSnapshot } from '../console'
import type { OthersView } from '../fleet'
import type { DecideCard, PmStatus, V74Ctx } from '../v74/contract'
import { PALETTE } from '../../tux/palette.ts'

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const MIN = 60_000
const iso = (agoMs: number): string => new Date(NOW - agoMs).toISOString()
const tZh = makeT('zh-TW')
const tEn = makeT('en')
const text = (r: Row): string => r.map(s => s.text).join('')
const join = (rows: Row[]): string => rows.map(text).join('\n')
const NAV = { cursor: 0, picks: {}, notes: {}, noteMode: false }

function makeLive(over: Partial<LiveSnapshot> & { qc?: LiveSnapshot['detail']['qc']; qc_reason?: string | null; residue?: ResidueView | null; load_source?: LoadSourceView | null } = {}): LiveSnapshot {
  return {
    state: over.state ?? 'ok',
    text: over.text ?? '',
    header: over.header ?? '',
    band: over.band ?? null,
    pending: over.pending ?? [],
    project_key: over.project_key ?? 'proj-alpha',
    root_run_id: null,
    link: null,
    rows: over.rows === undefined ? [] : over.rows,
    gates: null,
    sections: over.sections ?? NO_SECTIONS,
    review: over.review ?? null,
    published_at: over.published_at === undefined ? null : over.published_at,
    watcher_note: null,
    session_as_of: null,
    host_as_of: null,
    detail: {
      ...NO_DETAIL,
      now_ms: NOW,
      project: 'proj-alpha',
      qc: over.qc === undefined ? null : over.qc,
      ...(over.qc_reason === undefined ? {} : { qc_reason: over.qc_reason }),
      residue: over.residue === undefined ? null : over.residue,
      load_source: over.load_source === undefined ? null : over.load_source,
      ...(over.detail ?? {}),
    },
  } as LiveSnapshot
}

function makeCon(over: {
  genAgoMs?: number
  tasks?: { at_ms: number | null; state: 'ok' | 'stale' | 'expired' | 'no_source' }
  hosts?: { at_ms: number | null; state: 'ok' | 'stale' | 'expired' | 'no_source' }
  lineSummary?: { running?: number; waiting?: number; stalled?: number; failed?: number }
} = {}): ConsoleSnapshot {
  const ok = { at_ms: NOW - 15_000, state: 'ok' as const }
  return {
    generated_at_ms: NOW - (over.genAgoMs ?? 15_000),
    sources: {
      tasks: over.tasks ?? ok,
      hosts: over.hosts ?? ok,
      cards: ok,
      quota_now: ok,
      quota_forecast: ok,
    },
    counts: {
      decisions: 0,
      exceptions: 0,
      quota_risk: 0,
      tabs: {},
      summary: {
        lines: over.lineSummary ?? { running: 2, waiting: 3, stalled: 1 },
        hosts: { online: 4, total: 4 },
        hints: 0,
        quota_worst: null,
      },
    },
    items: [],
    cards: [],
    lines: [],
    quota: { pools: [], seats: [] },
  } as unknown as ConsoleSnapshot
}

function makePm(over: { genAgoMs?: number; count?: number } = {}): PmStatus {
  const n = over.count ?? 2
  const projects = Array.from({ length: n }, (_, i) => ({
    project: 'line-' + i,
    root_id: null,
    counts: { stuck: i === 0 ? 1 : 0, overdue: 0, running: i === 0 ? 0 : 2, waiting: 0, total: 2 },
    tasks: [],
  }))
  return {
    schema: 'fleet.pm.status',
    schema_version: 1,
    generated_at_ms: NOW - (over.genAgoMs ?? 10_000),
    selector: null,
    projects,
  }
}

const CARDS: DecideCard[] = [
  { id: 'd-10000001', title: '合併方案', question: '要先合哪一支分支？', background: '測試背景', options: [{ label: '先合 A', detail: '安全', recommended: true }, { label: '先合 B', detail: '快', recommended: false }] },
  { id: 'd-10000002', title: '發布時機', question: '今晚發還是明早發？', background: null, options: [{ label: '明早', detail: '', recommended: true }] },
]

// ---- G05: 待決頁過期警示、閾值、liveStale 觸發原因、單卡開卡年紀、實錯與移除盒裝 shell.on_band ----
test('G05 decide: stale decideFeed (>5m) and liveStale both surface explicit stale reasons and 5m threshold; fresh data emits none', () => {
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    // 1. decideFeed > 5m (8 min old)
    const feedStaleCtx: PageCtx = {
      live: makeLive({ published_at: iso(60_000) }),
      console: null,
      size: { cols: 120, rows: 20 },
      t,
      nowMs: NOW,
      box: true,
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: NAV, ages: { decide: NOW - 8 * MIN } },
    }
    const feedOut = decidePage.render(feedStaleCtx)
    const feedText = join(feedOut.body)
    expect(feedText, loc).toContain('fleet decision list')
    expect(feedText, loc).toContain('8')
    expect(feedText, loc).toContain('5')
    expect(feedOut.body[0].every(s => s.color === PALETTE.broken), loc).toBe(true)

    // 2. decideFeed fresh (1m) BUT live.state === 'stale' (band ~/? caused by liveStale!)
    const liveStaleCtx: PageCtx = {
      live: makeLive({ state: 'stale', header: 'watcher 沒有在發佈' }),
      console: null,
      size: { cols: 120, rows: 20 },
      t,
      nowMs: NOW,
      box: true,
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: NAV, ages: { decide: NOW - MIN } },
    }
    const liveOut = decidePage.render(liveStaleCtx)
    const liveText = join(liveOut.body)
    expect(liveText, loc).toContain('watcher 沒有在發佈')
    expect(liveText, loc).toContain('5')
    expect(liveOut.body[0].every(s => s.color === PALETTE.broken), loc).toBe(true)

    // 3. empty cards ([] -> ~無待決?) with live.state === 'stale' still shows stale banner
    const emptyStale = decidePage.render({ ...liveStaleCtx, v74: { ...liveStaleCtx.v74!, decide: [] } })
    expect(join(emptyStale.body), loc).toContain('watcher 沒有在發佈')

    // 4. live.state === 'ok' with published_at > 5m when ages.decide is absent
    const liveAgeCtx: PageCtx = {
      live: makeLive({ state: 'ok', published_at: iso(7 * MIN) }),
      console: null,
      size: { cols: 120, rows: 20 },
      t,
      nowMs: NOW,
      box: true,
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: NAV },
    }
    expect(join(decidePage.render(liveAgeCtx).body), loc).toContain('7')
    expect(join(decidePage.render(liveAgeCtx).body), loc).toContain('5')

    // 5. negative control: fresh decideFeed + fresh live emits no stale banner
    const freshCtx: PageCtx = {
      live: makeLive({ published_at: iso(30_000) }),
      console: null,
      size: { cols: 120, rows: 20 },
      t,
      nowMs: NOW,
      box: true,
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: NAV, ages: { decide: NOW - 30_000 } },
    }
    expect(decidePage.render(freshCtx).body.some(r => r.some(s => s.color === PALETTE.broken)), loc).toBe(false)
  }
})

test('G05 decide: card open age displays via openedAtMs or live.pending; null source in box drops shell.on_band and shows decideError', () => {
  const datedCards = [{ ...CARDS[0], openedAtMs: NOW - 40 * MIN }, CARDS[1]] as DecideCard[]
  const ctx: PageCtx = {
    live: makeLive({}),
    console: null,
    size: { cols: 120, rows: 20 },
    t: tZh,
    nowMs: NOW,
    box: true,
    v74: { pm: null, pmFetchedMs: null, decide: datedCards, todo: null, nav: NAV },
  }
  expect(join(decidePage.render(ctx).body)).toContain('開卡 40 分前')

  // Null source with minimal s2 decideError in box mode: shows real error and drops obsolete shell.on_band
  const missingBox = decidePage.render({
    ...ctx,
    v74: { pm: null, pmFetchedMs: null, decide: null, todo: null, nav: NAV, decideError: 'fleet bus timeout 8s' } as V74Ctx,
  })
  expect(join(missingBox.body)).toContain('fleet bus timeout 8s')
  expect(missingBox.actions).toEqual([])
  expect(join(missingBox.actions)).not.toContain('待決在 band 上')
})

// ---- G06 & G12: 審查頁 >5m 過期警示、閾值、code/plan/qc 時間戳與 qc === null 顯性缺失塊 ----
test('G06 review: live.state === ok with published_at > 5m shows stale warning + 5m/180s threshold; timestamps on code/plan/qc are shown', () => {
  // readQc preserves exact 4-key P7c shape for watcher checked_at files while readQcAt extracts checked_at for detail.qc_at
  const checkedJson = JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: 'proj-alpha', root_run_id: null }, state: 'ok', range: 'abc..HEAD', protected_files_count: 2, evidence: 'trailer', checked_at: iso(14 * MIN) })
  expect(readQc(checkedJson, { project_key: 'proj-alpha', root_run_id: null })).toEqual({ state: 'ok', range: 'abc..HEAD', protected_files_count: 2, evidence: 'trailer' })
  expect(readQcAt(checkedJson, { project_key: 'proj-alpha', root_run_id: null })).toBe(iso(14 * MIN))
  const withDetailQcAt = makeLive({ state: 'ok', published_at: iso(2 * MIN), qc: readQc(checkedJson, { project_key: 'proj-alpha', root_run_id: null }) })
  withDetailQcAt.detail = { ...withDetailQcAt.detail, qc_at: readQcAt(checkedJson, { project_key: 'proj-alpha', root_run_id: null }) }
  expect(join(renderReview({ live: withDetailQcAt, console: null, size: { cols: 120, rows: 30 }, t: tZh, nowMs: NOW }).body)).toContain('14')

  const qc = readQc(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: 'proj-alpha' }, state: 'ok', range: 'aaaa111..bbbb222', protected_files_count: 1, evidence: 'artifact', at: iso(12 * MIN) }), { project_key: 'proj-alpha', root_run_id: null })
  expect(qc?.at).toBe(iso(12 * MIN))
  const staleOkLive = makeLive({
    state: 'ok',
    published_at: iso(9 * MIN),
    qc,
    review: {
      code: { phase: null, generation: 2, base: 'aaaa111', head: 'bbbb222', converged: true, at: iso(15 * MIN), seats: [{ id: 'g', family: 'google', status: 'reviewed', verdict: 'SHIP-AS-IS' }] },
      plan: { logical_plan_id: 'plan-x@1112223', generation: 1, max_generations: 2, terminal: true, verdict: 'READY', updated_at: iso(30 * MIN), seats: [{ id: 'a', family: null, status: 'READY' }] },
    },
  })
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    const out = renderReview({ live: staleOkLive, console: null, size: { cols: 120, rows: 30 }, t, nowMs: NOW })
    const all = join(out.body)
    expect(out.body[0].every(s => s.color === PALETTE.broken), loc).toBe(true)
    expect(all, loc).toContain('9')
    expect(all, loc).toContain('5')
    expect(all, loc).toContain('180')
    expect(all, loc).toContain('15')
    expect(all, loc).toContain('30')
    expect(all, loc).toContain('12')
    expect(out.actions.length, loc).toBe(1)

    // negative control: fresh live (2m ago) emits no stale row
    const freshOut = renderReview({ live: { ...staleOkLive, published_at: iso(2 * MIN) }, console: null, size: { cols: 120, rows: 30 }, t, nowMs: NOW })
    expect(freshOut.body.some(r => r.some(s => s.color === PALETTE.broken)), loc).toBe(false)
  }
})

test('G12 review: qc === null in v7.4 mode renders explicit missing QC block with filename and diagnostic reason; readQcReason classifies failures', () => {
  expect(readQcReason(null, { project_key: 'p1', root_run_id: null })).toBe('missing')
  expect(readQcReason('{bad', { project_key: 'p1', root_run_id: null })).toBe('malformed')
  expect(readQcReason(JSON.stringify({ schema: 'other/1' }), { project_key: 'p1', root_run_id: null })).toBe('wrong_schema')
  expect(readQcReason(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: 'other' }, state: 'ok' }), { project_key: 'p1', root_run_id: null })).toBe('wrong_scope')
  expect(readQcReason(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: 'p1' }, state: 'bogus' }), { project_key: 'p1', root_run_id: null })).toBe('invalid_state')
  expect(readQcReason(JSON.stringify({ schema: 'autopilot.qc-status/1', scope: { project_key: 'p1' }, state: 'ok' }), { project_key: 'p1', root_run_id: null })).toBeNull()

  const v74: V74Ctx = { pm: null, pmFetchedMs: null, decide: [], todo: null, nav: NAV }
  const liveNoQc = makeLive({
    qc: null,
    qc_reason: 'wrong_schema',
    review: {
      code: { phase: null, generation: 1, base: 'aaaa111', head: 'bbbb222', converged: true, at: iso(MIN), seats: [{ id: 'g', family: 'google', status: 'reviewed', verdict: 'SHIP-AS-IS' }] },
      plan: null,
    },
  })
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    const out = renderReview({ live: liveNoQc, console: null, size: { cols: 120, rows: 30 }, t, nowMs: NOW, v74 })
    const all = join(out.body)
    expect(all, loc).toContain('proj-alpha.qc.json')
    expect(all, loc).toContain('wrong_schema')
    expect(out.body.some(r => r.some(s => s.color === PALETTE.broken)), loc).toBe(true)
  }
})

// ---- G07, G09, G13 (now): PM/tasks/seat 過期與閾值、pm===null 回退顯示 >99 完整計數、錯誤與無 console 提示 ----
test('G07 now: PM >5m, console tasks stale, live.state === stale (preserves live.header), and live ok >5m all show reasons and thresholds', () => {
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    const ctx: PageCtx = {
      live: makeLive({ state: 'stale', header: '資料過舊 · watcher 已停', published_at: iso(11 * MIN) }),
      console: makeCon({ tasks: { at_ms: NOW - 8 * MIN, state: 'stale' } }),
      size: { cols: 120, rows: 30 },
      t,
      nowMs: NOW,
      v74: { pm: makePm({ genAgoMs: 9 * MIN }), pmFetchedMs: NOW - 9 * MIN, decide: [], todo: null, nav: NAV },
    }
    const all = join(nowPage.render(ctx).body)
    expect(all, loc).toContain('fleet pm status')
    expect(all, loc).toContain('9')
    expect(all, loc).toContain('8')
    expect(all, loc).toContain('5')
    expect(all, loc).toContain('資料過舊 · watcher 已停')
    expect(all, loc).not.toContain(t('page.now.no_live'))

    // live.state === 'ok' but published_at > 5m
    const okOld = join(nowPage.render({ ...ctx, live: makeLive({ state: 'ok', published_at: iso(6 * MIN) }) }).body)
    expect(okOld, loc).toContain('6')
    expect(okOld, loc).toContain('5')
  }
})

test('G09 & G13 now: pm === null falls back to full >99 counts from console or fleetSummary, and surfaces pmError / missing hosts / fallback failure', () => {
  // 1. pm === null + console fallback with >99 counts (exact numbers 120, 150, 210 — never 99+)
  const conBig = makeCon({ lineSummary: { failed: 120, stalled: 150, running: 210, waiting: 105 } })
  const outCon = join(nowPage.render({
    live: makeLive({}),
    console: conBig,
    size: { cols: 120, rows: 30 },
    t: tZh,
    nowMs: NOW,
    v74: { pm: null, pmFetchedMs: null, decide: [], todo: null, nav: NAV, pmError: 'exit 1: bus unreachable' } as V74Ctx,
  }).body)
  expect(outCon).toContain('exit 1: bus unreachable')
  expect(outCon).toContain('120')
  expect(outCon).toContain('150')
  expect(outCon).toContain('210')
  expect(outCon).toContain('105')
  expect(outCon).not.toContain('99+')

  // 2. pm === null + console === null + fleetSummary fallback (>99 counts & stale)
  const outFleet = join(nowPage.render({
    live: makeLive({}),
    console: null,
    size: { cols: 120, rows: 30 },
    t: tZh,
    nowMs: NOW,
    v74: {
      pm: null,
      pmFetchedMs: null,
      decide: [],
      todo: null,
      nav: NAV,
      fleetSummary: { fetchedMs: NOW - 7 * MIN, error: null, totals: { failed: 101, stuck: 130, running: 240, waiting: 111 } },
    } as V74Ctx,
  }).body)
  expect(outFleet).toContain('101')
  expect(outFleet).toContain('130')
  expect(outFleet).toContain('240')
  expect(outFleet).toContain('111')
  expect(outFleet).toContain('7')
  expect(outFleet).toContain('5')

  // 3. All 3 sources missing -> pmError + fallback unavailability + missing console hosts/quota
  const outNone = join(nowPage.render({
    live: makeLive({}),
    console: null,
    size: { cols: 120, rows: 30 },
    t: tZh,
    nowMs: NOW,
    v74: { pm: null, pmFetchedMs: null, decide: [], todo: null, nav: NAV, pmError: 'timeout 8s', fleetError: 'socket refused' } as V74Ctx,
  }).body)
  expect(outNone).toContain('timeout 8s')
  expect(outNone).toContain('socket refused')
  expect(outNone).toContain('主機／額度池：無來源')
})

// ---- G08 & G10 (hygiene): >5m 過期警示、residue.at / load_source.at 時間戳、needs_human_count 與 ls.flags 口徑一致 ----
test('G08 & G10 hygiene: live >5m, residue.at >5m, load_source.at >5m warn with 5m threshold; total needs_human_count and ls.flags count match band', () => {
  const lsParsed = readLoadSource(JSON.stringify({
    schema: 'autopilot.load-source/1',
    source: 'dev',
    marketplace: 'directory',
    flags: ['stale_cache_dirs', 'loaded_from_cache'],
    stale_cache_dirs: [],
    at: iso(11 * MIN),
  }))
  expect(lsParsed?.at).toBe(iso(11 * MIN))

  const residueMixed: ResidueView = {
    reapable: 20,
    by_class: {},
    at: iso(8 * MIN),
    needs_human_count: 120,
    needs_human_bytes: null,
    needs_human: [
      { kind: 'worktree', target: 'wt-judge', class: 'dirty', age_days: 3, bytes: null, reason: 'uncommitted', command: null },
      { kind: 'worktree', target: 'wt-clean', class: 'clean-integrated', age_days: 2, bytes: null, reason: 'merged', command: null },
    ],
    auto_ran_at: null,
    auto_removed_count: null,
    auto_archived_count: null,
  }
  const lv = makeLive({ published_at: iso(7 * MIN), residue: residueMixed, load_source: lsParsed })

  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    const out = hygieneView({ live: lv, console: null, size: { cols: 120, rows: 30 }, t, nowMs: NOW })
    const all = join(out.body)
    expect(out.body[0].every(s => s.color === PALETTE.broken), loc).toBe(true)
    expect(all, loc).toContain('7')
    expect(all, loc).toContain('8')
    expect(all, loc).toContain('11')
    expect(all, loc).toContain('5')
    expect(all, loc).toContain('120')
    expect(all, loc).toContain('119')
    expect(all, loc).toContain('stale_cache_dirs')
    expect(all, loc).toContain('loaded_from_cache')
    expect(all, loc).toContain('2')

    // negative control: fresh timestamps emit no stale broken rows
    const freshLv = makeLive({
      published_at: iso(30_000),
      residue: { ...residueMixed, at: iso(30_000) },
      load_source: { ...lsParsed!, at: iso(30_000) },
    })
    expect(hygieneView({ live: freshLv, console: null, size: { cols: 120, rows: 30 }, t, nowMs: NOW }).body.some(r => r.some(s => s.color === PALETTE.broken)), loc).toBe(false)
  }
})

// ---- G07, G09, G13 (fleet): others.stale / lastError, live >5m, console/fleetFeed >99 counts & errors ----
test('G07, G09 & G13 fleet: surfaces others.stale, others.lastError, live >5m, decide >5m, >99 line counts, and fleetFeed/pm errors', () => {
  const staleOthers: OthersView = {
    present: true,
    unreadable: null,
    syncedMs: NOW - 10 * MIN,
    stale: true,
    lastError: 'rsync exit 255',
    skipped: 0,
    todo: [],
    todoError: null,
    todoSkipped: 0,
    nowMs: NOW,
    cards: [],
  }
  const conBig = makeCon({
    tasks: { at_ms: NOW - 9 * MIN, state: 'stale' },
    lineSummary: { failed: 102, stalled: 140, running: 220, waiting: 108 },
  })
  for (const [loc, t] of [['zh-TW', tZh], ['en', tEn]] as const) {
    const ctx: FleetCtx = {
      live: makeLive({ published_at: iso(8 * MIN), rows: [] }),
      console: conBig,
      others: staleOthers,
      fleetFeed: { fetchedMs: NOW - 6 * MIN, error: 'fleet cli timeout', totals: null },
      size: { cols: 120, rows: 30 },
      t,
      nowMs: NOW,
      v74: { pm: null, pmFetchedMs: null, decide: CARDS, todo: null, nav: NAV, ages: { decide: NOW - 7 * MIN }, pmError: 'pm exit 2' } as V74Ctx,
    }
    const out = fleetView(ctx)
    const all = join(out.body)
    expect(all, loc).toContain('rsync exit 255')
    expect(all, loc).toContain('fleet cli timeout')
    expect(all, loc).toContain('pm exit 2')
    expect(all, loc).toContain('102')
    expect(all, loc).toContain('140')
    expect(all, loc).toContain('220')
    expect(all, loc).toContain('108')
    expect(all, loc).toContain('5')
    expect(all, loc).toContain('180')
    expect(all, loc).not.toContain('99+')
  }
})

test('trace-s3 frame invariant: all 5 pages stay within fixed height and width at 80x24 and 120x30 under stale/missing/overflow states', () => {
  const v74: V74Ctx = {
    pm: null,
    pmFetchedMs: null,
    decide: CARDS,
    todo: null,
    nav: NAV,
    ages: { decide: NOW - 8 * MIN },
  }
  const lv = makeLive({
    state: 'ok',
    published_at: iso(9 * MIN),
    qc: null,
    qc_reason: 'missing',
    residue: { reapable: 1, by_class: {}, at: iso(9 * MIN), needs_human_count: 105, needs_human_bytes: null, needs_human: [{ kind: 'worktree', target: 'wt-1', class: 'clean-integrated', age_days: 1, bytes: null, reason: null, command: null }], auto_ran_at: null, auto_removed_count: null, auto_archived_count: null },
    load_source: { plugin_version: null, source: 'dev', marketplace: 'directory', marketplace_path: null, behind_upstream: 0, flags: ['stale_cache_dirs'], stale_cache_dirs: [], at: iso(9 * MIN) },
  })
  const con = makeCon({ tasks: { at_ms: NOW - 8 * MIN, state: 'stale' }, lineSummary: { failed: 110, stalled: 120, running: 130, waiting: 140 } })
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const ctx: PageCtx = { live: lv, console: con, size: { cols, rows }, t: tZh, nowMs: NOW, v74, box: true }
    for (const page of [nowPage, decidePage, reviewPage, hygienePage, fleetPage]) {
      const framed = frameRows(page, ctx, { pages: PAGES })
      expect(framed.length, `${page.id}@${cols}x${rows}`).toBe(rows)
      for (const r of framed) expect(displayWidth(text(r)), `${page.id}@${cols}x${rows}`).toBeLessThanOrEqual(cols)
    }
  }
})
