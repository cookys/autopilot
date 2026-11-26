import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width'
import { WIDE_TABS, WIDE_TAB_HINT, wideBand, wideStatusText } from './band'
import { wideHelp } from './help'

test('P4b wideHelp: key table includes e, Tab, g and no banned glyphs', () => {
  for (const focus of [0, 1, 2]) {
    const out = wideHelp(focus)
    const joined = [...out.list, ...out.reply].join('\n')
    for (const banned of ['▲', '★', '⚠', '▏', '●']) {
      expect(joined.includes(banned)).toBe(false)
    }
    if (focus === 1) {
      expect(joined.includes('Tab')).toBe(true)
      expect(joined.includes('e')).toBe(true)
      expect(joined.includes('g')).toBe(true)
    }
    const band = wideBand({
      page: 9,
      tabs: WIDE_TABS,
      stepTitle: out.stepTitle,
      list: out.list,
      reply: out.reply,
      status: wideStatusText({ verdict: '進行中', running: 8, failed: 0, stalled: 0, pending: 0, act: 0, tps: 41, spark: null, labels: { fleet: '艦隊', pending: '待決', act: '動手' } }),
      hints: out.hints,
    })
    expect(band.rows.length).toBe(17)
    for (const r of band.rows) expect(displayWidth(r)).toBe(110)
    expect(band.rows[16].includes(WIDE_TAB_HINT)).toBe(true)
  }
})
