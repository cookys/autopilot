import { test, expect } from 'claude-code/testing'
import { displayWidth } from '../../tux/width.ts'
import { renderQuota } from './quota'
import { fleetView } from './fleet'

const NOW = 1_794_200_000_000
const ctxOf = (cols: number, pools: unknown[] = [], lines: unknown[] = [], stale = false) => ({
  live: null, size: { cols, rows: 40 }, nowMs: NOW,
  t: (key: string) => key.split('.').pop()!,
  console: {
    generated_at_ms: NOW,
    sources: { tasks: { at_ms: NOW, state: stale ? 'stale' : 'ok' }, quota_forecast: { at_ms: NOW, state: 'ok' } },
    counts: { summary: { lines: {}, hosts: {}, hints: 0 } },
    quota: { pools, seats: [] }, lines, items: [], cards: [],
  },
}) as never

const poolOf = (pool: string) => ({
  pool, seven_day_pct: 50, five_hour_pct: 0, resets_at_ms: null, burn_pct_per_h: null, burn_window_h: null,
  projected_pct_at_reset: null, projected_exhaustion_at_ms: null, verdict: null, limit_hit: null,
  stale: false, stale_age_min: null, stale_note: null, observed_at_ms: NOW, stranded_seats: null,
  stranded_seat_list: null, switched: null, seats: null, projection_source: null, switch_suggestion: null,
})

test('quota pool cells keep alias tails, fit display widths and leave fitting names intact', () => {
  for (const [cols, width] of [[80, 10], [120, 14], [160, 20]]) {
    for (const name of ['agyclaude', 'agyclaude(alias 2)', 'x'.repeat(width), '長池名'.repeat(width) + '(alias 3)']) {
      const row = renderQuota(ctxOf(cols, [poolOf(name)])).body.find(r => r[0]?.press === 'quota:pool:0')!
      const cell = row[2].text
      expect(displayWidth(cell)).toBe(width)
      if (displayWidth(name) <= width) {
        expect(cell.trimEnd()).toBe(name)
      } else {
        expect(cell).toContain('…')
        expect(cell.trimEnd().endsWith(name.endsWith('(alias 2)') ? '(alias 2)' : '(alias 3)')).toBe(true)
      }
    }
  }
})
