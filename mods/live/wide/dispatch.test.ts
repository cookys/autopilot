// console v5 P4a: wide/dispatch.ts unit tests (3 派工)
import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { PANE_ROWS, widePane } from './pane'
import { wideDispatch } from './dispatch'

test('P4a wideDispatch normal state: 17x110 band and 42x93 pane', () => {
  const out = wideDispatch({
    items: [
      { state: 'running', label: '甲線 codeforge', engine: 'codex', dur: '12 分', runId: 'hetero-1795623455', branch: 'design/console-gen2', startedAt: '09:30', commits: 3, lastCommitAt: '09:41', fleetTask: '01M89Q2Z' },
      { state: 'failed', label: '丙線 hangar', engine: 'codex', dur: '31 分' },
      { state: 'done', label: '丁線 docs', engine: 'claude', dur: '40 分' },
    ],
    cursor: 0,
    recentRounds: ['09:05 codex · codeforge tux-sync · 交件'],
    stale: false,
    missing: false,
  })
  const status = wideStatusText({ verdict: '進行中', running: 1, failed: 1, stalled: 0, pending: 0, act: 0, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } })
  const band = wideBand({ page: 3, tabs: WIDE_TABS, stepTitle: out.stepTitle, list: out.list, reply: out.reply, status, hints: out.hints })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(110)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)

  const pane = widePane({
    page: 3,
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
    summaries: [null, null, out.summary, null, null, null, null, null, null],
  })
  expect(pane.rows.length).toBe(PANE_ROWS)
  for (const r of pane.rows) expect(displayWidth(r)).toBe(93)
  expect(out.summary).toBe('執行中 1 輪 · 失敗 1 輪 · 完成 1 輪')
})

test('P4a wideDispatch missing state: summary is null', () => {
  const out = wideDispatch({ items: [], cursor: 0, recentRounds: [], stale: false, missing: true })
  expect(out.stepTitle).toBe('缺源')
  expect(out.summary).toBeNull()
})
