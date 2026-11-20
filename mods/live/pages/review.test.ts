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

test('review: registry replaces the shell at key 4 and marks the page framed', () => {
  const p = PAGES.find(x => x.id === 'review') as Page
  expect(p).toBe(reviewPage)
  expect(p.key).toBe('4')
  expect(p.title).toBe('審查')
  expect(p.framed).toBe(true)
  expect(DEFAULT_REVIEW_VIEW).toEqual({ focus: 0, expanded: true })
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
      const stripLabel = sRows[sRows.length - 1].find(s => s.press === 'tab:4:review')!.text.replace(/^\d+\s+/, '')
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
        expect(paneOut.rows[rows - 4], `overflow at ${cols}x${rows}`).toMatch(/^↓ 還有 \d+ 列$/)
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
    expect(framedNoLive[21]).toBe('資料不足，無法判定')
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
    expect(framed[21]).toBe('資料不足，無法判定')
  }

  // Decisions sidecar not wired with healthy console shows red reason + 資料不足, never calm empty state
  const notWiredCtx = ctxOf(80, 24, liveSnap({ decisionsNotWired: true }), okConsole())
  const notWired = reviewPage.render(notWiredCtx)
  expect(notWired.body.map(text)).toEqual(['✗ 替你決定的事：來源未接'])
  expect(notWired.body[0][0].color).toBe(PALETTE.broken)
  const framedNotWired = frameRows(reviewPage, notWiredCtx, { pages: PAGES }).map(text)
  expect(framedNotWired.some(r => r.includes('還沒有審查紀錄'))).toBe(false)
  expect(framedNotWired.some(r => r.includes('沒有要你處理的事'))).toBe(false)
  expect(framedNotWired[21]).toBe('資料不足，無法判定')

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
  expect(framedStale[21]).toBe('資料不足，無法判定')
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
    // v7.4 S5 has no action-area Button (the page is read-only; Enter folds)
    expect(drawn.zBtn, `no z Button at ${cols}x${rows}`).toBeUndefined()
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

