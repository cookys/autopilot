// console v5 P4a: wide/spend.ts unit tests (5 花費)
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { PANE_ROWS, widePane } from './pane'
import { wideSpend } from './spend'

test('P4a wideSpend normal state: 17x115 band and 42x94 pane', () => {
  const out = wideSpend({
    pct5h: 42,
    reset5h: '2h10m',
    eta5h: '3h03m',
    hitBeforeReset: false,
    ratePerHour: 19,
    pct7d: 18,
    reset7d: '4d',
    pools: [{ label: 'A 池', pct: 42 }, { label: 'B 池', pct: 9 }],
    todayTokens: '380k',
    tps: 41,
    seatUsage: ['codeforge · 92k tokens · 5h 的 10%'],
    stale: false,
    missing: false,
  })
  const status = wideStatusText({ verdict: '進行中', running: 8, failed: 2, stalled: 2, pending: 3, act: 1, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
  const band = wideBand({ page: 5, tabs: WIDE_TABS, stepTitle: out.stepTitle, list: out.list, reply: out.reply, status, hints: out.hints })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(115)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)

  const pane = widePane({
    page: 5,
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
    summaries: [null, null, null, null, out.summary, null, null, null, null],
  })
  expect(pane.rows.length).toBe(PANE_ROWS)
  for (const r of pane.rows) expect(displayWidth(r)).toBe(94)
  expect(out.summary).toBe('5h 42% · 7d 18% · 今日 380k tokens')
})

test('P4a wideSpend missing state: summary is null', () => {
  const out = wideSpend({ pct5h: null, reset5h: null, eta5h: null, hitBeforeReset: null, ratePerHour: null, pct7d: null, reset7d: null, pools: [], todayTokens: null, tps: null, seatUsage: [], stale: false, missing: true })
  expect(out.stepTitle).toBe('缺源')
  expect(out.summary).toBeNull()
})
