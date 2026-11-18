// mods/live/pages/review.test.ts — page 6 審查 (plan r2 §2 row 6, §3.1, §3.2, §5; Fleet-Task 01M7PC93PGG8FQ28EMT6ZDP7NY):
// Golden tests against all 6 codeforge r2 mockups at 160x40, 120x30 and 80x24 through frameRows,
// fixed-height invariant (= H), fold/unfold pair on z, empty state, overflow row (↓ 還有 N 列),
// wrapped broken/stale source rows without truncation (A10), and matching hotkey Button checks (G11).
import { test, expect } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane, pageHotkeys } from '../pane'
import { EN, ZH_TW } from '../locales'
import { makeT } from '../i18n'
import { NO_DETAIL, NO_SECTIONS, displayWidth } from '../model'
import type { DecisionRow, LiveSnapshot } from '../model'
import type { ConsoleSnapshot } from '../console'
import { PALETTE } from '../ui'
import { PAGES } from './index'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge } from './frame'
import type { Page, Row } from './frame'
import { routeKey } from './keys'
import { brokenRow, staleBadge } from './rows'
import { DEFAULT_REVIEW_VIEW, renderReview, reviewPage, reviewReduce } from './review'
import type { ReviewPageCtx, ReviewPageView } from './review'

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

const ctxOf = (cols: number, rows: number, live: LiveSnapshot | null, con: ConsoleSnapshot | null = okConsole(), review?: ReviewPageView, tr = t): ReviewPageCtx => ({
  live,
  console: con,
  size: { cols, rows },
  t: tr,
  nowMs: NOW,
  ...(review === undefined ? {} : { review }),
})

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

test('review golden 80x24: default open, folded (折疊關), unfolded (折疊開), and empty state (沒有任何紀錄) match the mockups', () => {
  // Mockup 3: 80x24 default open
  const c80 = ctxOf(80, 24, LIVE_NARROW)
  const f80 = frameRows(reviewPage, c80, { pages: PAGES }).map(text)
  expect(f80.length).toBe(24)
  expect(f80[0]).toBe('審查')
  expect(f80.slice(1, 15).every(r => r === '')).toBe(true)
  expect(f80.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  expect(f80[22]).toBe('[z] 收合替你決定')
  expect(f80[23]).toContain('6')

  // Mockup 4: 80x24 折疊關（替你決定） via z key
  const zKey = routeKey('z', { page: 'review', paneFocus: true, focusedButton: false, textMode: false })
  expect(zKey).toEqual({ kind: 'fold' })
  const closedView = reviewReduce(DEFAULT_REVIEW_VIEW, zKey)
  expect(closedView.folded).toBe(true)
  const c80Folded = ctxOf(80, 24, LIVE_NARROW, okConsole(), closedView)
  const f80Folded = frameRows(reviewPage, c80Folded, { pages: PAGES }).map(text)
  expect(f80Folded.length).toBe(24)
  expect(f80Folded[0]).toBe('審查')
  expect(f80Folded.slice(1, 17).every(r => r === '')).toBe(true)
  expect(f80Folded.slice(17, 22)).toEqual(GOLD_80_FOLDED_BODY)
  expect(f80Folded[22]).toBe('[z] 展開替你決定')

  // Mockup 5: 80x24 折疊開（替你決定） via second z key
  const reopenedView = reviewReduce(closedView, zKey)
  expect(reopenedView.folded).toBe(false)
  const f80Reopened = frameRows({ ...reviewPage, render: c => renderReview(c, reopenedView) }, c80, { pages: PAGES }).map(text)
  expect(f80Reopened.length).toBe(24)
  expect(f80Reopened.slice(15, 22)).toEqual(GOLD_80_OPEN_BODY)
  expect(f80Reopened[22]).toBe('[z] 收合替你決定')

  // Mockup 6: 80x24 沒有任何紀錄
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

test('review: fold pair at 160x40 and 120x30 hides and restores decision rows while keeping height = H; no-decisions wide state shows 沒有要你處理的事', () => {
  for (const [cols, rows] of [[160, 40], [120, 30]] as const) {
    const folded = frameRows(reviewPage, ctxOf(cols, rows, LIVE_WIDE, okConsole(), { folded: true }), { pages: PAGES }).map(text)
    expect(folded.length).toBe(rows)
    expect(folded.some(r => r.startsWith('── 替你決定的事 2（z 展開）'))).toBe(true)
    expect(folded.some(r => r.includes('01M7N33J'))).toBe(false)
    expect(folded[rows - 2]).toBe('[z] 展開替你決定')

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

test('review: fixed height = H, actions <= A, row width <= cols, and overflow ends in ↓ 還有 N 列 across all sizes and states', () => {
  const manyDecisions: NonNullable<LiveSnapshot['detail']['decisions']> = {
    ...DECISIONS_WIDE,
    count: 40,
    rows: Array.from({ length: 40 }, (_, i) => decRow('01M7' + String(i).padStart(4, '0'), '自動決策第 ' + i + ' 項：保持分頁高度固定不推擠分頁列', (i + 1) * MIN)),
  }
  const states: [string, LiveSnapshot | null, ReviewPageView | undefined][] = [
    ['wide default', LIVE_WIDE, undefined],
    ['wide folded', LIVE_WIDE, { folded: true }],
    ['narrow default', LIVE_NARROW, undefined],
    ['narrow folded', LIVE_NARROW, { folded: true }],
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
      const ctx = ctxOf(cols, rows, lv, okConsole(), view)
      const raw = reviewPage.render(ctx)
      expect(raw.actions.length <= actionRows(rows), `${name}@${cols}x${rows} actions`).toBe(true)
      const framed = frameRows(reviewPage, ctx, { pages: PAGES })
      expect(framed.length, `${name}@${cols}x${rows} height`).toBe(rows)
      for (const r of framed) expect(displayWidth(text(r)) <= cols, `${name}@${cols}x${rows} width`).toBe(true)
      expect(text(framed[rows - 1]), `${name}@${cols}x${rows} strip last`).toMatch(/1\D*2\D*3\D*4\D*5\D*6/)
      if (name === 'many decisions overflow') {
        expect(text(framed[rows - 3]), `overflow at ${cols}x${rows}`).toMatch(/^↓ 還有 \d+ 列$/)
      }
    }
  }
  // shortBody mode (H = 7) stays exactly 7 rows without throwing
  const short7 = frameRows(reviewPage, ctxOf(80, 7, LIVE_NARROW), { pages: PAGES })
  expect(short7.length).toBe(7)
})

test('review §5 & A10: missing or stale sources draw in PALETTE.broken red and wrap without `…` truncation', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))

  const noLive = reviewPage.render(ctxOf(80, 24, null, null))
  expect(noLive.body.map(text)).toEqual(['✗ 本席審查資料無來源'])
  expect(noLive.body[0][0].color).toBe(PALETTE.broken)
  expect(frameRows(reviewPage, ctxOf(80, 24, null, null), { pages: PAGES }).map(text)[22]).toBe('資料不足，無法判定')

  const notWired = reviewPage.render(ctxOf(80, 24, liveSnap({ decisionsNotWired: true })))
  expect(notWired.body.map(text)).toEqual(['✗ 替你決定的事：來源未接'])
  expect(notWired.body[0][0].color).toBe(PALETTE.broken)

  const longWhy = '資料過舊 · 上次發佈 2026-11-18T03:00:00Z 之後有新變化 · 請執行 autopilot status runs --watch 重新同步本席審查資料'
  const staleCtx = ctxOf(68, 24, liveSnap({ state: 'stale', header: longWhy }), okConsole())
  const staleRaw = reviewPage.render(staleCtx)
  expect(staleRaw.body.length).toBeGreaterThan(1)
  for (const r of staleRaw.body) expect(r[0].color).toBe(PALETTE.broken)
  const framedStale = frameRows(reviewPage, staleCtx, { pages: PAGES }).map(text)
  expect(framedStale.length).toBe(24)
  expect(framedStale.join('').replace(/\s+/g, '')).toContain(('本席審查資料不是最新：' + longWhy).replace(/\s+/g, ''))
  expect(framedStale.filter(r => r.includes('…'))).toEqual([])
})

test('review en locale & aligned HEAD: renders cleanly in English and omits HEAD warning when code.head matches qc.range', () => {
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
    const enOut = frameRows(reviewPage, ctxOf(cols, rows, LIVE_WIDE, okConsole(), undefined, tEn), { pages: PAGES }).map(text)
    expect(enOut.length).toBe(rows)
    expect(enOut[rows - 2]).toBe('[z] fold decided items')
  }
  const enEmpty = frameRows(reviewPage, ctxOf(80, 24, LIVE_EMPTY, okConsole(), undefined, tEn), { pages: PAGES }).map(text)
  expect(enEmpty[21]).toContain('no review records yet')
  expect(enEmpty[22]).toBe('Nothing needs you')
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

  type Node = { kind: string; props: Record<string, any> }
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props })
  const EL = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Link: mk('Link'), Input: mk('Input') }
  const walk = (n: any, out: Node[] = []): Node[] => {
    if (n == null || n === false || typeof n !== 'object') return out
    if (Array.isArray(n)) { n.forEach(c => walk(c, out)); return out }
    if (n.kind !== undefined) out.push(n)
    walk(n.props?.children, out)
    return out
  }
  const flat = (n: Node): string => {
    const c = n.props.children
    return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flat(x) : '')).join('') : c?.props ? flat(c) : ''
  }

  for (const [cols, rows, snap] of [[160, 40, LIVE_WIDE], [120, 30, LIVE_WIDE], [80, 24, LIVE_NARROW]] as const) {
    const keys: unknown[] = []
    const tree = walk(Pane(EL as never, snap, 'review', () => {}, t, cols, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
      pages: PAGES,
      pageId: 'review',
      console: okConsole(),
      nowMs: NOW,
      rows,
      onKey: k => keys.push(k),
    }))
    const zBtn = tree.find(n => n.kind === 'Button' && n.props.hotkey === 'z')
    expect(zBtn, `z Button mounted at ${cols}x${rows}`).toBeDefined()
    expect(flat(zBtn as Node)).toBe('收合替你決定')
    zBtn!.props.onPress()
    expect(keys).toEqual([{ kind: 'fold' }])
    expect(tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flat(n).trim() === '')).toEqual([])
  }

  // Empty state has no `z` hint text and mounts no `z` Button
  const emptyTree = walk(Pane(EL as never, LIVE_EMPTY, 'review', () => {}, t, 80, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, {
    pages: PAGES,
    pageId: 'review',
    console: okConsole(),
    nowMs: NOW,
    rows: 24,
  }))
  expect(emptyTree.find(n => n.kind === 'Button' && n.props.hotkey === 'z')).toBeUndefined()
})
