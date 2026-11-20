// mods/live/pages/spend.ts — v7.4 S6 花費 (PM 01M7N307, sub-task F): the 5h / 7d bars with relative resets, the quota pools (the old 額度 page folded in), today's token count and the 24h trend.
// No money anywhere (tokens only), no account block. Pure: reads seatQuota.view(), ctx.live and ctx.console only; a missing source is the existing broken row, never an invented one.
import type { Seg } from '../model'
import { displayWidth, sparkText } from '../model'
import { fmtCount } from '../speed'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { meterKey } from '../ui'
import type { Page, PageCtx } from './frame'
import { SEATS_RED_AFTER_MS, seatQuota } from './now'
import { ROLE_WARNING, isUnknownPool, normalizedPools, poolKey, poolLabel, rankPools } from './quota-pick'
import type { QuotaPool } from './quota-pick'
import { shortVerdict } from './quota'
import { brokenRow, staleBadge } from './rows'
import type { Row } from './rows'

// the meter rows are not clickable in v7.4 (every clickable element outside the controls is 0), so the page keeps no focus row; the type stays for the pane's view table
export type SpendViewOpts = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: SpendViewOpts = { focus: 0, expanded: false }
export function spendFocusRows(_live?: unknown): number { return 0 }

const DASH = GLYPHS.structure.empty
const padR = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))
const padL = (text: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(text))) + text

// `2h10m`, `4d`, `35m`: the time left to a reset; null (no reset known) is a dash
export function resetIn(ms: number | null, nowMs: number): string {
  if (ms === null) return DASH
  const min = Math.max(0, Math.floor((ms - nowMs) / 60_000))
  if (min >= 1440) return Math.floor(min / 1440) + 'd'
  if (min >= 60) return Math.floor(min / 60) + 'h' + (min % 60 === 0 ? '' : String(min % 60).padStart(2, '0') + 'm')
  return min + 'm'
}

const openRule = (title: string): Row => [{ text: GLYPHS.structure.open + ' ' + title + ' ' + GLYPHS.structure.rule.repeat(2), color: PALETTE.structure }]

function meterRow(label: string, pct: number | null, reset: string, stale: boolean, t: PageCtx['t']): Row {
  const cells = 10
  const lbl = padR(label, 8)
  const tail: Seg[] = [...(stale ? [staleBadge(' ' + GLYPHS.state.failed)] : []), { text: '  ' + t('page.spend.reset', { t: reset }) }]
  if (pct === null) {
    return [{ text: ' ' + lbl }, { text: GLYPHS.chart.meterOff.repeat(cells), color: PALETTE.idle }, { text: ' ' + padL(DASH, 4), color: PALETTE.idle }, ...tail]
  }
  const clamped = Math.max(0, Math.min(100, pct))
  const on = Math.max(0, Math.min(cells, Math.round((clamped / 100) * cells)))
  const color = stale ? PALETTE.broken : meterKey(clamped / 100)
  const c = color === undefined ? {} : { color }
  return [
    { text: ' ' + lbl },
    ...(on > 0 ? [{ text: GLYPHS.chart.meterOn.repeat(on), ...c }] : []),
    ...(cells - on > 0 ? [{ text: GLYPHS.chart.meterOff.repeat(cells - on), color: PALETTE.idle }] : []),
    { text: ' ' + padL(Math.floor(clamped + 1e-9) + '%', 4), ...c },
    ...tail,
  ]
}

const tokLabel = (n: number): string => (n >= 1_000_000 ? fmtCount(n) : n >= 1000 ? String(Math.round(n / 1000)) + 'k' : String(n)) + ' tok'

function poolRows(ctx: PageCtx): Row[] {
  const { t, console: con, nowMs } = ctx
  if (con === null) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.quota.no_console'))]
  const pools = normalizedPools(con) as QuotaPool[] | null
  if (pools === null || pools.length === 0) return [brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.quota.no_pools'))]
  const paceOk = con.sources.quota_forecast?.state === 'ok'
  const byName = new Map(pools.map(p => [p.pool, p]))
  const out: Row[] = [[{ text: '   ' + padR(t('v74.f.col_pool'), 10) + t('v74.f.col_state'), dim: true }]]
  for (const v of rankPools(pools, nowMs, t)) {
    const p = byName.get(v.pool) as QuotaPool
    const glyph = v.role === 'broken' ? GLYPHS.state.failed : v.role === ROLE_WARNING ? GLYPHS.state.need_you : GLYPHS.state.pending
    const color = v.role === 'broken' ? PALETTE.broken : v.role === ROLE_WARNING ? PALETTE.attention : PALETTE.idle
    const ok = v.role !== 'broken' && v.role !== ROLE_WARNING && !isUnknownPool(v)
    const pct = p.five_hour_pct ?? p.seven_day_pct
    const state = ok && pct !== null ? Math.round(pct) + '%' : shortVerdict(p, v, nowMs, paceOk, t)
    out.push([{ text: ' ' }, { text: glyph + ' ', color }, { text: padR(poolLabel(v.pool), 10) }, { text: state, ...(v.role === 'broken' ? { color: PALETTE.broken } : {}) }])
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
    body.push(meterRow(t('label.quota_5h'), row?.five_hour_pct ?? win5?.pct ?? null, resetIn(win5?.resetsAtMs ?? null, nowMs), stale, t))
    body.push(meterRow(t('label.quota_7d'), row?.seven_day_pct ?? win7?.pct ?? null, resetIn(win7?.resetsAtMs ?? poolReset, nowMs), stale, t))
    if (stale) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t(ageMs !== null && ageMs >= 60_000 ? 'page.spend.q_stale' : 'page.spend.q_stale_plain', { min: Math.floor((ageMs ?? 0) / 60_000) })))
  } else {
    body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t(qFeed.failed ? 'page.now.q_failed_none' : 'page.now.q_none')))
  }
  body.push([{ text: '' }], ...poolRows(ctx), [{ text: '' }])

  body.push(openRule(t('v74.f.sec_today')))
  const sp = live?.detail.spend ?? null
  if (live === null) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.now.no_live')))
  else if (sp === null) body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.no_spend')))
  else {
    const n = sp.host_all_n ?? sp.brain
    const val: Seg = n === null ? { text: DASH, dim: true } : live.state !== 'ok' ? staleBadge(tokLabel(n) + ' ' + GLYPHS.state.failed) : { text: tokLabel(n) }
    body.push([{ text: ' ' + padR(t('page.spend.today_label'), 8) }, val])
    if (live.state !== 'ok') body.push(brokenRow(' ' + GLYPHS.state.failed + ' ' + t('page.spend.stale_live', { why: (live.header ?? '').trim() || live.state })))
  }

  body.push(openRule(t('v74.f.sec_24h')))
  const hourly = sp?.hourly ?? null
  if (hourly !== null && hourly.length > 0) body.push([{ text: ' ' + sparkText(hourly.slice(-24)) }])
  else body.push([{ text: ' ' + DASH, dim: true }])

  const broken = row === null || stale || live === null || live.state !== 'ok' || sp === null || con === null
  return { body, actions: broken ? [[{ text: t('frame.unknown'), dim: true }]] : [] }
}

export const spendPage: Page = { id: 'spend', key: '5', title: '花費', framed: true, render: ctx => renderSpend(ctx) }
