// mods/live/fixtures/v74/pool-eta.fixture.ts — a real capacity.pool-eta/1 read of 2026-11-21 12:30Z, pool names replaced with fake ones (the repo is public). A module because a *.test.ts may not read a file.
const early = (pool: string, ms: number) => ({ pool, kind: 'early_exhaust', early_by_ms: ms, action: 'card' })
const none = { burn_pct_per_h: null, burn_window_h: null, exhaust_at_ms: null, early_by_ms: null, alerts: [] }
export default {
  schema: 'capacity.pool-eta/1', generated_at_ms: 1795264203210, generated_at: '2026-11-21T12:30:03Z', stale_after_s: 1200, pace_generated_at_ms: 1795263633000,
  alerts: [early('alpha', 241047000)],
  pools: [
    { pool: 'alpha', state: 'ok', seen_at_ms: 1795262940000, seven_day_pct: 54, five_hour_pct: null, resets_at_ms: 1795665600000, burn_pct_per_h: 1.03, burn_window_h: 5.8, exhaust_at_ms: 1795424553000, early_by_ms: 241047000, burn_reason: null, alerts: [early('alpha', 241047000)] },
    { pool: 'beta', state: 'no_source', seen_at_ms: 1795261020000, seven_day_pct: null, five_hour_pct: null, resets_at_ms: 1795564800000, burn_reason: '無讀數', ...none },
    { pool: 'gamma', state: 'ok', seen_at_ms: 1795262220000, seven_day_pct: 3, five_hour_pct: 4, resets_at_ms: 1795863420000, burn_reason: '無讀數:此池沒有每池 token 來源', ...none },
    { pool: 'delta', state: 'ok', seen_at_ms: 1795262220000, seven_day_pct: 20, five_hour_pct: null, resets_at_ms: 1795663000000, burn_pct_per_h: 0.2, burn_window_h: 5.8, exhaust_at_ms: null, early_by_ms: null, burn_reason: null, alerts: [] },
    { pool: 'epsilon', state: 'expired', seen_at_ms: 1795000000000, seven_day_pct: 90, five_hour_pct: null, resets_at_ms: 1795500000000, burn_reason: '過期', ...none },
  ],
}
