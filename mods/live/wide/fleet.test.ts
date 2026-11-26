import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { makeT } from '../i18n'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { wideFleet } from './fleet'

const t = makeT('zh-TW')

test('P4b wideFleet: integrates speedview agentsColumn tok/s and console lines', () => {
  const out = wideFleet({
    lines: [
      { id: 'codeforge', label: 'codeforge', lead_display: 'tux-sync 測試', issues: [] },
      { id: 'hangar', label: 'hangar', lead_display: '等 NAS 回應', issues: [{ kind: 'failed', message: 'NAS stat 逾時', since_ms: 1000 }] },
    ] as never,
    steps: [
      { at: 1000, model: 'claude-opus-4', isSubagent: false, ttftMs: 120, decodeMs: 1000, outTokens: 41, tps: 41 },
    ],
    nowMs: 2000,
    t,
    focus: 0,
  })
  expect(out.stepTitle).toBe('正常')
  expect(out.list.some(l => l.includes('tok/s') || l.includes('41'))).toBe(true)
  const band = wideBand({
    page: 7,
    tabs: WIDE_TABS,
    stepTitle: out.stepTitle,
    list: out.list,
    reply: out.reply,
    status: wideStatusText({ verdict: '進行中', running: 1, failed: 1, stalled: 0, pending: 0, act: 0, tps: 41, spark: null, labels: { fleet: '艦隊', pending: '待決', act: '動手' } }),
    hints: out.hints,
  })
  expect(band.rows.length).toBe(17)
  for (const r of band.rows) expect(displayWidth(r)).toBe(115)
  expect(band.rows[14].includes('卡住')).toBe(false)
  expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)
})

test('P4b wideFleet: missing sources return 缺源', () => {
  const out = wideFleet({ lines: null, steps: [], nowMs: 2000, t, focus: 0 })
  expect(out.stepTitle).toBe('缺源')
  expect(out.summary).toBeNull()
})
