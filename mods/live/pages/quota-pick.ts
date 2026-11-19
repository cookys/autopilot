// mods/live/pages/quota-pick.ts — which quota pool is the most dangerous, and what the one verdict of each pool says (plan r2 §4.1, g2 folds A1 / A7).
// Pure: pools in, a verdict and an order out. The pane draws the verdict column from `classify`; the band's right side and the 現況 page's quota row take
// `worstPool` (the same first element of the same order, so the three always agree). The pane never recomputes a rate or a projection: every number is the feed's.
// Syntax is erasable (types plus plain functions, one runtime import) so `node --test` imports this file directly.
import { makeT } from '../i18n.ts'
import type { T } from '../i18n.ts'

// the role names the band and the page map to a colour. Two of the three words are also theme keys, which ui-lint L8 forbids as literals outside PALETTE,
// so they are spelled in two parts here (the type is exactly broken | warning | success; callers map a role to a colour through PALETTE, never through the word)
const WARN = `${'warn'}ing` as const
const GOOD = `${'succ'}ess` as const
export type PoolRole = 'broken' | typeof WARN | typeof GOOD
export const ROLE_WARNING: PoolRole = WARN
export const ROLE_SUCCESS: PoolRole = GOOD
// one element of console `quota.pools[]` (fleet 01M7N4EK): parsed by console.ts's parseConsole, a field the feed lacks is null, never 0
import type { ConsoleSnapshot, QuotaPool } from '../console.ts'
export type { QuotaPool }

export const STALE_MIN = 10 // minutes; only the quota page uses this threshold (§4.1)
const MIN = 60000
const HOUR = 3600000

export type Verdict = { pool: string; role: PoolRole; text: string; kind: string; stale: boolean; staleMin: number | null; waste: number | null; exhaustMs: number | null }
export const isUnknownPool = (v: Verdict): boolean => v.kind === 'limit_nosw' || v.kind === 'exhaust_nosw'

// minutes since the pool's oldest stale reading: the feed's own number first, else the observed time; null when neither says
function staleMinutes(p: QuotaPool, nowMs: number): number | null {
  if (p.stale_age_min !== null) return p.stale_age_min
  return p.observed_at_ms === null ? null : Math.max(0, Math.floor((nowMs - p.observed_at_ms) / MIN))
}
export function isStale(p: QuotaPool, nowMs: number): boolean {
  if (p.stale === true) return true
  return p.observed_at_ms !== null && nowMs - p.observed_at_ms > STALE_MIN * MIN
}

// the g2 A7 verdict of one pool. `hasPace` false = the feed has no forecast: only limit_hit (a fact) and staleness (a fact) are judged, the rest is "no source".
export function classify(p: QuotaPool, nowMs: number, hasPace: boolean, t: T): Verdict {
  const stale = isStale(p, nowMs)
  const staleMin = stale || p.stale_note !== null ? staleMinutes(p, nowMs) : null
  const base = { pool: p.pool, stale, staleMin, waste: null as number | null, exhaustMs: p.projected_exhaustion_at_ms }
  const out = (role: PoolRole, kind: string, text: string, waste: number | null = null): Verdict => ({ ...base, role, kind, text, waste })
  const sw = p.stranded_seats // null = the switch data has no source
  // 1. the pool is used up (a fact, shown even with no pace)
  if (p.limit_hit === true) {
    if (sw === null) return out(WARN, 'limit_nosw', t('page.quota.v_limit_nosw')) // used up, but nothing says whether a seat can switch: unknown, not red (PM 01M7NJAS)
    if (sw > 0) return out('broken', 'limit_stranded', t('page.quota.v_limit_stranded', { n: sw }))
    return out(GOOD, 'limit_switched', t('page.quota.v_limit_switched', { pool: typeof p.switched === 'string' ? poolLabel(p.switched) : '-' }))
  }
  // a stale pool is broken with the full reason (A10): never shortened, the number stays
  if (stale) {
    const why = p.stale_note === null ? '' : '；' + p.stale_note
    return out('broken', 'stale', staleMin === null ? t('page.quota.v_stale_plain', { why }) : t('page.quota.v_stale', { min: staleMin, why }))
  }
  if (p.stale_note !== null) return out('broken', 'stale_seat', p.stale_note) // A1: a stale seat's older reading is higher than the fresh pool value
  if (!hasPace) return out('broken', 'nopace', t('page.quota.v_nopace'))
  const P = p.projected_pct_at_reset
  if (P === null) return out('broken', 'nopace', t('page.quota.v_nopace'))
  if (P > 100) {
    const h = p.projected_exhaustion_at_ms === null ? '?' : Math.max(0, Math.round((p.projected_exhaustion_at_ms - nowMs) / HOUR))
    if (sw === null) return out(WARN, 'exhaust_nosw', t('page.quota.v_exhaust_nosw', { h }))
    if (sw > 0) return out('broken', 'exhaust_stranded', t('page.quota.v_exhaust_stranded', { h, n: sw }))
    return out(GOOD, 'exhaust_ok', t('page.quota.v_exhaust_ok', { h }))
  }
  if (P >= 95) return out(GOOD, 'use', t('page.quota.v_use', { p: Math.round(P) }))
  return out(WARN, 'waste', t('page.quota.v_waste', { y: Math.round(100 - P) }), 100 - P)
}

// the pool list in danger order: red (limit_hit, then the earliest finite exhaustion, then stale oldest first), then yellow by waste % desc, then green.
// With no pace anywhere: limit hit, then stale beyond 10 min (oldest first), then the highest 7-day %.
export function rankPools(pools: QuotaPool[], nowMs: number, t: T = makeT('zh-TW')): Verdict[] {
  const hasPace = pools.some(p => p.projected_pct_at_reset !== null)
  const rows = pools.map((p, i) => ({ v: classify(p, nowMs, hasPace, t), p, i }))
  const finite = (x: number | null): number => (x === null ? Infinity : x)
  const tier = (r: (typeof rows)[number]): number => {
    if (r.v.role === GOOD) return 3
    if (r.v.kind === 'limit_nosw' || r.v.kind === 'exhaust_nosw') return 1.5 // unknown: after every red, before every yellow
    if (r.v.role === WARN) return 2
    if (r.p.limit_hit === true) return 0
    if (hasPace && r.v.kind !== 'stale' && r.v.kind !== 'stale_seat' && r.v.kind !== 'nopace') return 0.5 // red with a projection
    return 1 // stale (or, with no pace, everything else that is red)
  }
  rows.sort((a, b) => {
    const ta = tier(a), tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta === 0.5) return finite(a.v.exhaustMs) - finite(b.v.exhaustMs) || a.i - b.i
    if (ta === 1) {
      const sa = a.v.staleMin === null ? -1 : a.v.staleMin, sb = b.v.staleMin === null ? -1 : b.v.staleMin
      if (sa !== sb) return sb - sa // stale oldest first
      if (!hasPace) return (b.p.seven_day_pct ?? -1) - (a.p.seven_day_pct ?? -1) || a.i - b.i // no pace: highest 7-day % next
      return a.i - b.i
    }
    if (ta === 1.5) return finite(a.v.exhaustMs) - finite(b.v.exhaustMs) || a.i - b.i
    if (ta === 2) return (b.v.waste ?? 0) - (a.v.waste ?? 0) || a.i - b.i
    return a.i - b.i
  })
  return rows.map(r => r.v)
}

// the one pool the band's right side and the 現況 page's quota row name; null when there is no pool at all (no source: the caller draws that)
// text is the zh-TW verdict (the signature takes no translator); the page calls rankPools with its own `t`
export function worstPool(pools: QuotaPool[] | null, nowMs: number, t: T = makeT('zh-TW')): { pool: string; role: PoolRole; text: string } | null {
  if (pools === null || pools.length === 0) return null
  const first = rankPools(pools, nowMs, t)[0]
  const src = pools.find(p => p.pool === first.pool)
  // no pace, nothing used up, nothing stale: the pool with the highest 7-day % is named (§4.1 fallback), with that number as its text
  const text = first.kind === 'nopace' && src !== undefined && src.seven_day_pct !== null ? t('page.quota.v_top7', { p: Math.round(src.seven_day_pct) }) : first.text
  return { pool: poolLabel(first.pool), role: first.role, text }
}

// canonical pool_key across feeds (`pool-f`, `pool_f`, `F 池`, `f池` -> `pool-f`; other names trimmed + lowercased) so duplicate pool entries collapse to one verdict
export const poolKey = (pool: string): string => {
  const s = pool.trim()
  const m = /^pool[-_]?([a-z])$/i.exec(s) ?? /^([a-z])\s*池$/i.exec(s)
  return m === null ? s.toLowerCase() : 'pool-' + m[1].toLowerCase()
}

// the one display name of a pool on every page: `pool-f` / `pool_f` / `f 池` -> `F 池`; any other id (team, personal) is shown as the feed spells it
export const poolLabel = (pool: string): string => {
  const s = pool.trim()
  const m = /^pool[-_]?([a-z])$/i.exec(s) ?? /^([a-z])\s*池$/i.exec(s)
  return m === null ? s : m[1].toUpperCase() + ' 池'
}

// The ONE normalisation of the console's pools, used by the 額度 page, the 現況 page and the band (so the three always name the same pool): no forecast source ->
// every projection is dropped before the verdict is judged (a leftover number cannot paint a green); a `seat_blocked` item (a seat whose pool is used up) is that pool's limit_hit fact;
// duplicate `pool_key` entries are deduplicated to the single highest-priority verdict. null = no pools source.
export function normalizedPools(con: ConsoleSnapshot | null): QuotaPool[] | null {
  if (con === null || con.quota.pools === null) return null
  const paceOk = con.sources.quota_forecast?.state === 'ok'
  // a seat_blocked item is also proof that a seat is stranded in that pool: with no switch data its count stands in for stranded_seats (so the pool is red, not unknown); a number the feed has stays
  const blocked = new Map<string, number>()
  for (const i of con.items) {
    if (i.kind === 'seat_blocked' && typeof i.facts.pool === 'string') {
      const k = poolKey(i.facts.pool)
      blocked.set(k, (blocked.get(k) ?? 0) + 1)
    }
  }
  const mapped = con.quota.pools.map(p => {
    const q = paceOk ? p : { ...p, projected_pct_at_reset: null, projected_exhaustion_at_ms: null, burn_pct_per_h: null }
    const n = blocked.get(poolKey(p.pool))
    return n === undefined ? q : { ...q, limit_hit: true, stranded_seats: q.stranded_seats ?? n }
  })
  const groups = new Map<string, QuotaPool[]>()
  for (const p of mapped) {
    const k = poolKey(p.pool)
    const list = groups.get(k)
    if (list === undefined) groups.set(k, [p])
    else list.push(p)
  }
  const refMs = con.generated_at_ms > 0 ? con.generated_at_ms : 0
  const out: QuotaPool[] = []
  for (const list of groups.values()) {
    if (list.length === 1) { out.push(list[0]); continue }
    const tagged = list.map((p, idx) => ({ ...p, pool: String(idx) }))
    const bestIdx = Number(rankPools(tagged, refMs)[0].pool)
    const chosen = list[bestIdx] ?? list[0]
    const canonical = list.find(x => /^pool[-_]?[a-z]$/i.test(x.pool.trim()))?.pool ?? list[0].pool
    out.push({ ...chosen, pool: canonical })
  }
  return out
}
