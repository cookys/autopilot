import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { wideTodo } from './todo'

test('P4b wideTodo: renders todo cards in 110x17 band', () => {
  const out = wideTodo({
    todo: [
      {
        id: 't1',
        title: '合併計畫',
        dueMs: Date.UTC(2026, 10, 30),
        question: '這次合併要不要等 hippo 裝完？',
        options: [
          { label: '先合併', recommended: true },
          { label: '等 hippo', recommended: false },
        ],
      } as never,
    ],
    cursor: 0,
    picks: {},
    notes: { t1: '等 hippo 的時程再說' },
  })
  expect(out.stepTitle).toBe('正常')
  expect(out.summary).toBe('1 張')
  const band = wideBand({
    page: 8,
    tabs: WIDE_TABS,
    stepTitle: out.stepTitle,
    list: out.list,
    reply: out.reply,
    status: wideStatusText({ verdict: '進行中', running: 8, failed: 0, stalled: 0, pending: 1, act: 0, tps: 41, spark: null, labels: { fleet: '艦隊', pending: '待決', act: '動手' } }),
    hints: out.hints,
  })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(110)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)
})

test('P4b wideTodo: null todo returns 缺源（還沒接線）', () => {
  const out = wideTodo({ todo: null, cursor: 0, picks: {}, notes: {} })
  expect(out.stepTitle).toBe('缺源（還沒接線）')
  expect(out.summary).toBeNull()
})
