// mods/live/pages/spend.test.ts — page 7 花費 (plan r2 §2 row 7, §3.1, §5): golden rows at 160x40, 120x30, 80x24 and 80x24 stale,
// fixed height H across every size and state, fold pair (collapsed / expanded) + overflow row, red stale/no-source wrapping, [4] & [z] Buttons, and empty states.
import { test, expect } from 'claude-code/testing'
import { FOCUS_ANCHOR_KEY, Pane } from '../pane'
import { makeT } from '../i18n'
import * as M from '../model'
import { displayWidth } from '../model'
import { GLYPHS, PALETTE } from '../ui'
import type { ConsoleSnapshot } from '../console'
import { actionRows, brokenRow as frameBroken, frameRows, staleBadge as frameBadge } from './frame'
import type { Page, PageCtx, Row } from './frame'
import { PAGES } from './index'
import { seatQuota } from './now'
import { brokenRow, staleBadge } from './rows'
import { spendPage, spendView } from './spend'

const t = makeT('zh-TW')
const MIN = 60_000
// 2026-11-18 12:00 Taipei (Wednesday); resets at 03:40 Taipei and 2026-11-21 (Saturday) 12:00 Taipei
const NOW = Date.UTC(2026, 10, 18, 4, 0, 0)
const RESET_5H = Date.UTC(2026, 10, 18, 19, 40, 0)
const RESET_7D = Date.UTC(2026, 10, 21, 4, 0, 0)

const HOURLY_WIDE = [0, 0, 1, 2, 4, 1, 0, 0, 0, 1, 1, 2, 0, 0, 0, 0, 1, 4, 7, 2, 1, 0, 0, 0]
const HOURLY_NARROW = [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 1, 0, 1, 4, 6, 2]
const SEAT_JSON = JSON.stringify([
  { seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: 17.4, seven_day_pct: 68.2, stale: false, self: true },
  { seat: 'other--claude', pool_key: 'personal', five_hour_pct: 5, seven_day_pct: 20, stale: false, self: false },
])

const okRun = (stdout: string) => async () => ({ exitCode: 0, stdout })
const failRun = async () => ({ exitCode: 1, stdout: '' })
const text = (row: { text: string }[]): string => row.map(s => s.text).join('')

function calmConsole(over: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot {
  const okSrc = { at_ms: NOW - 12_000, state: 'ok' as const }
  return {
    generated_at_ms: NOW - 12_000,
    sources: {
      tasks: okSrc,
      hosts: okSrc,
      cards: okSrc,
      quota_now: { at_ms: NOW - 40_000, state: 'ok' as const },
      quota_forecast: { at_ms: NOW - 40_000, state: 'ok' as const },
    },
    counts: {
      decisions: 0,
      exceptions: 0,
      quota_risk: 0,
      tabs: {},
      summary: { lines: { running: 2, waiting: 4, stalled: 0 }, hosts: { online: 4, total: 4 }, hints: 0, quota_worst: null },
    },
    items: [],
    cards: [],
    lines: [],
    quota: {
      pools: [{
        pool: 'team',
        seven_day_pct: 68,
        five_hour_pct: 17,
        resets_at_ms: RESET_7D,
        burn_pct_per_h: 1.4,
        burn_window_h: 6,
        projected_pct_at_reset: 98,
        projected_exhaustion_at_ms: null,
        seat_count: 3,
        limit_hit: false,
        stale: false,
        stale_age_min: null,
        stale_note: null,
        observed_at_ms: NOW - 40_000,
        stranded_seats: 0,
        switched: null,
        switch_suggestion: null,
      }],
      seats: [],
    },
    ...over,
  } as ConsoleSnapshot
}

function liveOf(hourly: number[] | null = HOURLY_WIDE, over: Record<string, unknown> = {}): M.LiveSnapshot {
  return {
    state: 'ok',
    text: '',
    header: '',
    band: null,
    pending: [],
    project_key: 'plan/shared-tui',
    root_run_id: null,
    link: null,
    rows: [],
    gates: null,
    sections: M.NO_SECTIONS,
    review: null,
    published_at: null,
    watcher_note: null,
    session_as_of: null,
    host_as_of: null,
    detail: {
      ...M.NO_DETAIL,
      now_ms: NOW,
      project: 'plan/shared-tui',
      spend: { session: '$3.10', host_all: '', host_all_n: null, brain: null, cap: null, mode: 'warn', hourly },
    },
    account: {
      account: undefined,
      quota: [
        { kind: 'five_hour', pct: 17.4, resetsAtMs: RESET_5H },
        { kind: 'seven_day', pct: 68.2, resetsAtMs: RESET_7D },
      ],
    },
    ...over,
  } as unknown as M.LiveSnapshot
}

const ctxOf = (cols: number, rows: number, con: ConsoleSnapshot | null = calmConsole(), live: M.LiveSnapshot | null = liveOf()): PageCtx => ({
  live,
  console: con,
  size: { cols, rows },
  t,
  nowMs: NOW,
})

async function feedFresh(): Promise<void> {
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 40_000)
}

async function feedStale25m(): Promise<void> {
  seatQuota.reset()
  await seatQuota.refresh(okRun(SEAT_JSON), NOW - 25 * MIN)
  await seatQuota.refresh(failRun, NOW - 10_000)
}

const GOLD_WIDE_BODY = [
  '── 本席 codeforge--claude（seats --quota 那一列，40 秒前；池 team）──',
  '▸ 5 小時  ▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  17%    重置 03:40',
  '  7 天    ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱  68%    重置 11-21 週六 12:00',
  '  今天    $3.10 · 近 24 小時 ▁▁▂▃▅▂▁▁▁▂▂▃▁▁▁▁▂▅█▃▂▁▁▁',
  '',
  '  額度看 [4]',
]

const GOLD_80_BODY = [
  '── 本席（池 team，40 秒前）──',
  '▸5時 ▰▰▱▱▱▱▱▱▱▱ 17% 重置 03:40',
  ' 7天 ▰▰▰▰▰▰▰▱▱▱ 68% 重置 週六',
  ' 今天 $3.10 ▁▂▃▅▂▁▂▅▇▃',
  ' 額度看 [4]',
]

const GOLD_80_STALE_BODY = [
  '── 本席（池 team）──',
  '▸5時 ▰▰▱▱▱▱▱▱▱▱ 17% ✗ 重置 03:40',
  ' 7天 ▰▰▰▰▰▰▰▱▱▱ 68% ✗ 重置 週六',
  ' ✗ 25 分未更新，以上是舊數字',
  ' 今天 $3.10 ▁▂▃▅▂▁▂▅▇▃',
  ' 額度看 [4]',
]

const diffRows = (got: string[], want: string[]): string[] => {
  const bad: string[] = []
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) bad.push(`#${i} got ${JSON.stringify(got[i])} want ${JSON.stringify(want[i])}`)
  }
  return bad
}

test('spend: registry places framed spendPage at key 7 with title 花費', () => {
  const entry = PAGES.find(p => p.id === 'spend')
  expect(entry).toBe(spendPage)
  expect(spendPage.framed).toBe(true)
  expect(spendPage.key).toBe('7')
  expect(spendPage.title).toBe('花費')
})

test('spend golden: 160x40, 120x30, 80x24 and 80x24 stale match the four mockups row for row with fixed height H', async () => {
  // 1. 160x40 (header 1 + blank gap 31 + body 6 + calm empty state 1 + strip 1 = 40)
  await feedFresh()
  const out160 = frameRows(spendPage, ctxOf(160, 40)).map(text)
  expect(out160.length).toBe(40)
  expect(out160[0]).toBe('花費')
  expect(out160.slice(1, 32).every(r => r === '')).toBe(true)
  expect(diffRows(out160.slice(32, 38), GOLD_WIDE_BODY)).toEqual([])
  expect(out160[38]).toBe('沒有要你處理的事')
  expect(out160[39]).toContain('7 花費')
  expect(out160[39]).toContain('i 說明  Esc 收起')

  // 2. 120x30 (header 1 + blank gap 21 + body 6 + calm empty state 1 + strip 1 = 30)
  const out120 = frameRows(spendPage, ctxOf(120, 30)).map(text)
  expect(out120.length).toBe(30)
  expect(out120[0]).toBe('花費')
  expect(out120.slice(1, 22).every(r => r === '')).toBe(true)
  expect(diffRows(out120.slice(22, 28), GOLD_WIDE_BODY)).toEqual([])
  expect(out120[28]).toBe('沒有要你處理的事')
  expect(out120[29]).toContain('7 花費')

  // 3. 80x24 fresh (header 1 + blank gap 16 + body 5 + calm empty state 1 + strip 1 = 24)
  const raw80 = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW)))
  const out80 = raw80.map(text)
  expect(out80.length).toBe(24)
  expect(out80[0]).toBe('花費')
  expect(out80.slice(1, 17).every(r => r === '')).toBe(true)
  expect(diffRows(out80.slice(17, 22), GOLD_80_BODY)).toEqual([])
  expect(out80[22]).toBe('沒有要你處理的事')
  expect(out80[23]).toContain('7 花')
  expect(raw80[23].find(s => s.press === 'tab:7:spend')?.color).toBe(PALETTE.here)

  // 4. 80x24 stale own-seat quota (header 1 + blank gap 15 + body 6 + calm empty state 1 + strip 1 = 24)
  await feedStale25m()
  const rawStale = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW)))
  const out80Stale = rawStale.map(text)
  expect(out80Stale.length).toBe(24)
  expect(out80Stale.slice(1, 16).every(r => r === '')).toBe(true)
  expect(diffRows(out80Stale.slice(16, 22), GOLD_80_STALE_BODY)).toEqual([])
  expect(out80Stale[22]).toBe('沒有要你處理的事')
  // Stale marks and warning row use PALETTE.broken, no background, no inverse, no bold
  const warningRow = rawStale[19]
  expect(warningRow[0].color).toBe(PALETTE.broken)
  expect(rawStale[17].some(s => s.text.includes(GLYPHS.state.failed) && s.color === PALETTE.broken)).toBe(true)
  expect(rawStale[18].some(s => s.text.includes(GLYPHS.state.failed) && s.color === PALETTE.broken)).toBe(true)
  for (const r of rawStale) {
    for (const s of r as (M.Seg & { background?: unknown; inverse?: unknown })[]) {
      expect(s.background).toBeUndefined()
      expect(s.inverse).toBeUndefined()
      expect(s.bold).toBeUndefined()
    }
  }
})

test('spend: negative control confirms diffRows reports planted golden drift', async () => {
  await feedFresh()
  const out80 = frameRows(spendPage, ctxOf(80, 24, calmConsole(), liveOf(HOURLY_NARROW))).map(text)
  const mutated = GOLD_80_BODY.slice()
  mutated[1] = '▸5時 ▰▰▱▱▱▱▱▱▱▱ 18% 重置 03:40'
  expect(diffRows(out80.slice(17, 22), mutated).length).toBe(1)
})

test('spend: fold pair (collapsed vs expanded) reveals exact stated detail count, binds [z] Button, and overflows into ↓ 還有 N 列 when tall', async () => {
  await feedFresh()
  const richLive = liveOf(HOURLY_WIDE, {
    detail: {
      ...M.NO_DETAIL,
      now_ms: NOW,
      project: 'plan/shared-tui',
      spend: { session: '$3.10', host_all: '$12.40', host_all_n: 12.4, brain: 8.2, cap: 50, mode: 'warn', hourly: HOURLY_WIDE },
    },
    account: {
      account: { email: 'dev@example.com', name: 'Dev', org: 'TeamOrg', role: 'member', plan: 'claude max · 20x', extraUsage: true },
      quota: [
        { kind: 'five_hour', pct: 17.4, resetsAtMs: RESET_5H },
        { kind: 'seven_day', pct: 68.2, resetsAtMs: RESET_7D },
        { kind: 'spend_limit', pct: 85, resetsAtMs: RESET_7D },
      ],
    },
  })

  const viewPage = (expanded: boolean, focus = 0): Page => ({ ...spendPage, render: c => spendView(c, { focus, expanded }) })

  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as const) {
    const ctx = ctxOf(cols, rows, calmConsole(), richLive)
    const collapsed = viewPage(false).render(ctx)
    const expanded = viewPage(true).render(ctx)
    expect(collapsed.actions).toEqual([])
    expect(expanded.actions).toEqual([])

    const foldLine = collapsed.body.map(text).find(l => l.includes('[z]'))
    expect(foldLine).toBeDefined()
    const stated = Number(/（(\d+) 列）/.exec(foldLine ?? '')?.[1] ?? -1)
    expect(stated).toBe(5) // spend_limit + brain cap + host split + 24h sum/peak + account
    expect(expanded.body.length - collapsed.body.length).toBe(stated)
    expect(expanded.body.map(text).some(l => l.includes('[z] 收合明細'))).toBe(true)
    expect(expanded.body.map(text).some(l => l.includes('brain') && l.includes('$8.20 / $50.00'))).toBe(true)
    expect(expanded.body.map(text).some(l => l.includes('本機今日 $12.40'))).toBe(true)
    expect(expanded.body.map(text).some(l => l.includes('24 時合計') && l.includes('尖峰'))).toBe(true)
    expect(expanded.body.map(text).some(l => l.includes('dev@example.com'))).toBe(true)

    const framedCollapsed = frameRows(viewPage(false), ctx)
    const framedExpanded = frameRows(viewPage(true), ctx)
    expect(framedCollapsed.length).toBe(rows)
    expect(framedExpanded.length).toBe(rows)
    for (const r of [...framedCollapsed, ...framedExpanded]) expect(displayWidth(text(r))).toBeLessThanOrEqual(cols)
  }

  // Focus index 1 moves ▸ from 5h to 7d
  const focus1 = viewPage(false, 1).render(ctxOf(160, 40, calmConsole(), richLive)).body.map(text)
  expect(focus1[1].startsWith('  5 小時')).toBe(true)
  expect(focus1[2].startsWith('▸ 7 天')).toBe(true)

  // Overflow: when expanded body exceeds room (e.g. 80x11 -> room = 11 - head 1 - strip 1 - emptyState 1 = 8 < 11 body rows), frameRows ends body with ↓ 還有 N 列
  const tightOut = frameRows(viewPage(true), ctxOf(80, 11, calmConsole(), richLive)).map(text)
  expect(tightOut.length).toBe(11)
  expect(tightOut[8]).toBe('↓ 還有 4 列')
  expect(tightOut[9]).toBe('沒有要你處理的事')
})

test('spend: Pane mounts [4] jump Button to quota and [z] fold Button bound to hotkey z', async () => {
  await feedFresh()
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

  const richLive = liveOf(HOURLY_WIDE, {
    detail: {
      ...M.NO_DETAIL,
      now_ms: NOW,
      spend: { session: '$3.10', host_all: '$12.40', host_all_n: 12.4, brain: 8.2, cap: 50, mode: 'warn', hourly: HOURLY_WIDE },
    },
  })
  const pages: Page[] = PAGES
  const routed: string[] = []
  const keys: string[] = []
  const tree = walk(Pane(
    EL as never,
    richLive,
    'spend',
    () => {},
    t,
    120,
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
      pages,
      pageId: 'spend',
      onPage: id => routed.push(id),
      onKey: k => keys.push(k.kind),
      console: calmConsole(),
      nowMs: NOW,
      rows: 30,
    },
  ))

  // No empty-label Buttons outside FOCUS_ANCHOR_KEY
  expect(tree.filter(n => n.kind === 'Button' && n.props.key !== FOCUS_ANCHOR_KEY && flat(n).trim() === '')).toEqual([])

  // [4] in body is a clickable Button routing to quota, and strip hotkey '4' also routes to quota
  const bodyJump = tree.find(n => n.kind === 'Button' && typeof n.props.key === 'string' && n.props.key.endsWith(':quota'))!
  expect(bodyJump).toBeDefined()
  expect(flat(bodyJump)).toBe('[4]')
  bodyJump.props.onPress()
  expect(routed).toEqual(['quota'])

  const strip4 = tree.find(n => n.kind === 'Button' && n.props.hotkey === '4')!
  expect(strip4).toBeDefined()
  expect(flat(strip4).trim()).toBe('額度')
  strip4.props.onPress()
  expect(routed).toEqual(['quota', 'quota'])

  // [z] fold hint has a matching Button with hotkey 'z'
  const zBtn = tree.find(n => n.kind === 'Button' && n.props.hotkey === 'z')!
  expect(zBtn).toBeDefined()
  expect(flat(zBtn)).toContain('展開明細')
  zBtn.props.onPress()
  expect(keys).toEqual(['fold'])
})

test('spend: missing and stale sources render red reason rows, wrap without ellipsis truncation, and set empty state appropriately', async () => {
  seatQuota.reset()
  // 1. Both console and live null, seatQuota never fetched -> 資料不足，無法判定 + two red无來源 rows
  const emptyCtx = ctxOf(80, 24, null, null)
  const emptyFramed = frameRows(spendPage, emptyCtx)
  expect(emptyFramed.length).toBe(24)
  const emptyTexts = emptyFramed.map(text)
  expect(emptyTexts.some(l => l.includes('無來源：fleet seats --quota 還沒有結果'))).toBe(true)
  expect(emptyTexts.some(l => l.includes('無來源：本席沒有 live 資料'))).toBe(true)
  expect(emptyTexts[22]).toBe('資料不足，無法判定')
  const redSegs = spendPage.render(emptyCtx).body.flat().filter(s => s.text.includes('無來源'))
  expect(redSegs.length).toBe(2)
  for (const s of redSegs) expect(s.color).toBe(PALETTE.broken)

  // 2. Stale live snapshot with a long reason (> 80 cols) keeps cached spend figure with ✗ and wraps the full reason across rows without `…`
  await feedFresh()
  const longReason = '資料過舊 · 上次發佈 11:20 之後有新變化，watcher 已經停止發佈且尚未重新啟動，完整原因必須換行顯示不能截斷'
  const staleLive = liveOf(HOURLY_NARROW, { state: 'stale', header: longReason })
  const wrapped = frameRows(spendPage, ctxOf(80, 24, calmConsole(), staleLive)).map(text)
  expect(wrapped.length).toBe(24)
  for (const l of wrapped) expect(displayWidth(l)).toBeLessThanOrEqual(80)
  expect(wrapped.some(l => l.includes('$3.10 ✗'))).toBe(true)
  expect(wrapped.join('').replace(/\s+/g, '')).toContain(('本席花費資料過期：' + longReason).replace(/\s+/g, ''))
  expect(wrapped.some(l => l.includes('…'))).toBe(false)

  // 3. Pending card on console updates empty state from 沒有要你處理的事 to 待決 1 張卡等你
  const pendingCon = calmConsole({
    counts: { ...calmConsole().counts, decisions: 1 },
    cards: [{ id: 'd-00000001', question: '是否核准預算調整', status: 'open', opened_at_ms: NOW - 5 * MIN, executor_display: 'PM' }],
  })
  const withCard = frameRows(spendPage, ctxOf(80, 24, pendingCon, liveOf(HOURLY_NARROW))).map(text)
  expect(withCard[22]).toBe('待決 1 張卡等你')

  // 4. Null spend object in ok live snapshot renders red 無來源：沒有花費資料, and null pct renders — (never 0%)
  await seatQuota.refresh(okRun(JSON.stringify([{ seat: 'codeforge--claude', pool_key: 'team', five_hour_pct: null, seven_day_pct: null, stale: false, self: true }])), NOW + 65_000)
  const noSpendLive = liveOf(null, {
    detail: { ...M.NO_DETAIL, now_ms: NOW + 65_000, spend: null },
    account: { account: undefined, quota: [] },
  })
  const noSpendOut = frameRows(spendPage, { ...ctxOf(120, 30, calmConsole(), noSpendLive), nowMs: NOW + 65_000 }).map(text)
  expect(noSpendOut.length).toBe(30)
  expect(noSpendOut.some(l => l.includes('無來源：沒有花費資料'))).toBe(true)
  expect(noSpendOut.some(l => /\b0%/.test(l))).toBe(false)
  expect(noSpendOut.some(l => l.includes('5 小時') && l.includes('—'))).toBe(true)
})

test('spend: every state is exactly H rows at 160x40, 120x30, 80x24 and short 80x7, in zh-TW and en; actions never exceed A', async () => {
  await feedFresh()
  const states: [string, ConsoleSnapshot | null, M.LiveSnapshot | null][] = [
    ['calm', calmConsole(), liveOf()],
    ['no console', null, liveOf()],
    ['no live', calmConsole(), null],
    ['neither', null, null],
    ['no hourly', calmConsole(), liveOf(null)],
  ]
  for (const loc of ['zh-TW', 'en'] as const) {
    const tr = makeT(loc)
    for (const [cols, rows] of [[160, 40], [120, 30], [80, 24], [80, 7]] as const) {
      for (const [name, c, l] of states) {
        const ctx: PageCtx = { live: l, console: c, size: { cols, rows }, t: tr, nowMs: NOW }
        const rendered = spendPage.render(ctx)
        expect(rendered.actions.length, `${loc} ${name} ${cols}x${rows} actions`).toBeLessThanOrEqual(actionRows(rows))
        const framed = frameRows(spendPage, ctx)
        expect(framed.length, `${loc} ${name} ${cols}x${rows} rows`).toBe(rows)
        for (const r of framed as Row[]) expect(displayWidth(text(r)), `${loc} ${name} ${cols}x${rows} width`).toBeLessThanOrEqual(cols)
      }
    }
  }
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})
