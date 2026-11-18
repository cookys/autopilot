// fleet.test.ts — S2 (page 3 艦隊): the page drawn through frameRows from a fixture console, row for row against the golden rows (the mockups' 艦隊 drawings; the differences are listed in
// the S2 receipt: the parsed snapshot carries no per-line running/waiting state, no host list), the fixed height at 160x40 / 120x30 / 80x24, the §5 no-source row, the red stale markers
// with the full reason, and the key presses (o looks, z folds, f fills the prompt and never sends).
import { test, expect } from 'claude-code/testing'
import { Pane } from '../pane'
import * as M from '../model'
import { displayWidth } from '../model'
import { frameRows, staleBadge as frameBadge, brokenRow as frameBroken, actionRows } from './frame'
import { PAGES } from './index'
import { nowPage } from './now'
import { fleetPage, fleetView, FOLD_AT } from './fleet'
import { lineState, staleBadge, brokenRow } from './rows'
import { makeT } from '../i18n'
import { PALETTE } from '../ui'
import { closeGap } from './quota.fixture'

const t = makeT('zh-TW')
// ---- fixture (fictional names; 51 lines = 5 with an issue + 46 without; the counts are the feed's own) ----
const NOW = 1794200000000
const MIN = 60_000
const issue = (rule: string, subject: string, state: string, ago: number) => ({ rule, state, subject, since_ms: NOW - ago, to_console: true })
const line = (line_id: string, label: string, lead: string | null, issues: ReturnType<typeof issue>[] = []) => ({ line_id, label, lead_display: lead, issues })
const LINES = [
  line('capacity', 'capacity · h1', 'PM', [issue('wait_untyped', '等待沒寫等誰', 'failed', 120 * MIN)]),
  line('hangar', 'hangar · h2', 'PM', [issue('evidence_overdue', '01M7N2ZC 證據逾期 40 分', 'stalled', 40 * MIN)]),
  line('lab', 'lab · h3', 'PM', [issue('idle', '閒置 6 時', 'stalled', 360 * MIN)]),
  line('pinball', 'pinball · h4', 'game-lead', [issue('idle', '閒置 5 時', 'stalled', 300 * MIN)]),
  line('revival', 'revival · h5', 'game-lead', [issue('idle', '閒置 3 時', 'stalled', 180 * MIN)]),
  ...Array.from({ length: 46 }, (_, i) => line('lane-' + String(i).padStart(2, '0'), 'lane-' + String(i).padStart(2, '0') + ' · h1', 'PM')),
]
const snapOf = (over: { tasks?: { at_ms: number | null; state: string }; lines?: unknown[] | null; hosts?: { at_ms: number | null; state: string } } = {}) => ({
  generated_at_ms: NOW,
  sources: { tasks: over.tasks ?? { at_ms: NOW - 12_000, state: 'ok' }, hosts: over.hosts ?? { at_ms: NOW - 12_000, state: 'ok' } },
  counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: { running: 6, waiting: 40, stalled: 5 }, hosts: { online: 17, total: 18, gpu_busy: 0, gpu_total: 2 }, hints: 0, quota_worst: null } },
  quota: { pools: null, seats: [] }, items: [], cards: [], lines: over.lines === undefined ? LINES : over.lines,
}) as never
const lane80 = (n: number) => ' ○ lane-' + String(n).padStart(2, '0') + ' · h1 閒置 —' + ' '.repeat(57) + '—'
const GOLDEN: Record<string, string[]> = {
  folded80: [
    "艦隊",
    "產線 51 ●6 ⋯40 ⊘5",
    "▸✗ capacity · h1 卡住 等待沒寫等誰（wait_untyped）" + ' '.repeat(26) + "2 時",
    " ⊘ lab · h3 閒置 閒置 6 時（idle）" + ' '.repeat(42) + "6 時",
    " ⊘ pinball · h4 閒置 閒置 5 時（idle）" + ' '.repeat(38) + "5 時",
    " ⊘ revival · h5 閒置 閒置 3 時（idle）" + ' '.repeat(38) + "3 時",
    " ⊘ hangar · h2 卡住 01M7N2ZC 證據逾期 40 分（evidence_overdue）" + ' '.repeat(12) + "40 分",
    lane80(0),
    " ○ 另 45 條折疊（6+45=51）· z 展開",
    "── 主機 17/18 在線 ──",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "[o] 看 · [z] 展開 · [f] 催辦",
  ],
  expanded80: [
    "艦隊",
    "產線 51 ●6 ⋯40 ⊘5",
    "▸✗ capacity · h1 卡住 等待沒寫等誰（wait_untyped）" + ' '.repeat(26) + "2 時",
    " ⊘ lab · h3 閒置 閒置 6 時（idle）" + ' '.repeat(42) + "6 時",
    " ⊘ pinball · h4 閒置 閒置 5 時（idle）" + ' '.repeat(38) + "5 時",
    " ⊘ revival · h5 閒置 閒置 3 時（idle）" + ' '.repeat(38) + "3 時",
    " ⊘ hangar · h2 卡住 01M7N2ZC 證據逾期 40 分（evidence_overdue）" + ' '.repeat(12) + "40 分",
    lane80(0),
    " ○ 已展開 45 條（6+45=51）· z 收合",
    ...Array.from({ length: 12 }, (_, i) => lane80(i + 1)),
    "↓ 還有 35 列",
    "[o] 看 · [z] 收合 · [f] 催辦",
  ],
  stale80: [
    "艦隊  ✗ 工作 資料過期，6 分鐘前",
    "✗ tasks 已 6 分鐘未更新（console 判定：資料過期）",
    "產線 51 ●6✗ ⋯40✗ ⊘5✗",
    "▸✗ capacity · h1 卡住 等待沒寫等誰（wait_untyped）" + ' '.repeat(25) + "✗2 時",
    " ⊘ lab · h3 閒置 閒置 6 時（idle）" + ' '.repeat(41) + "✗6 時",
    " ⊘ pinball · h4 閒置 閒置 5 時（idle）" + ' '.repeat(37) + "✗5 時",
    " ⊘ revival · h5 閒置 閒置 3 時（idle）" + ' '.repeat(37) + "✗3 時",
    " ⊘ hangar · h2 卡住 01M7N2ZC 證據逾期 40 分（evidence_overdue）" + ' '.repeat(11) + "✗40 分",
    " ○ lane-00 · h1 閒置 —" + ' '.repeat(56) + "✗—",
    " ✗ ○ 另 45 條折疊（6+45=51）· z 展開",
    "── 主機 17/18 在線 ──",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "[o] 看（舊） · [z] 展開 · [f] 催辦",
  ],
  folded120: [
    "艦隊",
    "── 產線 51：● 執行 6  ⋯ 等待 40  ⊘ 卡住 5 ────────────────────────────────────────────────────────────────",
    "  產線                  狀態    負責          任務 / 證據" + ' '.repeat(59) + "上次",
    "▸ ✗ capacity · h1       卡住    PM            等待沒寫等誰（wait_untyped）" + ' '.repeat(42) + "2 時",
    "  ⊘ lab · h3            閒置    PM            閒置 6 時（idle）" + ' '.repeat(53) + "6 時",
    "  ⊘ pinball · h4        閒置    game-lead     閒置 5 時（idle）" + ' '.repeat(53) + "5 時",
    "  ⊘ revival · h5        閒置    game-lead     閒置 3 時（idle）" + ' '.repeat(53) + "3 時",
    "  ⊘ hangar · h2         卡住    PM            01M7N2ZC 證據逾期 40 分（evidence_overdue）" + ' '.repeat(26) + "40 分",
    "  ○ lane-00 · h1        閒置    PM            —" + ' '.repeat(72) + "—",
    "  ○ 另 45 條折疊（6+45=51）· z 展開",
    "── 主機 17/18 在線 ─────────────────────────────────────────────────────────────────────────────────────────────────",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "▸ 焦點 capacity · h1：等待沒寫等誰（wait_untyped）",
    "[o] 看 capacity · h1",
    "[z] 展開／收合其他 45 條",
    "[f] 催辦填入提示列（不送出）",
  ],
  folded160: [
    "艦隊",
    "── 產線 51：● 執行 6  ⋯ 等待 40  ⊘ 卡住 5 ────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "  產線                  狀態    負責          任務 / 證據" + ' '.repeat(99) + "上次",
    "▸ ✗ capacity · h1       卡住    PM            等待沒寫等誰（wait_untyped）" + ' '.repeat(82) + "2 時",
    "  ⊘ lab · h3            閒置    PM            閒置 6 時（idle）" + ' '.repeat(93) + "6 時",
    "  ⊘ pinball · h4        閒置    game-lead     閒置 5 時（idle）" + ' '.repeat(93) + "5 時",
    "  ⊘ revival · h5        閒置    game-lead     閒置 3 時（idle）" + ' '.repeat(93) + "3 時",
    "  ⊘ hangar · h2         卡住    PM            01M7N2ZC 證據逾期 40 分（evidence_overdue）" + ' '.repeat(66) + "40 分",
    "  ○ lane-00 · h1        閒置    PM            —" + ' '.repeat(112) + "—",
    "  ○ 另 45 條折疊（6+45=51）· z 展開",
    "── 主機 17/18 在線 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "▸ 焦點 capacity · h1：等待沒寫等誰（wait_untyped）",
    "[o] 看 capacity · h1",
    "[z] 展開／收合其他 45 條",
    "[f] 催辦填入提示列（不送出）",
  ],
  nosrc80: [
    "艦隊",
    "✗ 艦隊：無來源（console 沒有 tasks 資料）",
    "資料不足，無法判定",
  ],
}

const text = (row: { text: string }[]) => row.map(s => s.text).join('').replace(/\s+$/, '')
const ctxOf = (cols: number, rows: number, console: unknown) => ({ live: null, console, size: { cols, rows }, t, nowMs: NOW }) as never
const EXPANDED = { focus: 0, expanded: true }
const viewPage = (view: { focus: number; expanded: boolean }) => ({ ...fleetPage, render: (c: never) => fleetView(c, view) }) as never
const drawn = (cols: number, rows: number, snap: unknown, view?: { focus: number; expanded: boolean }) => {
  const page = view === undefined ? fleetPage : viewPage(view)
  const out = frameRows(page, ctxOf(cols, rows, snap))
  expect(out.length, 'fixed height').toBe(rows)
  return closeGap(out.slice(0, -1).map(text), Math.max(1, page.render(ctxOf(cols, rows, snap)).actions.length))
}
const STALE = () => snapOf({ tasks: { at_ms: NOW - 6 * MIN, state: 'stale' } })

test('fleet golden: 80x24 folded, expanded, stale and no-source rows', () => {
  expect(drawn(80, 24, snapOf())).toEqual(GOLDEN.folded80)
  expect(drawn(80, 24, snapOf(), EXPANDED)).toEqual(GOLDEN.expanded80)
  expect(drawn(80, 24, STALE())).toEqual(GOLDEN.stale80)
  expect(drawn(80, 24, snapOf({ lines: null }))).toEqual(GOLDEN.nosrc80)
})

test('fleet golden: 120x30 and 160x40 folded', () => {
  expect(drawn(120, 30, snapOf())).toEqual(GOLDEN.folded120)
  expect(drawn(160, 40, snapOf())).toEqual(GOLDEN.folded160)
})

test('fleet: every state is exactly H rows at 160x40, 120x30, 80x24, actions within A, the strip last', () => {
  const states: [string, unknown, { focus: number; expanded: boolean } | undefined][] = [
    ['folded', snapOf(), undefined], ['expanded', snapOf(), EXPANDED], ['focus past the end', snapOf(), { focus: 99, expanded: false }], ['stale', STALE(), undefined],
    ['expired hosts', snapOf({ hosts: { at_ms: NOW - 30 * MIN, state: 'expired' } }), undefined], ['hosts no_source', snapOf({ hosts: { at_ms: null, state: 'no_source' } }), undefined],
    ['no lanes', snapOf({ lines: [] }), undefined], ['lines absent', snapOf({ lines: null }), undefined], ['tasks no_source', snapOf({ tasks: { at_ms: null, state: 'no_source' } }), undefined], ['null console', null, undefined],
  ]
  const bad: string[] = []
  for (const [cols, rows] of [[160, 40], [120, 30], [80, 24]] as const)
    for (const [name, snap, view] of states) {
      const page = view === undefined ? fleetPage : viewPage(view)
      const ctx = ctxOf(cols, rows, snap)
      const out = frameRows(page, ctx)
      if (out.length !== rows) bad.push(`${name}@${cols}x${rows}=${out.length}`)
      if (page.render(ctx).actions.length > actionRows(rows)) bad.push(`${name}@${cols}x${rows} actions`)
      if (!/1\D*2\D*3\D*4/.test(text(out[out.length - 1]))) bad.push(`${name}@${cols}x${rows} strip`)
    }
  expect(bad.join(' ')).toBe('')
})

test('fleet: a null console and a null live render the no-source row and do not throw; actions are empty', () => {
  const out = fleetPage.render(ctxOf(80, 24, null))
  expect(out.body.length).toBe(1)
  expect(text(out.body[0])).toContain('無來源')
  expect(out.body[0][0].color).toBe(PALETTE.broken)
  expect(out.actions).toEqual([])
  expect(() => fleetPage.render(ctxOf(80, 24, snapOf({ tasks: { at_ms: null, state: 'no_source' } })))).not.toThrow()
})

test('fleet: the fold shows FOLD_AT lines and the count adds up to the total; expanded draws all of them', () => {
  const folded = fleetPage.render(ctxOf(120, 30, snapOf()))
  const rowsText = folded.body.map(text)
  expect(rowsText.filter(r => /lane-\d\d/.test(r) || /capacity|hangar|lab|pinball|revival/.test(r)).length).toBe(FOLD_AT)
  expect(rowsText.some(r => r.includes('6+45=51'))).toBe(true)
  const open = fleetView(ctxOf(120, 30, snapOf()), EXPANDED).body.map(text)
  expect(open.filter(r => /lane-\d\d|capacity|hangar|lab ·|pinball|revival/.test(r)).length).toBe(51)
  expect(open.some(r => r.includes('z 收合'))).toBe(true)
})

test('fleet: stale tasks are red with the full reason on its own row, never cut, and every age and count carries the marker', () => {
  const out = fleetPage.render(ctxOf(80, 24, STALE()))
  const reason = out.body[0]
  expect(text(reason)).toBe('✗ tasks 已 6 分鐘未更新（console 判定：資料過期）')
  expect(reason[0].color).toBe(PALETTE.broken)
  const lineRows = out.body.filter(r => /^[▸ ][✗⊘○]/.test(text(r)) && !text(r).includes('另'))
  expect(lineRows.length).toBe(FOLD_AT)
  for (const r of lineRows) expect(r[r.length - 1].color).toBe(PALETTE.broken)
  const frameOut = frameRows(fleetPage, ctxOf(80, 24, STALE()))
  expect(text(frameOut[0])).toContain('工作')
})

test('fleet: o looks (never expands), z folds, f fills the prompt line and is not a send', () => {
  const out = fleetPage.render(ctxOf(120, 30, snapOf()))
  const acts = out.actions.flat()
  const see = acts.find(s => s.text.startsWith('[o]'))
  expect(see?.press).toBe('fleet:see:capacity')
  expect(acts.find(s => s.text.startsWith('[z]'))?.press).toBe('fleet:fold')
  const nudge = acts.find(s => s.text.startsWith('[f]'))
  expect(nudge?.press?.startsWith('fill:')).toBe(true)
  expect(nudge?.press).toContain('capacity · h1')
  expect(text(out.actions[out.actions.length - 1])).toContain('不送出')
  const moved = fleetView(ctxOf(120, 30, snapOf()), { focus: 2, expanded: false }).actions.flat().find(s => s.text.startsWith('[o]'))
  expect(moved?.press).toBe('fleet:see:pinball')
})

test('fleet: the badge helpers are the shared leaf rows.ts ones that frame.ts re-exports', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})

test('fleet R3: expanded named rows equal the stated unfolded count when summary total exceeds listed lines (8 listed, 9 total), and 現況 & 艦隊 share lineState', () => {
  const eightLines = Array.from({ length: 8 }, (_, i) => line('L' + i, '線-' + i, 'PM', i === 0 ? [issue('T4', '成員離線', 'failed', 20 * MIN)] : i < 5 ? [issue('T3', '閒置 50 分', 'stalled', 50 * MIN)] : [issue('wait_untyped', '等待中', 'stalled', 30 * MIN)]))
  const snap9 = {
    ...snapOf({ lines: eightLines }),
    counts: { decisions: 0, exceptions: 0, quota_risk: 0, tabs: {}, summary: { lines: { running: 2, waiting: 1, stalled: 6 }, hosts: { online: 2, total: 2, gpu_busy: 0, gpu_total: 0 }, hints: 0, quota_worst: null } },
  }
  const openRows = fleetView(ctxOf(120, 30, snap9), EXPANDED).body.map(text)
  const bannerIdx = openRows.findIndex(r => r.includes('已展開'))
  expect(bannerIdx).toBeGreaterThan(0)
  const stated = Number(/已展開 (\d+) 條/.exec(openRows[bannerIdx])?.[1] ?? -1)
  const afterBannerNamed = openRows.slice(bannerIdx + 1).filter(r => /線-\d/.test(r)).length
  expect(stated).toBe(2)
  expect(afterBannerNamed).toBe(stated)

  // Shared line-state parity across 現況 (both normal body and shortBody) and 艦隊 for lines 甲(離線), 丙–己(閒置), 庚(卡住)
  const named = [
    line('jia', '甲線', 'PM', [issue('T4', '成員未連線', 'failed', 22 * MIN)]),
    line('bing', '丙線', 'PM', [issue('T3', '超過 50 分無進度', 'stalled', 52 * MIN)]),
    line('ding', '丁線', 'PM', [issue('idle', '閒置 3 時', 'stalled', 180 * MIN)]),
    line('wu', '戊線', 'PM', [issue('T3', '超過 40 分無進度', 'stalled', 40 * MIN)]),
    line('ji', '己線', 'PM', [issue('T3', '超過 30 分無進度', 'stalled', 30 * MIN)]),
    line('geng', '庚線', 'PM', [issue('wait_untyped', '等待沒寫等誰', 'stalled', 15 * MIN)]),
  ]
  const paritySnap = snapOf({ lines: named })
  const fleetLines = fleetPage.render(ctxOf(160, 40, paritySnap)).body.map(text)
  const nowLines = nowPage.render(ctxOf(160, 40, paritySnap)).body.map(text)
  const nowShort = nowPage.render({ ...(ctxOf(80, 7, paritySnap) as object), shortBody: true } as never).body.map(text)
  for (const ln of named) {
    const want = lineState(ln, t).word
    expect(fleetLines.find(r => r.includes(ln.label))).toContain(want)
    expect(nowLines.find(r => r.includes(ln.label))).toContain(want)
  }
  expect(lineState(named[1], t).word).toBe('閒置')
  expect(nowShort[0]).toContain('離線')
})

test('fleet R8: when fleet.brief is stale (> 10 min), 艦隊 summary row carries ✗, N 分前 and the reason', () => {
  const staleBrief = {
    ...(snapOf() as Record<string, unknown>),
    generated_at_ms: NOW - 15 * MIN,
    sources: { tasks: { at_ms: NOW - 15 * MIN, state: 'stale' }, hosts: { at_ms: NOW - 15 * MIN, state: 'expired' } },
  }
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const out = fleetPage.render(ctxOf(cols, rows, staleBrief)).body.map(text)
    const sumRow = out.find(r => r.includes('產線 51'))!
    expect(sumRow).toContain('✗')
    expect(sumRow).toContain('15 分前')
    expect(sumRow).toContain('資料已過期')
  }
})

test('fleet R10 & R11: at 80x24 o/z/f are one row with 3 clickable non-empty Buttons; duration column is fixed-width right-aligned and wide titles cut with … without wrapping', () => {
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
  const flatText = (n: any): string => {
    const c = n?.props?.children
    return typeof c === 'string' ? c : Array.isArray(c) ? c.flat(9).map((x: any) => (typeof x === 'string' ? x : x?.props ? flatText(x) : '')).join('') : c?.props ? flatText(c) : ''
  }
  const live0 = { state: 'ok', text: 'x', header: 'x', band: null, pending: [], project_key: null, root_run_id: null, link: null, rows: null, gates: null, sections: M.NO_SECTIONS, review: null, published_at: null, watcher_note: null, session_as_of: null, host_as_of: null, detail: { ...M.NO_DETAIL, now_ms: NOW } } as never
  const shown = PAGES.map(p => ({ ...p, framed: true as const }))
  const out80 = fleetPage.render(ctxOf(80, 24, snapOf()))
  expect(out80.actions.length).toBe(1)
  expect(text(out80.actions[0])).toBe('[o] 看 · [z] 展開 · [f] 催辦')

  const pressed: string[] = []
  const tree = walk(Pane(EL as never, live0, 'fleet', () => {}, t, 80, () => {}, new Set(), () => {}, new Set(), null, null, null, null, null, { pages: shown, console: snapOf(), nowMs: NOW, rows: 24, onPress: (id: string) => pressed.push(id), onKey: (k: any) => pressed.push('key:' + k.kind) } as never))
  for (const [hk, label] of [['o', '看'], ['z', '展開'], ['f', '催辦']] as const) {
    const btn = tree.find(n => n.kind === 'Button' && n.props.hotkey === hk)!
    expect(btn).toBeDefined()
    expect(flatText(btn).trim()).toBe(label)
    btn.props.onPress()
  }
  expect(pressed.length).toBe(3)

  // R11: wide single-row line task cuts with `…` and keeps time fixed at right edge `cols` without wrapping
  const longSnap = snapOf({ lines: [line('wide', 'capacity · h1', 'PM', [issue('wait_untyped', '這是一條非常非常長的工作描述用來驗證單列標題過寬時會以省略號截斷而時間固定靠右對齊絕不換行', 'failed', 120 * MIN)])] })
  for (const [cols, rows] of [[80, 24], [120, 30]] as const) {
    const bodyRows = fleetPage.render(ctxOf(cols, rows, longSnap)).body
    const lRow = bodyRows.find(r => text(r).includes('capacity · h1'))!
    const raw = lRow.map(s => s.text).join('')
    expect(displayWidth(raw)).toBe(cols)
    expect(raw).toContain('…')
    expect(raw.endsWith('2 時')).toBe(true)
  }
})

test('fleet narrow 7-cell ages: at 80x24 with a stale brief, lines aged 15 min (en) and 100 天 (zh-TW) keep every rendered row <= 80 cells with the age at the right edge', () => {
  const DAY = 86_400_000
  const agedLines = [
    line('cap15', 'capacity · h1', 'PM', [issue('wait_untyped', '等待沒寫等誰', 'failed', 15 * MIN)]),
    line('longlbl', 'long-production-line-label-exceeding-sixty-columns-at-narrow-width', 'PM', [issue('T4', 'member offline check', 'failed', 15 * MIN)]),
    line('old100', 'revival · h5', 'game-lead', [issue('idle', '閒置過久等待清理與交接確認以及後續排程檢查避免單列過寬換行', 'stalled', 100 * DAY)]),
  ]
  const staleBrief = {
    ...(snapOf({ lines: agedLines }) as Record<string, unknown>),
    generated_at_ms: NOW - 15 * MIN,
    sources: { tasks: { at_ms: NOW - 15 * MIN, state: 'stale' }, hosts: { at_ms: NOW - 15 * MIN, state: 'expired' } },
  }

  for (const [locale, id, wantAge] of [['en', 'cap15', '✗15 min'], ['en', 'longlbl', '✗15 min'], ['zh-TW', 'old100', '✗100 天']] as const) {
    const ctx = { live: null, console: staleBrief, size: { cols: 80, rows: 24 }, t: makeT(locale), nowMs: NOW } as never
    const rendered = fleetPage.render(ctx)
    for (const r of [...rendered.body, ...rendered.actions]) {
      const raw = r.map(s => s.text).join('')
      expect(displayWidth(raw), `${locale} render row <= 80: ${raw}`).toBeLessThanOrEqual(80)
    }
    const framed = frameRows(fleetPage, ctx)
    expect(framed.length).toBe(24)
    for (const r of framed) {
      const raw = r.map(s => s.text).join('')
      expect(displayWidth(raw), `${locale} framed row <= 80: ${raw}`).toBeLessThanOrEqual(80)
    }
    const targetPress = 'fleet:see:' + id
    const listRows = framed.filter(r => r.some(s => s.press === targetPress))
    expect(listRows.length, `${locale} ${id} stays a single unwrapped row`).toBe(1)
    const rowRaw = listRows[0].map(s => s.text).join('')
    expect(displayWidth(rowRaw), `${locale} ${id} fixed right edge at 80`).toBe(80)
    expect(rowRaw.endsWith(wantAge), `${locale} ${id} ends with ${wantAge}: ${rowRaw}`).toBe(true)
  }
})
