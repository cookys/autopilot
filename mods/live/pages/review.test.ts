// mods/live/pages/review.test.ts — page 6 審查 (plan r2 §2 row 6, §3.1, §3.2, §5; Fleet-Task 01M7PC93PGG8FQ28EMT6ZDP7NY):
// Golden tests against all 6 codeforge r2 mockups at 160x40, 120x30 and 80x24 through frameRows and the real Pane / mounted plugin paths,
// fixed-height invariant (= H), bidirectional fold/unfold on z surviving across renders, empty state, overflow row (↓ 還有 N 列),
// wrapped broken/stale source rows without truncation or false calm empty state (A10), and matching hotkey Button checks (G11).
import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane, pageHotkeys } from '../pane'
import type { PageView } from '../pane'
import { EN, ZH_TW } from '../locales'
import { makeT } from '../i18n'
import { NO_DETAIL, NO_SECTIONS, displayWidth } from '../model'
import type { DecisionRow, LiveSnapshot } from '../model'
import type { ConsoleSnapshot } from '../console'
import { PALETTE } from '../../tux/palette.ts'
import { PAGES } from './index'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge, stripRows } from './frame'
import type { Page, PageCtx, Row } from './frame'
import { routeKey } from './keys'
import type { KeyAction } from './keys'
import { brokenRow, staleBadge } from './rows'
import { DEFAULT_REVIEW_VIEW, renderReview, reviewPage } from './review'
import type { ReviewView } from './review'

const t = makeT('zh-TW')
const tEn = makeT('en')
const NOW = 1794200000000
const MIN = 60_000
const HOUR = 3_600_000
const iso = (agoMs: number): string => new Date(NOW - agoMs).toISOString()
const text = (row: Row): string => row.map(s => s.text).join('')

const okConsole = (): ConsoleSnapshot => ({
  generated_at_ms: NOW - 12_000,
  sources: {
    tasks: { at_ms: NOW - 12_000, state: 'ok' },
    hosts: { at_ms: NOW - 12_000, state: 'ok' },
    cards: { at_ms: NOW - 12_000, state: 'ok' },
    quota_now: { at_ms: NOW - 40_000, state: 'ok' },
    quota_forecast: { at_ms: NOW - 40_000, state: 'ok' },
  },
  counts: {
    decisions: 0,
    exceptions: 0,
    quota_risk: 0,
    tabs: {},
    summary: { lines: { running: 2, waiting: 4, stalled: 0 }, hosts: { online: 3, total: 3 }, hints: 0, quota_worst: null },
  },
  items: [],
  cards: [],
  lines: [],
  quota: { pools: [], seats: [] },
} as unknown as ConsoleSnapshot)

const decRow = (id: string | null, decision: string, agoMs: number | null): DecisionRow => ({
  round: 1,
  decision,
  irreversible: false,
  writer: 'pm',
  decision_id: id,
  source: null,
  root: null,
  at: agoMs === null ? null : iso(agoMs),
})

function liveSnap(over: {
  state?: LiveSnapshot['state']
  header?: string
  code?: NonNullable<LiveSnapshot['review']>['code']
  plan?: NonNullable<LiveSnapshot['review']>['plan']
  qc?: LiveSnapshot['detail']['qc']
  decisions?: LiveSnapshot['detail']['decisions']
  decisionsNotWired?: boolean
} = {}): LiveSnapshot {
  const code = over.code ?? null
  const plan = over.plan ?? null
  return {
    state: over.state ?? 'ok',
    text: '',
    header: over.header ?? '',
    band: null,
    pending: [],
    project_key: 'plan/shared-tui',
    root_run_id: null,
    link: null,
    rows: null,
    gates: null,
    sections: { ...NO_SECTIONS, decisionsNotWired: over.decisionsNotWired === true },
    review: code === null && plan === null ? null : { code, plan },
    published_at: null,
    watcher_note: null,
    session_as_of: null,
    host_as_of: null,
    detail: {
      ...NO_DETAIL,
      now_ms: NOW,
      project: 'plan/shared-tui',
      qc: over.qc ?? null,
      decisions: over.decisions ?? null,
    },
  } as unknown as LiveSnapshot
}

const CODE_MOCKUP: NonNullable<LiveSnapshot['review']>['code'] = {
  phase: null,
  generation: 1,
  base: '4abd667f',
  head: 'f55289ca',
  converged: true,
  at: iso(135 * HOUR),
  seats: [
    { id: 's0', family: 'google', status: 'reviewed', verdict: 'SHIP-AS-IS' },
    { id: 's1', family: 'xai', status: 'reviewed', verdict: 'SHIP-AS-IS' },
  ],
}

const QC_MOCKUP: NonNullable<LiveSnapshot['detail']['qc']> = {
  state: 'ok',
  range: '4abd667f..627114b',
  protected_files_count: 2,
  evidence: 'artifact',
}

const PLAN_MOCKUP: NonNullable<LiveSnapshot['review']>['plan'] = {
  logical_plan_id: 'plan/shared-tui@1fba336',
  generation: 2,
  max_generations: 2,
  terminal: true,
  verdict: 'READY',
  seats: [
    { id: 'astra', family: null, status: '8' },
    { id: 'carbon', family: null, status: '8' },
  ],
  updated_at: iso(2 * HOUR),
}

// Input rows intentionally put the older row first so tests also verify newest-first ordering (15m before 1h).
const DECISIONS_WIDE: NonNullable<LiveSnapshot['detail']['decisions']> = {
  rows: [
    decRow('01M7N2YJ', '退回讀 console.json 快照，不轉 brief', 1 * HOUR),
    decRow('01M7N33J', '分頁列放最下一列，不另起一行', 15 * MIN),
  ],
  count: 2,
  irreversible: 0,
  writers: ['pm'],
  undocumented: 0,
  identity: null,
  root: null,
  ladder: null,
}

const DECISIONS_NARROW: NonNullable<LiveSnapshot['detail']['decisions']> = {
  ...DECISIONS_WIDE,
  rows: [
    decRow('01M7N2YJ', '退回讀快照', 1 * HOUR),
    decRow('01M7N33J', '分頁列放最下列', 15 * MIN),
  ],
}

const LIVE_WIDE = liveSnap({ code: CODE_MOCKUP, qc: QC_MOCKUP, decisions: DECISIONS_WIDE, plan: PLAN_MOCKUP })
const LIVE_NARROW = liveSnap({ code: CODE_MOCKUP, qc: QC_MOCKUP, decisions: DECISIONS_NARROW, plan: PLAN_MOCKUP })
const LIVE_EMPTY = liveSnap({})

const ctxOf = (cols: number, rows: number, live: LiveSnapshot | null, con: ConsoleSnapshot | null = okConsole(), tr = t): PageCtx => ({
  live,
  console: con,
  size: { cols, rows },
  t: tr,
  nowMs: NOW,
})

// Fake UI elements for rendering through the real Pane component (same harness as frame.test.ts).
type FakeNode = { kind: string; props: Record<string, any> }
const mk = (kind: string) => (props: Record<string, any>): FakeNode => ({ kind, props })
const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
const walkFake = (n: any, out: FakeNode[] = []): FakeNode[] => {
  if (n == null || n === false || typeof n !== 'object') return out
  if (Array.isArray(n)) { n.forEach(c => walkFake(c, out)); return out }
  if (n.kind !== undefined) out.push(n)
  walkFake(n.props?.children, out)
  return out
}
const flatFake = (n: FakeNode): string => {
  const c = n.props.children
  return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flatFake(x) : '')).join('') : c?.props ? flatFake(c) : ''
}

function drawReviewPane(
  cols: number,
  rows: number,
  snap: LiveSnapshot | null,
  opts: { console?: ConsoleSnapshot | null; view?: Record<string, PageView>; onKey?: (k: KeyAction) => void; tr?: typeof t } = {},
) {
  const tree = walkFake(Pane(EL as never, snap, 'review', () => {}, opts.tr ?? t, cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES,
    pageId: 'review',
    console: opts.console === undefined ? okConsole() : opts.console,
    nowMs: NOW,
    rows,
    ...(opts.view === undefined ? {} : { view: opts.view }),
    ...(opts.onKey === undefined ? {} : { onKey: opts.onKey }),
  }))
  const root = tree.find(n => n.kind === 'Box' && n.props.height === rows) as FakeNode
  const kids = ([] as any[]).concat(root.props.children).flat(9).filter(c => c && c.props && /^f\d+$/.test(String(c.props.key))) as FakeNode[]
  const drawnRows = kids.map(k => {
    const s = flatFake(k)
    return s === ' ' ? '' : s
  })
  const zBtn = tree.find(n => n.kind === 'Button' && n.props.hotkey === 'z')
  return { tree, rows: drawnRows, zBtn }
}

// Note on w160 / w120 actions (G11, same rule as decide.test.ts DEVIATIONS):
// The w160 / w120 mockups carry the `（z 收合）` hint in the 替你決定的事 section rule while sketching `沒有要你處理的事` in the action slot;
// per G11 ("Every clickable action is a Button bound to its key; a hint text must have a matching Button", and body rows carry no Buttons),
// `[z] 收合替你決定` is rendered in the action area at 160x40 and 120x30 whenever foldable decisions exist, and `沒有要你處理的事` when none exist.
const GOLD_120_BODY = [
  '── 程式碼審查 ─────────────────────────────────────────',
  '▸ 第 1 代 f55289ca · google SHIP-AS-IS · xai SHIP-AS-IS                                          ▲ 135 時前，HEAD 已不同',
  '── 推送前檢查 ──',
  '  ✓ check-all 綠 · 627114b',
  '── 替你決定的事 2（z 收合）─────────────────────────',
  '  01M7N33J 分頁列放最下一列，不另起一行                                                                          15 分前',
  '  01M7N2YJ 退回讀 console.json 快照，不轉 brief                                                                   1 時前',
  '── plan review ──',
  '  plan/shared-tui 第 2 代 · astra 8 · carbon 8 · 已凍結 1fba336',
]

const GOLD_160_BODY = [
  '── 程式碼審查 ─────────────────────────────────────────',
  '▸ 第 1 代 f55289ca · google SHIP-AS-IS · xai SHIP-AS-IS' + ' '.repeat(82) + '▲ 135 時前，HEAD 已不同',
  '── 推送前檢查 ──',
  '  ✓ check-all 綠 · 627114b',
  '── 替你決定的事 2（z 收合）─────────────────────────',
  '  01M7N33J 分頁列放最下一列，不另起一行' + ' '.repeat(114) + '15 分前',
  '  01M7N2YJ 退回讀 console.json 快照，不轉 brief' + ' '.repeat(107) + '1 時前',
  '── plan review ──',
  '  plan/shared-tui 第 2 代 · astra 8 · carbon 8 · 已凍結 1fba336',
]

const GOLD_80_OPEN_BODY = [
  '── 程式碼 ──',
  '▸g1 f55289ca google✓ xai✓ ▲HEAD 不同',
  '── 推送前 ── ✓ 627114b',
  '── 替你決定 2（z 收合）──',
  '01M7N33J 分頁列放最下列 15分',
  '01M7N2YJ 退回讀快照 1時',
  '── plan ── 1fba336 凍結 8/8',
]

const GOLD_80_FOLDED_BODY = [
  '── 程式碼 ──',
  '▸g1 f55289ca google✓ xai✓ ▲HEAD 不同',
  '── 推送前 ── ✓ 627114b',
  '── 替你決定 2（z 展開）──',
  '── plan ── 1fba336 凍結 8/8',
]

const GOLD_80_EMPTY_BODY = [
  '○ 還沒有審查紀錄（程式碼審查、推送前檢查、plan review 都是空的）',
]

test('review: registry replaces the shell at key 6 and marks the page framed', () => {
  const p = PAGES.find(x => x.id === 'review') as Page
  expect(p).toBe(reviewPage)
  expect(p.key).toBe('6')
  expect(p.title).toBe('審查')
  expect(p.framed).toBe(true)
  expect(DEFAULT_REVIEW_VIEW).toEqual({ focus: 0, expanded: true })
})

test('review golden 160x40 and 120x30: frameRows equals H, body and action rows match the mockups', () => {
  const c160 = ctxOf(160, 40, LIVE_WIDE)
  const r160 = reviewPage.render(c160)
  expect(r160.body.map(text)).toEqual(GOLD_160_BODY)
  expect(r160.actions.map(text)).toEqual(['[z] 收合替你決定'])
  expect(displayWidth(text(r160.body[1]))).toBe(160)
  expect(displayWidth(text(r160.body[5]))).toBe(160)
  expect(displayWidth(text(r160.body[6]))).toBe(160)
  const f160 = frameRows(reviewPage, c160, { pages: PAGES }).map(text)
  expect(f160.length).toBe(40)
  expect(f160[0]).toBe('審查')
  expect(f160.slice(1, 29).every(r => r === '')).toBe(true)
  expect(f160.slice(29, 38)).toEqual(GOLD_160_BODY)
  expect(f160[38]).toBe('[z] 收合替你決定')
  expect(f160[39]).toContain('6 審查')

  const c120 = ctxOf(120, 30, LIVE_WIDE)
  const r120 = reviewPage.render(c120)
  expect(r120.body.map(text)).toEqual(GOLD_120_BODY)
  expect(r120.actions.map(text)).toEqual(['[z] 收合替你決定'])
  expect(displayWidth(text(r120.body[1]))).toBe(120)
  expect(displayWidth(text(r120.body[5]))).toBe(120)
  expect(displayWidth(text(r120.body[6]))).toBe(120)
  const f120 = frameRows(reviewPage, c120, { pages: PAGES }).map(text)
  expect(f120.length).toBe(30)
  expect(f120[0]).toBe('審查')
  expect(f120.slice(1, 19).every(r => r === '')).toBe(true)
  expect(f120.slice(19, 28)).toEqual(GOLD_120_BODY)
  expect(f120[28]).toBe('[z] 收合替你決定')
  expect(f120[29]).toContain('6 審查')
})

test('review golden 80x24: default open, z collapse (折疊關) and z re-expand (折疊開) in both directions through real Pane render path, and empty state', () => {
  const c80 = ctxOf(80, 24, LIVE_NARROW)
  const f80 = frameRows(reviewPage, c80, { pages: PAGES }).map(text)
  expect(f80.length).toBe(24)
  expect(f80[0]).toBe('審查')
  expect(f80.slice(1, 15).every(r => r === '')).toBe(true)
  expect(f80.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  expect(f80[22]).toBe('[z] 收合替你決定')
  expect(f80[23]).toContain('6')

  const zKey = routeKey('z', { page: 'review', paneFocus: true, focusedButton: false, textMode: false })
  expect(zKey).toEqual({ kind: 'fold' })

  // Real Pane render path with surviving pageView state across renders (open -> z -> collapsed -> z -> open)
  let pageView: Record<string, PageView> = {}
  const onKey = (k: KeyAction) => {
    if (k.kind === 'fold') {
      const cur = pageView.review ?? DEFAULT_REVIEW_VIEW
      pageView = { ...pageView, review: { ...cur, expanded: !cur.expanded } }
    }
  }

  // Render 1: default open (Mockup 3)
  const openDraw = drawReviewPane(80, 24, LIVE_NARROW, { view: pageView, onKey })
  expect(openDraw.rows.length).toBe(24)
  expect(openDraw.rows[0]).toBe('審查')
  expect(openDraw.rows.slice(1, 15).every(r => r === '')).toBe(true)
  expect(openDraw.rows.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  expect(openDraw.zBtn).toBeDefined()
  expect(flatFake(openDraw.zBtn as FakeNode)).toBe('收合替你決定')

  // Press z #1 -> rerender: Mockup 4 折疊關（替你決定）
  openDraw.zBtn!.props.onPress()
  expect(pageView.review).toEqual({ focus: 0, expanded: false })
  expect(renderReview(c80, pageView.review).actions.map(text)).toEqual(['[z] 展開替你決定'])
  const foldedDraw = drawReviewPane(80, 24, LIVE_NARROW, { view: pageView, onKey })
  expect(foldedDraw.rows.length).toBe(24)
  expect(foldedDraw.rows[0]).toBe('審查')
  expect(foldedDraw.rows.slice(1, 17).every(r => r === '')).toBe(true)
  expect(foldedDraw.rows.slice(17, 22)).toEqual(GOLD_80_FOLDED_BODY)
  expect(foldedDraw.rows.some(r => r.includes('01M7N33J') || r.includes('01M7N2YJ'))).toBe(false)
  expect(foldedDraw.zBtn).toBeDefined()
  expect(flatFake(foldedDraw.zBtn as FakeNode)).toBe('展開替你決定')

  // Press z #2 -> rerender: Mockup 5 折疊開（替你決定）
  foldedDraw.zBtn!.props.onPress()
  expect(pageView.review).toEqual({ focus: 0, expanded: true })
  expect(renderReview(c80, pageView.review).actions.map(text)).toEqual(['[z] 收合替你決定'])
  const reopenedDraw = drawReviewPane(80, 24, LIVE_NARROW, { view: pageView, onKey })
  expect(reopenedDraw.rows.length).toBe(24)
  expect(reopenedDraw.rows.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  expect(reopenedDraw.zBtn).toBeDefined()
  expect(flatFake(reopenedDraw.zBtn as FakeNode)).toBe('收合替你決定')

  // Mockup 6: 80x24 沒有任何紀錄 (healthy source, zero records)
  const cEmpty = ctxOf(80, 24, LIVE_EMPTY)
  expect(reviewPage.render(cEmpty).actions).toEqual([])
  const fEmpty = frameRows(reviewPage, cEmpty, { pages: PAGES }).map(text)
  expect(fEmpty.length).toBe(24)
  expect(fEmpty[0]).toBe('審查')
  expect(fEmpty.slice(1, 21).every(r => r === '')).toBe(true)
  expect(fEmpty.slice(21, 22)).toEqual(GOLD_80_EMPTY_BODY)
  expect(fEmpty[22]).toBe('沒有要你處理的事')
  expect(fEmpty[23]).toContain('6')
})

test('review: fold/unfold round-trip at 160x40 and 120x30 through real Pane hides and restores decision rows; healthy no-decisions wide state shows 沒有要你處理的事', () => {
  for (const [cols, rows, goldOpen] of [[160, 40, GOLD_160_BODY], [120, 30, GOLD_120_BODY]] as const) {
    let pageView: Record<string, PageView> = {}
    const onKey = (k: KeyAction) => {
      if (k.kind === 'fold') {
        const cur = pageView.review ?? DEFAULT_REVIEW_VIEW
        pageView = { ...pageView, review: { ...cur, expanded: !cur.expanded } }
      }
    }
    const d1 = drawReviewPane(cols, rows, LIVE_WIDE, { view: pageView, onKey })
    expect(d1.rows.length).toBe(rows)
    expect(d1.rows.slice(rows - 2 - goldOpen.length, rows - 2)).toEqual(goldOpen)
    expect(flatFake(d1.zBtn as FakeNode)).toBe('收合替你決定')

    // Collapse via z
    d1.zBtn!.props.onPress()
    const d2 = drawReviewPane(cols, rows, LIVE_WIDE, { view: pageView, onKey })
    expect(d2.rows.length).toBe(rows)
    expect(d2.rows.some(r => r.startsWith('── 替你決定的事 2（z 展開）'))).toBe(true)
    expect(d2.rows.some(r => r.includes('01M7N33J') || r.includes('01M7N2YJ'))).toBe(false)
    expect(flatFake(d2.zBtn as FakeNode)).toBe('展開替你決定')

    // Re-expand via z
    d2.zBtn!.props.onPress()
    const d3 = drawReviewPane(cols, rows, LIVE_WIDE, { view: pageView, onKey })
    expect(d3.rows.length).toBe(rows)
    expect(d3.rows.slice(rows - 2 - goldOpen.length, rows - 2)).toEqual(goldOpen)
    expect(flatFake(d3.zBtn as FakeNode)).toBe('收合替你決定')

    const noDecLive = liveSnap({ code: CODE_MOCKUP, qc: QC_MOCKUP, decisions: null, plan: PLAN_MOCKUP })
    const noDec = frameRows(reviewPage, ctxOf(cols, rows, noDecLive), { pages: PAGES }).map(text)
    expect(noDec.length).toBe(rows)
    expect(noDec[rows - 2]).toBe('沒有要你處理的事')
  }
})

test('review: negative control — altering one word or glyph breaks golden equality', () => {
  const got = reviewPage.render(ctxOf(80, 24, LIVE_NARROW)).body.map(text)
  const mutated = GOLD_80_OPEN_BODY.slice()
  mutated[1] = '▸g1 f55289ca google✓ xai✗ ▲HEAD 不同'
  expect(got).not.toEqual(mutated)
})

test('review: fixed height = H, actions <= A, row width <= cols, and overflow ends in ↓ 還有 N 列 across all sizes and states through real Pane', () => {
  const manyDecisions: NonNullable<LiveSnapshot['detail']['decisions']> = {
    ...DECISIONS_WIDE,
    count: 40,
    rows: Array.from({ length: 40 }, (_, i) => decRow('01M7' + String(i).padStart(4, '0'), '自動決策第 ' + i + ' 項：保持分頁高度固定不推擠分頁列', (i + 1) * MIN)),
  }
  const states: [string, LiveSnapshot | null, ReviewView | undefined][] = [
    ['wide default', LIVE_WIDE, undefined],
    ['wide folded', LIVE_WIDE, { focus: 0, expanded: false }],
    ['narrow default', LIVE_NARROW, undefined],
    ['narrow folded', LIVE_NARROW, { focus: 0, expanded: false }],
    ['empty', LIVE_EMPTY, undefined],
    ['null live', null, undefined],
    ['stale live', liveSnap({ state: 'stale', header: '資料過舊 · watcher 沒有在發佈', code: CODE_MOCKUP }), undefined],
    ['decisions not wired', liveSnap({ decisionsNotWired: true, qc: QC_MOCKUP }), undefined],
    ['many decisions overflow', liveSnap({ code: CODE_MOCKUP, qc: QC_MOCKUP, decisions: manyDecisions, plan: PLAN_MOCKUP }), undefined],
    ['qc owed & open plan', liveSnap({
      code: { ...CODE_MOCKUP, converged: false, seats: [{ id: 's0', family: 'google', status: 'running', verdict: null }] },
      qc: { state: 'owed', range: '4abd667f..HEAD', protected_files_count: 3, evidence: null },
      plan: { ...PLAN_MOCKUP, terminal: false, verdict: 'CONDITIONAL', seats: [{ id: 'a', family: null, status: 'READY' }, { id: 'b', family: null, status: 'running' }] },
    }), undefined],
  ]
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as const) {
    for (const [name, lv, view] of states) {
      const ctx = ctxOf(cols, rows, lv, okConsole())
      const sRows = stripRows(reviewPage, ctx, { pages: PAGES })
      const stripLabel = sRows[sRows.length - 1].find(s => s.press === 'tab:6:review')!.text.replace(/^\d+\s+/, '')
      const raw = renderReview(ctx, view)
      expect(raw.actions.length <= actionRows(rows), `${name}@${cols}x${rows} actions`).toBe(true)
      const paneOut = drawReviewPane(cols, rows, lv, { view: view === undefined ? {} : { review: view } })
      expect(paneOut.rows.length, `${name}@${cols}x${rows} height`).toBe(rows)
      for (const r of paneOut.rows) expect(displayWidth(r) <= cols, `${name}@${cols}x${rows} width`).toBe(true)
      expect(paneOut.rows[rows - 1], `${name}@${cols}x${rows} strip last`).toContain(stripLabel)
      if (cols >= 120) expect(paneOut.rows[rows - 1], `${name}@${cols}x${rows} strip full name`).toContain(t('tab.review'))
      if (view?.expanded === false) {
        expect(paneOut.rows.some(r => r.includes('01M7N33J')), `${name}@${cols}x${rows} folded hides rows`).toBe(false)
      }
      if (name === 'many decisions overflow') {
        expect(paneOut.rows[rows - 3], `overflow at ${cols}x${rows}`).toMatch(/^↓ 還有 \d+ 列$/)
      }
    }
  }
  // shortBody mode (H = 7) stays exactly 7 rows without throwing
  const short7 = drawReviewPane(80, 7, LIVE_NARROW)
  expect(short7.rows.length).toBe(7)
})

test('review §5 & A10: missing or stale sources always draw PALETTE.broken red with wrapped reason (never `…`) and never show a healthy empty state', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))

  // Null live source — both when console is null and when console is completely healthy (okConsole)
  for (const con of [null, okConsole()] as const) {
    const noLive = reviewPage.render(ctxOf(80, 24, null, con))
    expect(noLive.body.map(text)).toEqual(['✗ 本席審查資料無來源'])
    expect(noLive.body[0][0].color).toBe(PALETTE.broken)
    const framedNoLive = frameRows(reviewPage, ctxOf(80, 24, null, con), { pages: PAGES }).map(text)
    expect(framedNoLive.some(r => r.includes('還沒有審查紀錄'))).toBe(false)
    expect(framedNoLive.some(r => r.includes('沒有要你處理的事'))).toBe(false)
    expect(framedNoLive[22]).toBe('資料不足，無法判定')
  }

  // Every non-ok live state with zero review records and healthy console shows red reason + 資料不足, never calm empty state
  for (const [st, hdr] of [
    ['stale', '資料過舊 · watcher 沒有在發佈'],
    ['unavailable', '本席 snapshot 尚未發佈'],
    ['no-pointer', '找不到 live-pointer.json'],
    ['no-project', '此目錄尚未接上 autopilot'],
    ['unreadable', ''],
  ] as const) {
    const snap = liveSnap({ state: st, header: hdr })
    const raw = reviewPage.render(ctxOf(80, 24, snap, okConsole()))
    expect(raw.body.length).toBeGreaterThanOrEqual(1)
    for (const r of raw.body) expect(r[0].color).toBe(PALETTE.broken)
    expect(raw.body.map(text).join('')).toContain('✗ 本席審查資料不是最新：' + (hdr !== '' ? hdr : st))
    const framed = frameRows(reviewPage, ctxOf(80, 24, snap, okConsole()), { pages: PAGES }).map(text)
    expect(framed.some(r => r.includes('還沒有審查紀錄'))).toBe(false)
    expect(framed.some(r => r.includes('沒有要你處理的事'))).toBe(false)
    expect(framed[22]).toBe('資料不足，無法判定')
  }

  // Decisions sidecar not wired with healthy console shows red reason + 資料不足, never calm empty state
  const notWiredCtx = ctxOf(80, 24, liveSnap({ decisionsNotWired: true }), okConsole())
  const notWired = reviewPage.render(notWiredCtx)
  expect(notWired.body.map(text)).toEqual(['✗ 替你決定的事：來源未接'])
  expect(notWired.body[0][0].color).toBe(PALETTE.broken)
  const framedNotWired = frameRows(reviewPage, notWiredCtx, { pages: PAGES }).map(text)
  expect(framedNotWired.some(r => r.includes('還沒有審查紀錄'))).toBe(false)
  expect(framedNotWired.some(r => r.includes('沒有要你處理的事'))).toBe(false)
  expect(framedNotWired[22]).toBe('資料不足，無法判定')

  // Long stale reason wraps across rows without `…` truncation
  const longWhy = '資料過舊 · 上次發佈 2026-11-18T03:00:00Z 之後有新變化 · 請執行 autopilot status runs --watch 重新同步本席審查資料'
  const staleCtx = ctxOf(68, 24, liveSnap({ state: 'stale', header: longWhy }), okConsole())
  const staleRaw = reviewPage.render(staleCtx)
  expect(staleRaw.body.length).toBeGreaterThan(1)
  for (const r of staleRaw.body) expect(r[0].color).toBe(PALETTE.broken)
  const framedStale = frameRows(reviewPage, staleCtx, { pages: PAGES }).map(text)
  expect(framedStale.length).toBe(24)
  expect(framedStale.join('').replace(/\s+/g, '')).toContain(('本席審查資料不是最新：' + longWhy).replace(/\s+/g, ''))
  expect(framedStale.filter(r => r.includes('…'))).toEqual([])
  expect(framedStale[22]).toBe('資料不足，無法判定')
})

test('review en locale & aligned HEAD: renders cleanly in English across fold/unfold and omits HEAD warning when code.head matches qc.range', () => {
  const synced = liveSnap({
    code: { ...CODE_MOCKUP, head: '627114b99', at: iso(15 * MIN) },
    qc: QC_MOCKUP,
    decisions: DECISIONS_WIDE,
    plan: PLAN_MOCKUP,
  })
  const wSynced = reviewPage.render(ctxOf(120, 30, synced)).body.map(text)
  expect(wSynced[1]).not.toContain('HEAD')
  expect(wSynced[1].endsWith('15 分前')).toBe(true)

  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as const) {
    const enOut = frameRows(reviewPage, ctxOf(cols, rows, LIVE_WIDE, okConsole(), tEn), { pages: PAGES }).map(text)
    expect(enOut.length).toBe(rows)
    expect(enOut[rows - 2]).toBe('[z] fold decided items')
    const enFolded = drawReviewPane(cols, rows, LIVE_WIDE, { view: { review: { focus: 0, expanded: false } }, tr: tEn })
    expect(flatFake(enFolded.zBtn as FakeNode)).toBe('unfold decided items')
  }
  const enEmpty = frameRows(reviewPage, ctxOf(80, 24, LIVE_EMPTY, okConsole(), tEn), { pages: PAGES }).map(text)
  expect(enEmpty[0]).toBe('Review')
  expect(enEmpty.slice(1, 20).every(r => r === '')).toBe(true)
  expect(enEmpty[20]).toContain('no review records yet')
  // N3: continuation rows hang by two cells; remove only that layout indent to compare the whole message.
  expect(enEmpty[21].startsWith('  ')).toBe(true)
  expect(enEmpty[20] + enEmpty[21].slice(2)).toBe('○ ' + EN['page.review.empty'])
  expect(enEmpty[22]).toBe('Nothing needs you')

  const enMissing = frameRows(reviewPage, ctxOf(80, 24, null, okConsole(), tEn), { pages: PAGES }).map(text)
  expect(enMissing[21]).toContain("this seat's review data has no source")
  expect(enMissing[22]).toBe('Not enough data to judge')
})

test('review G11: every [x] hint in page.review.* is a bound hotkey, and Pane mounts a non-empty hotkey="z" Button matching the z hint', () => {
  const bad: string[] = []
  const bound = pageHotkeys('review')
  for (const [loc, table] of [['en', EN], ['zh-TW', ZH_TW]] as const) {
    for (const [id, val] of Object.entries(table)) {
      if (!id.startsWith('page.review.')) continue
      for (const m of val.matchAll(/\[([^\]\s]+)\]/g)) {
        if (m[1] === 'Esc' || m[1].includes('{')) continue
        if (!bound.includes(m[1])) bad.push(`${loc} ${id} [${m[1]}]`)
      }
    }
  }
  expect(bad).toEqual([])

  for (const [cols, rows, snap] of [[160, 40, LIVE_WIDE], [120, 30, LIVE_WIDE], [80, 24, LIVE_NARROW]] as const) {
    const keys: unknown[] = []
    const drawn = drawReviewPane(cols, rows, snap, { onKey: k => keys.push(k) })
    expect(drawn.zBtn, `z Button mounted at ${cols}x${rows}`).toBeDefined()
    expect(flatFake(drawn.zBtn as FakeNode)).toBe('收合替你決定')
    drawn.zBtn!.props.onPress()
    expect(keys).toEqual([{ kind: 'fold' }])
    expect(drawn.tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flatFake(n).trim() === '')).toEqual([])
  }

  // Empty state has no `z` hint text and mounts no `z` Button
  const emptyDrawn = drawReviewPane(80, 24, LIVE_EMPTY)
  expect(emptyDrawn.zBtn).toBeUndefined()
})

// ---- End-to-end mounted production plugin test (real register.ts + pageView + frameKey + Pane) ----
type MountedNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const mountedText = (n: MountedNode): string =>
  (n.type === 'Link' || n.type === 'Button') && typeof n.props?.label === 'string'
    ? (n.props.label as string)
    : (n.children || []).map(c => (typeof c === 'string' ? c : mountedText(c as MountedNode))).join('')

const mountedRowsOf = (tree: MountedNode): string[] => {
  const out: string[] = []
  const walk = (n: MountedNode) => {
    for (const c of (n.children || []) as MountedNode[]) {
      if (typeof c === 'string') continue
      if (/^f\d+$/.test(String(c.props?.key))) {
        const s = mountedText(c)
        out.push(s === ' ' ? '' : s)
      } else walk(c)
    }
  }
  walk(tree)
  return out
}

const mountedColorsOf = (tree: MountedNode, out: string[] = []): string[] => {
  if (typeof tree.props?.color === 'string') out.push(tree.props.color)
  for (const c of (tree.children || []) as MountedNode[]) {
    if (c && typeof c === 'object') mountedColorsOf(c, out)
  }
  return out
}

test('review mounted production: z collapses and re-expands across real plugin renders, ticks, and tab switches; missing source shows red error and 資料不足', async ($, on: On) => {
  const HOME = '/fake/home'
  const AHOME = HOME + '/.autopilot'
  const LIVE = '/fake/live'
  const REPO = '/work/repo'
  const CWD = REPO + '/sub'
  const KEY = '0000000000000006'
  const ROOT = 'root-review'
  const SID = 'sid-review'
  const files: Record<string, string> = {
    [AHOME + '/live-pointer.json']: JSON.stringify({ schema: 'autopilot.live-pointer/1', live_base: LIVE, autopilot_home: AHOME }),
    [AHOME + '/session-mode/' + SID + '.json']: JSON.stringify({
      project_key: KEY,
      root_run_id: ROOT,
      expires_at: new Date(NOW + 3600_000).toISOString(),
    }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.json']: JSON.stringify({
      schema: 'autopilot.runs-live/1',
      published_at: new Date(NOW - 5_000).toISOString(),
      valid_for_s: 180,
      writer: { pid: 42 },
      scope: { project_key: KEY, root_run_id: ROOT, repo_identity: 'git-common-dir:' + REPO + '/.git' },
      counts: { confirmed_live: 0, exited: 1, unknown: 0, fresh_bound_s: 180 },
      runs: [],
    }),
    [LIVE + '/runs/' + KEY + '.review.json']: JSON.stringify({
      schema: 'autopilot.review/1',
      project_key: KEY,
      code: CODE_MOCKUP,
      plan: PLAN_MOCKUP,
    }),
    [LIVE + '/runs/' + KEY + '.qc.json']: JSON.stringify({
      schema: 'autopilot.qc-status/1',
      scope: { project_key: KEY, root_run_id: null },
      ...QC_MOCKUP,
    }),
    [LIVE + '/runs/' + KEY + '--' + ROOT + '.decisions.json']: JSON.stringify({
      schema: 'autopilot.decisions-sidecar/1',
      scope: { project_key: KEY, root_run_id: ROOT, repo_identity: 'git-common-dir:' + REPO + '/.git' },
      count: 2,
      irreversible_count: 0,
      undocumented_dispatches: 0,
      writers_wired: ['pm'],
      rows: DECISIONS_NARROW.rows,
    }),
  }
  const env: Record<string, string | undefined> = { HOME, AUTOPILOT_LOCALE: 'zh-TW' }
  const clock = mock.clock(on, { now: NOW })
  let invalidates = 0

  const listDir = (dirPath: string) => {
    const prefix = dirPath.replace(/\/$/, '') + '/'
    const seen = new Map<string, 'file' | 'dir'>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) seen.set(rest, 'file')
      else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), 'dir')
    }
    if (seen.size === 0) throw new Error('ENOENT ' + dirPath)
    return [...seen].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false as const }))
  }
  const statPath = (p: string, resolve?: boolean) => {
    if (files[p] !== undefined) return { kind: 'file' as const, isLink: false as const, size: files[p].length, mtimeMs: 0 }
    const prefix = p.replace(/\/$/, '') + '/'
    if (p === CWD || p === REPO || Object.keys(files).some(k => k.startsWith(prefix))) {
      return { kind: 'dir' as const, isLink: false as const, size: 0, mtimeMs: 0, realPath: resolve ? p : undefined }
    }
    throw new Error('ENOENT ' + p)
  }

  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('fs.read', (_$, e) => {
    const v = files[e.path]
    if (v === undefined) throw new Error('ENOENT ' + e.path)
    return { value: v }
  })
  on('fs.exists', (_$, e) => ({ value: files[e.path] !== undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', (_$, e) => ({ value: listDir(e.path) }))
  on('fs.stat', (_$, e) => ({ value: statPath(e.path, e.resolve) }))
  on('config.list', () => ({ value: [] }))
  on('session.id', () => ({ value: SID }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.root', () => ({ value: REPO }))
  on('session.start', () => ({ cwd: CWD }))
  on('session.end', () => ({ sessionId: SID }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.invalidate', () => { invalidates += 1; return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false as const, isStderrTruncated: false as const } }))

  const mountPane = (cols = 80, bodyRows = 24) => $.ui.mount({
    plugin: 'autopilot',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'autopilot-live',
    props: { title: 'Autopilot', isFocused: true, bodyColumns: cols, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: { agentId: undefined } },
    viewport: { columns: Math.max(cols, 160), rows: Math.max(bodyRows + 10, 50), isFullscreen: true },
  })

  await $.session.start({ surface: 'terminal', cwd: CWD })

  // Switch to page 6 (review)
  const first = await mountPane(80, 24)
  await first.press({ key: 'review' })
  await first.unmount()

  // 1. Default open render at 80x24
  const openPane = await mountPane(80, 24)
  const openTree = (await openPane.drawn()) as MountedNode
  const openRows = mountedRowsOf(openTree)
  expect(openRows.length).toBe(24)
  expect(openRows[0]).toBe('審查')
  expect(openRows.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  const openBtns = (await openPane.findAll({ type: 'Button' })) as MountedNode[]
  const zBtnOpen = openBtns.find(b => b.props?.hotkey === 'z')
  expect(zBtnOpen).toBeDefined()
  expect(mountedText(zBtnOpen as MountedNode)).toBe('收合替你決定')

  // 2. Press z -> collapse; state is stored in register.ts pageView and rerenders folded
  const invBeforeFold = invalidates
  await openPane.press({ key: String(zBtnOpen!.props?.key) })
  await clock.advance(0)
  await openPane.unmount()
  expect(invalidates).toBeGreaterThan(invBeforeFold)

  const foldedPane = await mountPane(80, 24)
  const foldedRows = mountedRowsOf((await foldedPane.drawn()) as MountedNode)
  expect(foldedRows.length).toBe(24)
  expect(foldedRows.slice(17, 22)).toEqual(GOLD_80_FOLDED_BODY)
  expect(foldedRows.some(r => r.includes('01M7N33J') || r.includes('01M7N2YJ'))).toBe(false)
  const zBtnFolded = ((await foldedPane.findAll({ type: 'Button' })) as MountedNode[]).find(b => b.props?.hotkey === 'z')
  expect(zBtnFolded).toBeDefined()
  expect(mountedText(zBtnFolded as MountedNode)).toBe('展開替你決定')
  await foldedPane.unmount()

  // 3. Fold state survives across a 5s liveTick refresh, a tab switch (review -> now -> review), and a 160x40 wide render
  await clock.advance(5_000)
  const tabAway = await mountPane(80, 24)
  await tabAway.press({ key: 'now' })
  await tabAway.unmount()
  const tabBack = await mountPane(80, 24)
  await tabBack.press({ key: 'review' })
  await tabBack.unmount()

  const stillFolded80 = await mountPane(80, 24)
  expect(mountedRowsOf((await stillFolded80.drawn()) as MountedNode).slice(17, 22)).toEqual(GOLD_80_FOLDED_BODY)
  await stillFolded80.unmount()

  const stillFolded160 = await mountPane(160, 40)
  const wideFoldedRows = mountedRowsOf((await stillFolded160.drawn()) as MountedNode)
  expect(wideFoldedRows.length).toBe(40)
  expect(wideFoldedRows.some(r => r.startsWith('── 替你決定的事 2（z 展開）'))).toBe(true)
  expect(wideFoldedRows.some(r => r.includes('01M7N33J'))).toBe(false)
  const zBtnWideFolded = ((await stillFolded160.findAll({ type: 'Button' })) as MountedNode[]).find(b => b.props?.hotkey === 'z')
  expect(mountedText(zBtnWideFolded as MountedNode)).toBe('展開替你決定')

  // 4. Press z a second time -> re-expands back to open in production
  await stillFolded160.press({ key: String(zBtnWideFolded!.props?.key) })
  await clock.advance(0)
  await stillFolded160.unmount()

  const reopenedPane = await mountPane(80, 24)
  const reopenedRows = mountedRowsOf((await reopenedPane.drawn()) as MountedNode)
  expect(reopenedRows.length).toBe(24)
  expect(reopenedRows.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  const zBtnReopened = ((await reopenedPane.findAll({ type: 'Button' })) as MountedNode[]).find(b => b.props?.hotkey === 'z')
  expect(mountedText(zBtnReopened as MountedNode)).toBe('收合替你決定')
  await reopenedPane.unmount()

  // 5. Missing live-pointer source on next tick shows PALETTE.broken red reason wrapped without `…` and 資料不足，無法判定 (never healthy empty state)
  delete files[AHOME + '/live-pointer.json']
  await clock.advance(5_000)

  const missingPane = await mountPane(80, 24)
  const missingTree = (await missingPane.drawn()) as MountedNode
  const missingRows = mountedRowsOf(missingTree)
  expect(missingRows.length).toBe(24)
  expect(missingRows.join('')).toContain('✗ 本席審查資料不是最新：')
  expect(missingRows.filter(r => r.includes('…'))).toEqual([])
  expect(missingRows.some(r => r.includes('還沒有審查紀錄'))).toBe(false)
  expect(missingRows.some(r => r.includes('沒有要你處理的事'))).toBe(false)
  expect(missingRows[22]).toBe('資料不足，無法判定')
  expect(mountedColorsOf(missingTree)).toContain(PALETTE.broken)
  await missingPane.unmount()
})
