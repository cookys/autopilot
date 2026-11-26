import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { widePane } from './pane'
import { wideHygiene } from './hygiene'

test('P4b wideHygiene: normal residue & loadSource produce 110x17 band and 93x42 pane', () => {
  const out = wideHygiene({
    residue: {
      needs_human_count: 1,
      needs_human: [{ kind: 'worktree', target: '.claude/worktrees/tri-merge', branch: 'design/tri-merge', class: 'unintegrated-branch', bytes: null, reason: '4 天沒動', command: 'git -C .claude/worktrees/tri-merge log develop..' }],
      auto_removed_count: 1,
      auto_archived_count: 0,
      auto_ran_at: null,
      by_class: {},
    },
    loadSource: { source: 'dev', marketplace_path: null, flags: [] },
    focus: 0,
  })
  expect(out.stepTitle).toBe('正常')
  expect(out.summary).toBe('要你處理 1 · 自動清理 1')
  const band = wideBand({
    page: 6,
    tabs: WIDE_TABS,
    stepTitle: out.stepTitle,
    list: out.list,
    reply: out.reply,
    status: wideStatusText({ verdict: '進行中', running: 8, failed: 2, stalled: 2, pending: 3, act: 1, tps: 41, spark: '▆▆▄▃▆', labels: { fleet: '艦隊', pending: '待決', act: '動手' } }),
    hints: out.hints,
  })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(110)
  expect(band.rows[14].includes('卡住')).toBe(false)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)

  const pane = widePane({
    page: 6,
    tabs: WIDE_TABS,
    moved: band.overflow.reply,
    more: band.overflow.list,
    pin: [],
    ctx: [],
    ctxFold: false,
    ctxOpen: false,
    lanes: null,
    lanesHead: '',
    hist: out.hist,
    events: null,
    summaries: [null, null, null, null, null, out.summary, null, null, null],
  })
  expect(pane.rows.length).toBe(42)
  for (const r of pane.rows) expect(displayWidth(r)).toBe(93)
})

test('P4b wideHygiene: missing sources return null summary and 缺源', () => {
  const out = wideHygiene({ residue: null, loadSource: null, focus: 0 })
  expect(out.stepTitle).toBe('缺源')
  expect(out.summary).toBeNull()
})
