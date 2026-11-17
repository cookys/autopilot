// quota-pick.test.js — worstPool / rankPools (g2 folds A1 / A7, plan r2 §4.1): the red / yellow / green order, the no-pace fallback, null never read as 0.
// Run: node --test mods/live/pages/quota-pick.test.js   (also run by run-tests.sh)
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { worstPool, rankPools, classify } = require('./quota-pick.ts')
const { makeT } = require('../i18n.ts')

const NOW = 1794200000000
const H = 3600000
const base = { seven_day_pct: null, five_hour_pct: null, resets_at_ms: null, burn_pct_per_h: null, burn_window_h: 6, projected_pct_at_reset: null, projected_exhaustion_at_ms: null,
  verdict: null, limit_hit: null, stale: null, stale_age_min: null, stale_note: null, observed_at_ms: NOW - 40000, stranded_seats: null, stranded_seat_list: null, switched: null,
  seats: 1, projection_source: 'fleet', switch_suggestion: null }
const pool = (name, o = {}) => ({ ...base, pool: name, ...o })
const order = (pools) => rankPools(pools, NOW).map(v => v.pool).join(',')

test('worstPool: no pools -> null (null and empty are no source, never a pool)', () => {
  assert.equal(worstPool(null, NOW), null)
  assert.equal(worstPool([], NOW), null)
})

test('A7 table: each of the five rows gives its role and text', () => {
  const t = makeT('zh-TW')
  const v = (o, pace = true) => classify(pool('x', o), NOW, pace, t)
  assert.deepEqual([v({ limit_hit: true }).role, v({ limit_hit: true }).text], ['broken', '已用完，換池資料無來源'])
  assert.deepEqual([v({ limit_hit: true, stranded_seats: 3 }).role, v({ limit_hit: true, stranded_seats: 3 }).text], ['broken', '已用完，3 席停擺'])
  assert.deepEqual([v({ limit_hit: true, stranded_seats: 0, switched: 'lab' }).role, v({ limit_hit: true, stranded_seats: 0, switched: 'lab' }).text], ['success', '已用完，席位已切到 lab'])
  const ex = { projected_pct_at_reset: 120, projected_exhaustion_at_ms: NOW + 17 * H }
  assert.deepEqual([v({ ...ex, stranded_seats: 2 }).role, v({ ...ex, stranded_seats: 2 }).text], ['broken', '約 17 時後用完，2 席沒池可切'])
  assert.deepEqual([v({ ...ex, stranded_seats: 0 }).role, v({ ...ex, stranded_seats: 0 }).text], ['success', '約 17 時後用完，席位可切池'])
  assert.deepEqual([v(ex).role, v(ex).text], ['broken', '約 17 時後用完，換池資料無來源'])
  assert.deepEqual([v({ projected_pct_at_reset: 98 }).role, v({ projected_pct_at_reset: 98 }).text], ['success', '會用到 98%'])
  assert.deepEqual([v({ projected_pct_at_reset: 100 }).role, v({ projected_pct_at_reset: 95 }).role], ['success', 'success'])
  assert.deepEqual([v({ projected_pct_at_reset: 94 }).role, v({ projected_pct_at_reset: 43 }).text], ['warning', '約剩 57% 會浪費'])
  assert.ok(!/↑/.test(v({ projected_pct_at_reset: 98 }).text), 'A7: no ↑')
})

test('A7 order: limit_hit -> earliest finite exhaustion -> stale oldest first; then yellow by waste desc; then green', () => {
  const pools = [
    pool('green', { projected_pct_at_reset: 98 }),
    pool('lab', { projected_pct_at_reset: 43 }),
    pool('grok', { projected_pct_at_reset: 10 }),
    pool('twgame', { stale_note: '席 twgame-2 過期 14 分，舊值 55% 較高', stale_age_min: 14, projected_pct_at_reset: 94 }),
    pool('trinity', { stale: true, stale_age_min: 180, projected_pct_at_reset: 47 }),
    pool('late', { projected_pct_at_reset: 120, projected_exhaustion_at_ms: NOW + 30 * H }),
    pool('team', { projected_pct_at_reset: 120, projected_exhaustion_at_ms: NOW + 17 * H }),
    pool('personal', { limit_hit: true }),
  ]
  assert.equal(order(pools), 'personal,team,late,trinity,twgame,grok,lab,green')
  assert.deepEqual(worstPool(pools, NOW), { pool: 'personal', role: 'broken', text: '已用完，換池資料無來源' })
})

test('A7: an infinite or missing exhaustion time sorts after every finite one', () => {
  const a = pool('a', { projected_pct_at_reset: 110, projected_exhaustion_at_ms: null })
  const b = pool('b', { projected_pct_at_reset: 110, projected_exhaustion_at_ms: NOW + 50 * H })
  assert.equal(order([a, b]), 'b,a')
})

test('A1: a pool older than 10 minutes is stale (red, full reason) even when the feed did not flag it', () => {
  const t = makeT('zh-TW')
  const v = classify(pool('old', { observed_at_ms: NOW - 12 * 60000, stale_note: 'statusline 沒在跑', projected_pct_at_reset: 50 }), NOW, true, t)
  assert.equal(v.role, 'broken')
  assert.equal(v.text, '12 分未更新（>10 分；statusline 沒在跑）')
  assert.equal(classify(pool('fresh', { observed_at_ms: NOW - 9 * 60000, projected_pct_at_reset: 50 }), NOW, true, t).role, 'warning')
})

test('no pace anywhere (§4.1 fallback): limit hit -> stale > 10 min (oldest first) -> highest 7-day %', () => {
  const pools = [
    pool('codex', { seven_day_pct: 80 }),
    pool('team', { seven_day_pct: 68 }),
    pool('trinity', { seven_day_pct: 31, stale: true, stale_age_min: 180 }),
    pool('old2', { seven_day_pct: 5, stale: true, stale_age_min: 30 }),
    pool('personal', { seven_day_pct: 100, limit_hit: true }),
  ]
  assert.equal(order(pools), 'personal,trinity,old2,codex,team')
  assert.deepEqual(worstPool(pools.slice(0, 2), NOW), { pool: 'codex', role: 'broken', text: '7 天 80% 最高，沒有 pace' })
})

test('null stays null: a pool with every number null is not read as 0% (no pace, nothing flagged, rank last)', () => {
  const pools = [pool('empty'), pool('lab', { seven_day_pct: 22 })]
  assert.equal(order(pools), 'lab,empty')
})

test('negative control: a broken order (waste ascending) is caught by the same assertion', () => {
  const pools = [pool('lab', { projected_pct_at_reset: 43 }), pool('grok', { projected_pct_at_reset: 10 })]
  assert.notEqual(order(pools), 'lab,grok') // yellow is by waste desc: grok (90) before lab (57); the wrong order would make this equal
  assert.equal(order(pools), 'grok,lab')
})
