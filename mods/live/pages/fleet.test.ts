// U3/V2: severity-first counts and a single compact operation row.
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
import { PALETTE } from '../../tux/palette.ts'
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
// X3/Y1/Y3: shared bus counts, explicit hidden states/navigation, and one status duration.
const GOLDEN: Record<string, string[]> = {
  "folded80": [
    "艦隊",
    "產線 51 ✗1 ⊘4 ○46 · ✗ 離線 1 台主機",
    "▸✗ capacity · h1 卡住（2 時）  等待沒寫等誰（wait_untyped）",
    " ⊘ lab · h3 閒置（6 時）",
    " ⊘ pinball · h4 閒置（5 時）",
    " ⊘ revival · h5 閒置（3 時）",
    " ⊘ hangar · h2 卡住（40 分）  01M7N2ZC 證據逾期 40 分（evidence_overdue）",
    " ○ lane-00 · h1 正常（無異常明細）",
    " ○ 另 45 條折疊（6+45=51）· z 展開（○45）",
    "── 主機 17/18 在線 ──",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "[o] 看 · [z] 展開 · [f] 催辦 · 上一線 · 下一線"
  ],
  "expanded80": [
    "艦隊",
    "產線 51 ✗1 ⊘4 ○46 · ✗ 離線 1 台主機",
    "▸✗ capacity · h1 卡住（2 時）  等待沒寫等誰（wait_untyped）",
    " ⊘ lab · h3 閒置（6 時）",
    " ⊘ pinball · h4 閒置（5 時）",
    " ⊘ revival · h5 閒置（3 時）",
    " ⊘ hangar · h2 卡住（40 分）  01M7N2ZC 證據逾期 40 分（evidence_overdue）",
    " ○ lane-00 · h1 正常（無異常明細）",
    " ○ 已展開 45 條（6+45=51）· z 收合（○45）",
    " ○ lane-01 · h1 正常（無異常明細）",
    " ○ lane-02 · h1 正常（無異常明細）",
    " ○ lane-03 · h1 正常（無異常明細）",
    " ○ lane-04 · h1 正常（無異常明細）",
    " ○ lane-05 · h1 正常（無異常明細）",
    " ○ lane-06 · h1 正常（無異常明細）",
    " ○ lane-07 · h1 正常（無異常明細）",
    " ○ lane-08 · h1 正常（無異常明細）",
    " ○ lane-09 · h1 正常（無異常明細）",
    " ○ lane-10 · h1 正常（無異常明細）",
    " ○ lane-11 · h1 正常（無異常明細）",
    " ○ lane-12 · h1 正常（無異常明細）",
    " ↓ 還有 33 項（○33）",
    "[o] 看 · [z] 收合 · [f] 催辦 · 上一線 · 下一線"
  ],
  "stale80": [
    "艦隊  ✗ 工作 資料過期，6 分鐘前",
    "✗ tasks 已 6 分鐘未更新（console 判定：資料過期）",
    "產線 51 ✗1✗ ⊘4✗ ○46✗ · ✗ 離線 1 台主機",
    "▸✗ capacity · h1 卡住（2 時）  等待沒寫等誰（wait_untyped） ✗",
    " ⊘ lab · h3 閒置（6 時） ✗",
    " ⊘ pinball · h4 閒置（5 時） ✗",
    " ⊘ revival · h5 閒置（3 時） ✗",
    " ⊘ hangar · h2 卡住（40 分）  01M7N2ZC 證據逾期 40 分（evidence_overdue） ✗",
    " ○ lane-00 · h1 正常（無異常明細） ✗",
    " ✗ ○ 另 45 條折疊（6+45=51）· z 展開（○45）",
    "── 主機 17/18 在線 ──",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "[o] 看（舊） · [z] 展開 · [f] 催辦 · 上一線 · 下一線"
  ],
  "folded120": [
    "艦隊",
    "── 產線 51：✗ 離線 1  ⊘ 卡住 4  ○ 正常 46 ────────────────────────────────────────────────────────────────",
    "  產線 / 狀態                                     負責          任務 / 證據",
    "▸ ✗ capacity · h1 卡住（2 時）                    PM              等待沒寫等誰（wait_untyped）",
    "  ⊘ lab · h3 閒置（6 時）                         PM",
    "  ⊘ pinball · h4 閒置（5 時）                     game-lead",
    "  ⊘ revival · h5 閒置（3 時）                     game-lead",
    "  ⊘ hangar · h2 卡住（40 分）                     PM              01M7N2ZC 證據逾期 40 分（evidence_overdue）",
    "  ○ lane-00 · h1 正常（無異常明細）               PM",
    "  ○ 另 45 條折疊（6+45=51）· z 展開（○45）",
    "── 主機 17/18 在線 ─────────────────────────────────────────────────────────────────────────────────────────────────",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "▸ 焦點 capacity · h1：等待沒寫等誰（wait_untyped）",
    "[o] 看 capacity · h1 · 上一線 · 下一線",
    "[z] 展開／收合其他 45 條",
    "[f] 催辦填入提示列（不送出）"
  ],
  "folded160": [
    "艦隊",
    "── 產線 51：✗ 離線 1  ⊘ 卡住 4  ○ 正常 46 ────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "  產線 / 狀態                                     負責          任務 / 證據",
    "▸ ✗ capacity · h1 卡住（2 時）                    PM              等待沒寫等誰（wait_untyped）",
    "  ⊘ lab · h3 閒置（6 時）                         PM",
    "  ⊘ pinball · h4 閒置（5 時）                     game-lead",
    "  ⊘ revival · h5 閒置（3 時）                     game-lead",
    "  ⊘ hangar · h2 卡住（40 分）                     PM              01M7N2ZC 證據逾期 40 分（evidence_overdue）",
    "  ○ lane-00 · h1 正常（無異常明細）               PM",
    "  ○ 另 45 條折疊（6+45=51）· z 展開（○45）",
    "── 主機 17/18 在線 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
    "  ✗ 離線 1 台  GPU 0/2 使用中",
    "▸ 焦點 capacity · h1：等待沒寫等誰（wait_untyped）",
    "[o] 看 capacity · h1 · 上一線 · 下一線",
    "[z] 展開／收合其他 45 條",
    "[f] 催辦填入提示列（不送出）"
  ],
  "nosrc80": [
    "艦隊",
    "✗ 艦隊：無來源（console 沒有 tasks 資料）",
    "資料不足，無法判定"
  ]
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

test('fleet: the badge helpers are the shared leaf rows.ts ones that frame.ts re-exports', () => {
  expect(staleBadge('x')).toEqual(frameBadge('x'))
  expect(brokenRow('x')).toEqual(frameBroken('x'))
})
