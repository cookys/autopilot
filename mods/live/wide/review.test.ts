// console v5 P4a: wide/review.ts unit tests (4 審查)
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { PANE_ROWS, widePane } from './pane'
import { wideReview } from './review'

test('P4a wideReview normal state: 17x115 band and 42x94 pane', () => {
  const out = wideReview({
    items: [
      { label: 'codeforge 7d1c', engine: 'codex', verdict: 'PASS', range: 'develop..7d1c（12 檔）', rounds: ['第 1 輪 3 blocking，全部修完。', '第 2 輪 0 blocking、2 note。'] },
      { label: 'autopilot e931', engine: 'agy', verdict: 'PASS' },
    ],
    cursor: 0,
    qcOwed: 1,
    qcTarget: 'hangar 5cab',
    decidedCount: 4,
    decidedSummary: '合併 develop ×3 · 換池 ×1',
    recentReviews: ['08:31 合併 develop codeforge 05e2'],
    stale: false,
    missing: false,
  })
  const status = wideStatusText({ verdict: '進行中', running: 8, failed: 2, stalled: 2, pending: 3, act: 1, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
  const band = wideBand({ page: 4, tabs: WIDE_TABS, stepTitle: out.stepTitle, list: out.list, reply: out.reply, status, hints: out.hints })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(115)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)

  const pane = widePane({
    page: 4,
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
    summaries: [null, null, null, out.summary, null, null, null, null, null],
  })
  expect(pane.rows.length).toBe(PANE_ROWS)
  for (const r of pane.rows) expect(displayWidth(r)).toBe(94)
  expect(out.summary).toBe('欠審 1 · 我替你決定的事 4')
})

test('P4a wideReview missing state: summary is null', () => {
  const out = wideReview({ items: [], cursor: 0, qcOwed: null, qcTarget: null, decidedCount: null, decidedSummary: null, recentReviews: [], stale: false, missing: true })
  expect(out.stepTitle).toBe('缺源')
  expect(out.summary).toBeNull()
})
