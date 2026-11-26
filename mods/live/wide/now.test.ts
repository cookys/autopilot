// console v5 P4a: wide/now.ts unit tests (1 現況)
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { PANE_ROWS, widePane } from './pane'
import { wideNow } from './now'

test('P4a wideNow normal state: 17x110 band and 42x93 pane, no 卡住', () => {
  const out = wideNow({
    pending: 3,
    act: 1,
    residue: 2,
    fleetTotal: 12,
    running: 8,
    failed: 2,
    stalled: 2,
    ctxPct: 42,
    sessionTokens: '240k',
    qcOwed: 1,
    proxyDecided: 4,
    oldestPendingAge: '3 小時',
    oldestPendingQuestion: '要不要把 tui 共用計畫合進 develop。',
    pmUpdatedAt: '09:41',
    pmAge: '1 分鐘前',
    failedNames: ['hangar 換池（3 輪）', 'docs 建置（1 輪）'],
    recentDone: ['09:38 codeforge 合進 develop'],
    stale: false,
    missingPm: false,
    missingConsole: false,
  })
  const status = wideStatusText({ verdict: '進行中', running: 8, failed: 2, stalled: 2, pending: 3, act: 1, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
  const band = wideBand({ page: 1, tabs: WIDE_TABS, stepTitle: out.stepTitle, list: out.list, reply: out.reply, status, hints: out.hints })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(110)
  expect(band.rows[14].includes('卡住')).toBe(false)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)

  const pane = widePane({
    page: 1,
    tabs: WIDE_TABS,
    moved: band.overflow.reply,
    more: band.overflow.list,
    pin: out.pin,
    ctx: out.ctx,
    ctxFold: false,
    ctxOpen: false,
    lanes: null,
    lanesHead: '',
    hist: out.hist,
    events: out.events,
    summaries: [out.summary, null, null, null, null, null, null, null, null],
  })
  expect(pane.rows.length).toBe(PANE_ROWS)
  for (const r of pane.rows) expect(displayWidth(r)).toBe(93)
})

test('P4a wideNow missing sources: summary is null, stepTitle reflects missing', () => {
  const input = {
    pending: null,
    act: null,
    residue: null,
    fleetTotal: null,
    running: null,
    failed: null,
    stalled: null,
    ctxPct: null,
    sessionTokens: null,
    qcOwed: null,
    proxyDecided: null,
    oldestPendingAge: null,
    oldestPendingQuestion: null,
    pmUpdatedAt: null,
    pmAge: null,
    failedNames: [],
    recentDone: [],
    stale: false,
    missingPm: true,
    missingConsole: true,
  }
  const out = wideNow(input)
  expect(out.stepTitle).toBe('缺源（pm 和 console 都讀不到）')
  expect(out.summary).toBeNull()
  expect(out.reply).toEqual(['pm 和 console 都讀不到。', '產線的失敗和停住的看不到；要看每個 agent 請到 7 艦隊。'])
  expect(wideNow({ ...input, pending: 2, laneBusy: 5, laneIdle: 4 }).reply).toEqual(['pm 和 console 都讀不到，艦隊只剩 fleetSummary 的 lane 忙閒。', '產線的失敗和停住的看不到；要看每個 agent 請到 7 艦隊。'])
  expect(wideNow({ ...input, missingPm: false, missingConsole: false, stale: true }).stepTitle).toBe('~ 過時')
})
