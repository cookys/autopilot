// mods/live/pages/spend.ts — v7.4 S6 花費 (PM 01M7N307, sub-task F): the 5h / 7d bars with relative resets, the quota pools (the old 額度 page folded in), today's token count and the 24h trend.
// No money anywhere (tokens only), no account block. Pure: reads seatQuota.view(), ctx.live and ctx.console only; a missing source is the existing broken row, never an invented one.
import type { Seg } from '../model'
import { displayWidth, sparkText } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { BAND_STALE_MS } from '../band-onerow'
import { MIN_DECODE_MS, fmtTps, mainSteps, summarize } from '../speed'
import { sparkline } from '../speedview'
import { meterKey } from '../ui'
import type { Page, PageCtx } from './frame'
import { SEATS_RED_AFTER_MS, ageUnit, seatQuota } from './now'
import { ROLE_WARNING, isUnknownPool, normalizedPools, poolKey, poolLabel, rankPools } from './quota-pick'
import type { QuotaPool } from './quota-pick'
import { shortVerdict } from './quota'
import { meteringRows } from './metering'
import { brokenRow, staleBadge, tokLabel } from './rows'
import type { Row } from './rows'

// the meter rows are not clickable in v7.4 (every clickable element outside the controls is 0), so the page keeps no focus row; the type stays for the pane's view table
export type SpendViewOpts = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: SpendViewOpts = { focus: 0, expanded: false }
export function spendFocusRows(_live?: unknown): number { return 0 }

const DASH = GLYPHS.structure.empty
const padR = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))
const padL = (text: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(text))) + text

// `2h10m`, `4d`, `35m`: the time left to a reset; null (no reset known) is a dash
export function resetIn(ms: number | null, nowMs: number, t: PageCtx['t']): string {
  if (ms === null) return DASH
  const min = Math.max(0, Math.floor((ms - nowMs) / 60_000))
  if (min >= 1440) return t('v74.f.rs_d', { n: Math.floor(min / 1440) })
  if (min >= 60) return min % 60 === 0 ? t('v74.f.rs_h', { h: Math.floor(min / 60) }) : t('v74.f.rs_hm', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') })
  return t('v74.f.rs_m', { n: min })
}

const openRule = (title: string): Row => [{ text: GLYPHS.structure.open + ' ' + title + ' ', color: PALETTE.idle }, { text: GLYPHS.structure.rule.repeat(2), color: PALETTE.structure }]

function meterRow(label: string, pct: number | null, reset: string, stale: boolean, t: PageCtx['t']): Row {
  const cells = 10
  const lbl = padR(label, 10)
  const tail: Seg[] = [...(stale ? [staleBadge(' ' + GLYPHS.state.failed)] : []), { text: '  ' + t('page.spend.reset', { t: reset }) }]
  if (pct === null) {
    // r10b #6: an unknown value draws no bar (an empty bar reads as 0%); it says the feed is not connected
    return [{ text: ' ' + lbl }, { text: DASH + ' ' + t('v74.f.q_unwired'), color: PALETTE.idle }, ...(reset === DASH ? [] : tail)]
  }
  const clamped = Math.max(0, Math.min(100, pct))
  const on = Math.max(0, Math.min(cells, Math.round((clamped / 100) * cells)))
  const color = stale ? PALETTE.broken : meterKey(clamped / 100)
  const c = color === undefined ? {} : { color }
  return [
    { text: ' ' + lbl },
    { text: padL(Math.floor(clamped + 1e-9) + '%', 4) + '  ', ...c },
    ...(on > 0 ? [{ text: GLYPHS.chart.meterOn.repeat(on), ...c }] : []),
    ...(cells - on > 0 ? [{ text: GLYPHS.chart.meterOff.repeat(cells - on), color: PALETTE.idle }] : []),
    ...tail,
  ]
}

function poolRows(ctx: PageCtx): Row[] {
  const { t, console: con, nowMs } = ctx
  if (con === null) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.quota.no_console'))]
  const pools = normalizedPools(con) as QuotaPool[] | null
  if (pools === null || pools.length === 0) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.quota.no_pools'))]
  const paceOk = con.sources.quota_forecast?.state === 'ok'
  const byName = new Map(pools.map(p => [p.pool, p]))
  const labelWidth = Math.max(displayWidth(t('v74.f.col_pool')), ...pools.map(p => displayWidth(poolLabel(p.pool)))) + 1
  const out: Row[] = [[{ text: '   ' + padR(t('v74.f.col_pool'), labelWidth) + t('v74.f.col_state'), dim: true }]]
  for (const v of rankPools(pools, nowMs, t)) {
    const p = byName.get(v.pool) as QuotaPool
    const glyphOf = (verdictText: string): string => verdictText.startsWith(GLYPHS.state.unknown + ' ') ? GLYPHS.state.unknown : v.role === 'broken' ? GLYPHS.state.failed : v.role === ROLE_WARNING ? GLYPHS.state.need_you : GLYPHS.state.pending
    const color = v.role === 'broken' ? PALETTE.broken : v.role === ROLE_WARNING ? PALETTE.attention : PALETTE.idle
    const ok = v.role !== 'broken' && v.role !== ROLE_WARNING && !isUnknownPool(v)
    const pct = p.five_hour_pct ?? p.seven_day_pct
    const verdict = ok && pct !== null ? Math.round(pct) + '%' : shortVerdict(p, v, nowMs, paceOk, t)
    const noForecast = verdict.startsWith(GLYPHS.state.unknown + ' ')
    const stateBase = verdict.startsWith(GLYPHS.state.failed + ' ') || noForecast ? verdict.slice(2) : verdict
    const isPoolStale = v.kind === 'stale' || v.kind === 'stale_seat'
    const state = isPoolStale ? stateBase + ' (' + t('page.spend.pool_stale_thr') + ')' : stateBase
    out.push([{ text: ' ' }, { text: glyphOf(verdict) + ' ', color }, { text: padR(poolLabel(v.pool), labelWidth) }, { text: state, ...(v.role === 'broken' ? { color: PALETTE.broken } : {}) }])
  }
  return out
}

// ---- capacity's pool forecast (schema capacity.pool-eta/1; a file capacity writes, later `fleet seats --by-pool`). Only the feed's own values are drawn: nothing is recomputed from the local clock
// except the one comparison "is the feed older than its stale_after_s".
export interface PoolEtaPool { pool: string; state: string; seven_day_pct: number | null; five_hour_pct: number | null; burn_pct_per_h: number | null; burn_reason: string | null; resets_at_ms: number | null; exhaust_at_ms: number | null; early_by_ms: number | null; alerts: readonly unknown[] }
export interface PoolEta { generated_at_ms: number; stale_after_s: number; pools: readonly PoolEtaPool[]; alerts: readonly unknown[] }
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
// text -> the feed, or null when it is not a capacity.pool-eta/1 document (unreadable, another schema, a missing field): the page then says so, never a guess
export function parsePoolEta(text: string): PoolEta | null {
  let j: unknown
  try { j = JSON.parse(text) } catch (_e) { return null }
  if (typeof j !== 'object' || j === null) return null
  const o = j as Record<string, unknown>
  const gen = numOrNull(o.generated_at_ms)
  const after = numOrNull(o.stale_after_s)
  if (o.schema !== 'capacity.pool-eta/1' || gen === null || after === null || !Array.isArray(o.pools)) return null
  const pools: PoolEtaPool[] = []
  for (const raw of o.pools) {
    if (typeof raw !== 'object' || raw === null) return null
    const p = raw as Record<string, unknown>
    if (typeof p.pool !== 'string' || typeof p.state !== 'string') return null
    pools.push({
      pool: p.pool, state: p.state, seven_day_pct: numOrNull(p.seven_day_pct), five_hour_pct: numOrNull(p.five_hour_pct), burn_pct_per_h: numOrNull(p.burn_pct_per_h),
      burn_reason: typeof p.burn_reason === 'string' ? p.burn_reason : null, resets_at_ms: numOrNull(p.resets_at_ms), exhaust_at_ms: numOrNull(p.exhaust_at_ms), early_by_ms: numOrNull(p.early_by_ms),
      alerts: Array.isArray(p.alerts) ? p.alerts : [],
    })
  }
  return { generated_at_ms: gen, stale_after_s: after, pools, alerts: Array.isArray(o.alerts) ? o.alerts : [] }
}

export function poolEtaRows(eta: PoolEta | null, nowMs: number, t: PageCtx['t']): Row[] {
  if (eta === null) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('v75.eta.none'))]
  const feedStale = eta.generated_at_ms + eta.stale_after_s * 1000 < nowMs // the only clock comparison on this page
  const out: Row[] = []
  if (feedStale) {
    const etaAge = ageUnit(t, Math.max(0, nowMs - eta.generated_at_ms))
    out.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('v75.eta.feed_stale') + ' · ' + t('page.spend.eta_stale_detail', { age: etaAge, s: eta.stale_after_s })))
  }
  const labelWidth = Math.max(0, ...eta.pools.map(p => displayWidth(poolLabel(p.pool)))) + 1
  for (const p of eta.pools) {
    const label: Seg = { text: padR(poolLabel(p.pool), labelWidth) }
    if (p.state === 'no_source') { out.push([{ text: ' ' }, { text: GLYPHS.state.unknown + ' ', color: PALETTE.idle }, label, { text: t('v75.eta.unmeasured'), dim: true }]); continue }
    if (p.state !== 'ok') { out.push([{ text: ' ' }, { text: GLYPHS.state.failed + ' ', color: PALETTE.broken }, label, staleBadge(t('v75.eta.row_stale'))]); continue }
    const pct = p.five_hour_pct ?? p.seven_day_pct
    const alert = p.alerts.length > 0
    const bad = feedStale ? { color: PALETTE.broken } : {}
    const burn = p.burn_pct_per_h === null ? DASH : p.burn_pct_per_h.toFixed(2).replace(/0$/, '') + '%/h'
    const exhaust = p.exhaust_at_ms !== null ? t('v75.eta.exhaust', { t: resetIn(p.exhaust_at_ms, nowMs, t) })
      : p.burn_reason === null ? t('v75.eta.no_exhaust') : t('v75.eta.exhaust_unknown', { why: p.burn_reason })
    out.push([
      { text: ' ' }, { text: (alert ? GLYPHS.state.need_you : GLYPHS.state.pending) + ' ', color: alert && !feedStale ? PALETTE.attention : PALETTE.idle }, label,
      { text: padL(pct === null ? DASH : Math.round(pct) + '%', 4) + '  ', ...bad }, { text: padL(burn, 8) + '  ' + t('page.spend.reset', { t: resetIn(p.resets_at_ms, nowMs, t) }) + '  ', ...bad }, { text: exhaust, ...(alert && !feedStale ? { color: PALETTE.attention } : {}) },
      ...(feedStale ? [staleBadge(' ' + t('v75.eta.row_stale'))] : []),
    ])
  }
  return out
}

function speedSection(ctx: PageCtx): Row[] {
  const { t, nowMs } = ctx
  const steps = ctx.steps ?? []
  const out: Row[] = [openRule(t('page.spend.sec_speed'))]
  if (steps.length === 0) {
    out.push([{ text: ' ' + DASH + ' ' + t('page.spend.speed_none'), dim: true }])
    return out
  }
  const lastStep = steps[steps.length - 1]
  const ageMs = Math.max(0, nowMs - lastStep.at)
  const age = ageUnit(t, ageMs)
  const isStale = ageMs > BAND_STALE_MS
  if (lastStep.tps !== null) {
    const exactTps = fmtTps(lastStep.tps, DASH)
    const lineText = t('page.spend.speed_latest', { tps: exactTps, age })
    out.push(isStale ? [{ text: ' ' }, staleBadge(lineText + ' ' + GLYPHS.state.failed)] : [{ text: ' ' + lineText }])
  } else {
    const reason = lastStep.decodeMs === null
      ? t('page.spend.speed_no_stream', { age })
      : lastStep.decodeMs < MIN_DECODE_MS
        ? t('page.spend.speed_short_window', { ms: Math.round(lastStep.decodeMs), min: MIN_DECODE_MS, age })
        : t('page.spend.speed_no_tokens', { age })
    out.push([{ text: ' ' + DASH + ' ' + reason, dim: true }])
  }
  if (isStale) {
    out.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.speed_stale', { age })))
  }
  const main = mainSteps(steps)
  const basis = main.length > 0 ? main : steps
  const sum = summarize(basis)
  const recent = steps.slice(-5)
  const hasTimed = sum.avgTps !== null || sum.bestTps !== null
  if (hasTimed) {
    const bars = sparkline(recent.map(s => s.tps))
    const stats = t('page.spend.speed_stats', { avg: fmtTps(sum.avgTps, DASH), best: fmtTps(sum.bestTps, DASH), n: sum.requests })
    out.push([{ text: ' ' }, { text: bars, color: isStale ? PALETTE.idle : PALETTE.running }, { text: '  ' + stats, dim: true }])
  }
  return out
}

export function renderSpend(ctx: PageCtx, _view: SpendViewOpts = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const { t, live, console: con, nowMs } = ctx
  const qFeed = seatQuota.view()
  const qWins = live?.account?.quota ?? []
  const win5 = qWins.find(w => w.kind === 'five_hour')
  const win7 = qWins.find(w => w.kind === 'seven_day')
  const row = qFeed.row
  const ageMs = qFeed.got_at_ms === null ? null : Math.max(0, nowMs - qFeed.got_at_ms)
  const stale = row !== null && (row.stale === true || (ageMs !== null && ageMs > SEATS_RED_AFTER_MS))
  const body: Row[] = [openRule(t('v74.f.sec_quota'))]

  if (row !== null || win5 !== undefined || win7 !== undefined) {
    const poolReset = (() => {
      const pools = con?.quota.pools ?? null
      const want = row?.pool == null ? null : poolKey(row.pool)
      return pools === null || want === null ? null : (pools.find(p => poolKey(p.pool) === want)?.resets_at_ms ?? null)
    })()
    body.push(meterRow(t('label.quota_5h'), row?.five_hour_pct ?? win5?.pct ?? null, resetIn(win5?.resetsAtMs ?? null, nowMs, t), stale, t))
    body.push(meterRow(t('label.quota_7d'), row?.seven_day_pct ?? win7?.pct ?? null, resetIn(win7?.resetsAtMs ?? poolReset, nowMs, t), stale, t))
    if (stale) {
      body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t(ageMs !== null && ageMs >= 60_000 ? 'page.spend.q_stale' : 'page.spend.q_stale_plain', { min: Math.floor((ageMs ?? 0) / 60_000) })))
      if (qFeed.failed) {
        body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.q_failed_stale', { age: ageMs === null ? DASH : ageUnit(t, ageMs) })))
      }
    } else if (row !== null && qFeed.failed) {
      body.push([{ text: ' ' + GLYPHS.state.need_you + ' ' + t('page.spend.q_failed_cached', { age: ageMs === null ? DASH : ageUnit(t, ageMs) }), color: PALETTE.attention }])
    } else if (row !== null && ageMs !== null) {
      body.push([{ text: ' ' + t('page.spend.q_meta', { age: ageUnit(t, ageMs) }), dim: true }])
    } else if (row === null) {
      if (qFeed.failed) body.push([{ text: ' ' + GLYPHS.state.need_you + ' ' + t('page.spend.q_failed_live'), color: PALETTE.attention }])
      else body.push([{ text: ' ' + t('page.spend.q_meta_live'), dim: true }])
    }
  } else {
    body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t(qFeed.failed ? 'page.now.q_failed_none' : 'page.now.q_none')))
  }
  body.push([{ text: '' }], ...(ctx.poolEta === undefined ? poolRows(ctx) : poolEtaRows(ctx.poolEta, nowMs, t)), [{ text: '' }])
  body.push(...meteringRows(ctx.meter ?? null, nowMs, t))

  body.push(openRule(t('v74.f.sec_today')))
  const sp = live?.detail.spend ?? null
  const publishedMs = live?.published_at != null && Number.isFinite(Date.parse(live.published_at)) ? Date.parse(live.published_at) : null
  const liveAgeStale = live !== null && live.state === 'ok' && publishedMs !== null && Math.max(0, nowMs - publishedMs) > BAND_STALE_MS
  if (live === null) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.now.no_live')))
  else if (sp === null) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.no_spend')))
  else {
    const n = sp.tok?.host ?? sp.tok?.session ?? null // the real token fields; host_all_n / brain are money and never drawn
    const val: Seg = n === null
      ? { text: t('v74.f.tok_unknown') + ' · ' + t('page.spend.tok_no_feed'), dim: true }
      : live.state !== 'ok' || liveAgeStale ? staleBadge(tokLabel(n, t) + ' ' + GLYPHS.state.failed) : { text: tokLabel(n, t) }
    body.push([{ text: ' ' + padR(t('page.spend.today_label'), 8) }, val])
    if (live.state !== 'ok') body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.stale_live', { why: (live.header ?? '').trim() || live.state })))
    else if (liveAgeStale && publishedMs !== null) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.live_age_stale', { age: ageUnit(t, Math.max(0, nowMs - publishedMs)) })))
  }

  body.push(openRule(t('v74.f.sec_24h')))
  const hourly = sp?.hourly ?? null
  if (hourly !== null && hourly.length > 0) {
    const last = hourly.slice(-24)
    // r11 #11: the chart says its unit and source, and when today's total is unknown above, that the two do not come from the same number
    body.push([{ text: ' ' + t('v74.f.chart_note', { n: last.length }), dim: true }])
    if ((sp?.tok?.host ?? sp?.tok?.session ?? null) === null) body.push([{ text: ' ' + t('v74.f.chart_note_notoday'), dim: true }])
    body.push([{ text: ' ' + sparkText(last) }])
  } else {
    const no24h = live === null ? t('page.spend.no_24h_nolive') : sp === null ? t('page.spend.no_24h_nospend') : t('page.spend.no_24h_reason')
    body.push([{ text: ' ' + DASH + ' ' + no24h, dim: true }])
  }

  body.push([{ text: '' }], ...speedSection(ctx))

  const broken = row === null || stale || live === null || live.state !== 'ok' || sp === null || con === null
  return { body, actions: broken ? [[{ text: t('frame.unknown'), dim: true }]] : [] }
}

export const spendPage: Page = { id: 'spend', key: '5', title: '花費', framed: true, render: ctx => renderSpend(ctx) }
