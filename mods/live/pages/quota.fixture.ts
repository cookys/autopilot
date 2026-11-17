// quota.fixture.ts — the 額度 mockup data (s0b/mockups.md, g2 A11: self-consistent, pre-r5: burn_window_h 6, stranded / switched null) as a PageCtx builder for quota.test.ts.
// Times are Taipei wall-clock converted to epoch ms; nowMs is 11-18 01:00 Taipei, so "team runs out 11-18 18:00" is 17 hours away.
import { parseConsole } from '../console'
import { makeT } from '../i18n'
import full from '../fixtures/console/console-full.fixture'

const tp = (m: number, d: number, h: number): number => Date.UTC(2026, m - 1, d, h - 8, 0)
export const NOW = tp(11, 18, 1)
export const MIN = 60000
const base = { seven_day_pct: null, five_hour_pct: null, resets_at_ms: null, burn_pct_per_h: null, burn_window_h: 6, projected_pct_at_reset: null, projected_exhaustion_at_ms: null, verdict: null,
  limit_hit: null, stale: null, stale_age_min: null, stale_note: null, observed_at_ms: NOW - 40000, stranded_seats: null, stranded_seat_list: null, switched: null, seats: 1, projection_source: 'fleet', switch_suggestion: null }
const pool = (o: Record<string, unknown>) => ({ ...base, ...o })
// the seven pools of the 160x40 mockup, in the feed's own order (the page sorts them)
export const POOLS = [
  pool({ pool: 'codex', seven_day_pct: 80, five_hour_pct: 12, resets_at_ms: tp(11, 19, 21), burn_pct_per_h: 0.4, projected_pct_at_reset: 98, seats: 2 }),
  pool({ pool: 'grok', seven_day_pct: 10, five_hour_pct: 0, resets_at_ms: tp(11, 24, 0), burn_pct_per_h: 0.0, projected_pct_at_reset: 10, seats: 1 }),
  pool({ pool: 'lab', seven_day_pct: 22, five_hour_pct: 4, resets_at_ms: tp(11, 22, 10), burn_pct_per_h: 0.2, projected_pct_at_reset: 43, seats: 2 }),
  pool({ pool: 'personal', seven_day_pct: 100, five_hour_pct: 100, resets_at_ms: tp(11, 19, 8), burn_pct_per_h: 1.1, projected_pct_at_reset: 100, limit_hit: true, seats: 5 }),
  pool({ pool: 'team', seven_day_pct: 68, five_hour_pct: 17, resets_at_ms: tp(11, 21, 12), burn_pct_per_h: 1.9, projected_pct_at_reset: 130, projected_exhaustion_at_ms: tp(11, 18, 18), seats: 3 }),
  pool({ pool: 'trinity', seven_day_pct: 31, five_hour_pct: 0, resets_at_ms: tp(11, 20, 6), burn_pct_per_h: 0.3, projected_pct_at_reset: 47, stale: true, stale_age_min: 180, stale_note: 'statusline 沒在跑', observed_at_ms: NOW - 180 * MIN, seats: 1 }),
  pool({ pool: 'twgame', seven_day_pct: 49, five_hour_pct: 0, resets_at_ms: tp(11, 19, 9), burn_pct_per_h: 1.4, projected_pct_at_reset: 94, stale_note: '席 twgame-2 過期 14 分，舊值 55% 較高', stale_age_min: 14, seats: 2 }),
]
export const SEATS = [
  { seat: 'capacity--claude', pool: 'personal', seven_day_pct: 100, five_hour_pct: 100, stale: false, age_min: 0 },
  { seat: 'hangar--claude', pool: 'personal', seven_day_pct: 100, five_hour_pct: 100, stale: false, age_min: 1 },
  { seat: 'old--claude', pool: 'personal', seven_day_pct: 97, five_hour_pct: 90, stale: true, age_min: 14 },
]
export type Sources = Record<string, { at_ms: number | null; state: 'ok' | 'stale' | 'expired' | 'no_source' }>
// the raw feed goes through parseConsole (the trust boundary), as it does in the pane: the page only ever sees what the parser keeps
export const consoleOf = (pools: unknown[] | null, o: { pace?: boolean; seats?: unknown[]; quotaNowAt?: number | null; sources?: Sources; items?: unknown[] } = {}): unknown => parseConsole(JSON.stringify({
  ...full,
  ...(o.items === undefined ? {} : { items: [...(full as { items: unknown[] }).items, ...o.items] }),
  sources: o.sources ?? { quota_now: { at_ms: o.quotaNowAt === undefined ? NOW - 40000 : o.quotaNowAt, state: 'ok' }, quota_forecast: o.pace === false ? { at_ms: null, state: 'no_source' } : { at_ms: NOW - 40000, state: 'ok' } },
  quota: pools === null ? undefined : { pools, seats: o.seats ?? [] },
}))
export const ctxOf = (cols: number, rows: number, console: unknown) => ({ live: null, console, size: { cols, rows }, t: makeT('zh-TW'), nowMs: NOW }) as never

// A golden lists the rows a page draws; the frame puts the left-over blank rows between the body and the action rows (fixed height). `closeGap` takes that run out of the rows
// (the strip already cut off) so a golden stays the page's own rows: `acts` = the rows the action area took (the empty-state row counts as one).
export const closeGap = (rows: string[], acts: number): string[] => {
  const n = rows.length - acts
  let a = n
  while (a > 1 && rows[a - 1].trim() === '') a--
  return [...rows.slice(0, a), ...rows.slice(n)]
}
