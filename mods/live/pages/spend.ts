// mods/live/pages/spend.ts — page 7 花費 (plan r2 §2 row 7, §3.1, §5): own-seat 5h / 7d quota bars and reset times (from seatQuota + session usage / console pool reset),
// today's spend and 24h sparkline (from live.detail.spend), foldable extra Spend-tab details (brain cap, host breakdown, 24h peak, account), and the [4] jump to 額度.
// Pure: reads seatQuota.view(), ctx.live and ctx.console only; colours through PALETTE / meterKey, glyphs through GLYPHS, stale/missing sources red and never truncated.
import type { ConsoleSnapshot } from '../console'
import type { T } from '../i18n'
import type { AccountView, LiveSnapshot, QuotaWindow, Seg, SpendView } from '../model'
import { displayWidth, sparkText, truncateToWidth } from '../model'
import { GLYPHS } from '../../tux/glyphs.ts'
import { PALETTE } from '../../tux/palette.ts'
import { meterKey, money } from '../ui'
import type { Page, PageCtx } from './frame'
import { SEATS_RED_AFTER_MS, seatQuota } from './now'
import type { SeatQuotaRow } from './now'
import { poolKey, poolLabel } from './quota-pick'
import { brokenRow, staleBadge } from './rows'
import type { Row } from './rows'

export type SpendViewOpts = { focus: number; expanded: boolean }
export const DEFAULT_VIEW: SpendViewOpts = { focus: 0, expanded: false }

const clampFocus = (focus: number): number => Math.max(0, Math.min(1, focus))

export function spendFocusRows(live: LiveSnapshot | null): number {
  const qWins = live?.account?.quota ?? []
  return seatQuota.view().row !== null || qWins.some(w => w.kind === 'five_hour' || w.kind === 'seven_day') ? 2 : 0
}

const DASH = GLYPHS.structure.empty
const padR = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))
const padL = (text: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(text))) + text

function ageUnit(t: T, ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t('page.now.age_s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('page.now.age_m', { n: m })
  const h = Math.floor(m / 60)
  return h < 24 ? t('page.now.age_h', { n: h }) : t('page.now.age_d', { n: Math.floor(h / 24) })
}
const ageOf = (t: T, ms: number): string => t('page.now.ago', { age: ageUnit(t, ms) })

function tpe(ms: number): { mo: string; d: string; dow: number; hh: string; mm: string } {
  const dt = new Date(ms + 8 * 3_600_000)
  const z = (n: number): string => String(n).padStart(2, '0')
  return { mo: z(dt.getUTCMonth() + 1), d: z(dt.getUTCDate()), dow: dt.getUTCDay(), hh: z(dt.getUTCHours()), mm: z(dt.getUTCMinutes()) }
}

function reset5Text(ms: number | null, t: T): string {
  if (ms === null) return t('page.spend.reset', { t: DASH })
  const x = tpe(ms)
  return t('page.spend.reset', { t: x.hh + ':' + x.mm })
}

function reset7Text(ms: number | null, wide: boolean, t: T): string {
  if (ms === null) return t('page.spend.reset', { t: DASH })
  const x = tpe(ms)
  const dows = t('page.quota.dow').split(' ')
  const dow = dows[x.dow] ?? ''
  return t('page.spend.reset', { t: wide ? `${x.mo}-${x.d} ${dow} ${x.hh}:${x.mm}` : dow })
}

function sectionRule(title: string, wide: boolean): Row {
  const r2 = GLYPHS.structure.rule + GLYPHS.structure.rule
  const gapAfter = title.endsWith('）') ? '' : ' '
  const head = r2 + ' ' + title + gapAfter + r2
  const fill = wide ? GLYPHS.structure.rule.repeat(Math.max(0, 54 - displayWidth(head))) : ''
  return [{ text: head + fill, color: PALETTE.structure }]
}

function seatHeaderTitle(t: T, wide: boolean, row: SeatQuotaRow | null, ageMs: number | null, staleQuota: boolean): string {
  if (row === null) return t('page.now.seat_plain')
  const pool = row.pool === null ? null : poolLabel(row.pool)
  const age = ageMs === null ? null : ageOf(t, ageMs)
  const seat = row.seat !== null && row.seat !== '' ? row.seat : null
  if (wide && seat !== null) {
    if (pool !== null) return staleQuota || age === null ? t('page.spend.head_wide_stale', { seat, pool }) : t('page.spend.head_wide_fresh', { seat, age, pool })
    return staleQuota || age === null ? t('page.spend.head_wide_nopool_stale', { seat }) : t('page.spend.head_wide_nopool', { seat, age })
  }
  if (pool !== null) return staleQuota || age === null ? t('page.spend.head_narrow_stale', { pool }) : t('page.spend.head_narrow_fresh', { pool, age })
  return !staleQuota && age !== null ? t('page.spend.head_narrow_age', { age }) : t('page.now.seat_plain')
}

function meterRow(opts: { focused: boolean; label: string; pct: number | null; reset: string; wide: boolean; stale: boolean; press?: string }): Row {
  const { focused, label, pct, reset, wide, stale, press } = opts
  const withPress = (r: Row): Row => (press === undefined ? r : r.map(s => ({ ...s, press })))
  const mark = wide ? (focused ? GLYPHS.structure.folded : ' ') + ' ' : focused ? GLYPHS.structure.folded : ' '
  const lblW = wide ? 8 : displayWidth(label) <= 2 ? 2 : 3
  const lbl = wide ? padR(label, lblW) : padR(label, lblW) + ' '
  const cells = wide ? 20 : 10
  const tail: Seg[] = wide
    ? stale
      ? [staleBadge(' ' + GLYPHS.state.failed), { text: '  ' + reset }]
    : [{ text: '    ' + reset }]
    : stale
      ? [staleBadge(' ' + GLYPHS.state.failed), { text: ' ' + reset }]
      : [{ text: ' ' + reset }]
  if (pct === null) {
    const pctMissing = ' ' + padL(DASH, wide ? 4 : 3)
    return withPress([{ text: mark + lbl }, { text: GLYPHS.chart.meterOff.repeat(cells), color: PALETTE.idle }, { text: pctMissing, color: PALETTE.idle }, ...tail])
  }
  const clamped = Math.max(0, Math.min(100, pct))
  const ratio = clamped / 100
  const on = Math.max(0, Math.min(cells, Math.round(Math.min(1, ratio) * cells)))
  const off = cells - on
  const barColor = stale ? PALETTE.broken : meterKey(ratio)
  const pctStr = ' ' + padL(Math.floor(clamped + 1e-9) + '%', wide ? 4 : 3)
  const segs: Seg[] = [{ text: mark + lbl }]
  if (on > 0) segs.push({ text: GLYPHS.chart.meterOn.repeat(on), ...(barColor === undefined ? {} : { color: barColor }) })
  if (off > 0) segs.push({ text: GLYPHS.chart.meterOff.repeat(off), color: PALETTE.idle })
  segs.push({ text: pctStr, ...(barColor === undefined ? {} : { color: barColor }) }, ...tail)
  return withPress(segs)
}

function matchedPoolResetMs(con: ConsoleSnapshot | null, pool: string | null): number | null {
  if (con === null || pool === null || con.quota.pools === null) return null
  const want = poolKey(pool)
  const hit = con.quota.pools.find(p => poolKey(p.pool) === want)
  return hit?.resets_at_ms ?? null
}

function todayFigure(sp: SpendView): { value: string; missing: boolean } {
  const dashMoney = '$' + DASH
  if (sp.session !== '' && sp.session !== dashMoney) return { value: sp.session, missing: false }
  if (sp.host_all !== '' && sp.host_all !== dashMoney) return { value: sp.host_all, missing: false }
  return { value: DASH, missing: true }
}

function todayRow(t: T, sp: SpendView, wide: boolean, staleLive: boolean): Row {
  const fig = todayFigure(sp)
  const hourly = sp.hourly ?? null
  const hasSpark = hourly !== null && hourly.length > 0
  const spark24 = hasSpark ? sparkText(hourly.slice(-24)) : ''
  const sparkShown = hasSpark ? (wide ? spark24 : [...spark24].slice(-10).join('')) : DASH
  const valSeg: Seg = staleLive
    ? staleBadge(fig.value + ' ' + GLYPHS.state.failed)
    : fig.missing
      ? { text: fig.value, dim: true }
      : { text: fig.value }
  if (wide) {
    return [
      { text: '  ' + padR(t('page.spend.today_label'), 8) },
      valSeg,
      { text: ' · ' + t('usage.last24') + ' ' },
      hasSpark ? { text: sparkShown } : { text: sparkShown, dim: true },
    ]
  }
  return [
    { text: ' ' + t('page.spend.today_label') + ' ' },
    valSeg,
    { text: ' ' },
    hasSpark ? { text: sparkShown } : { text: sparkShown, dim: true },
  ]
}

function fuseModeWord(t: T, mode: string): string {
  if (mode === 'block') return t('spend.mode_block')
  if (mode === 'off') return t('spend.mode_off')
  return t('spend.mode_warn')
}

function accountDetailRow(t: T, acc: AccountView | null, wide: boolean, cols: number): Row {
  const indent = wide ? '  ' : ' '
  if (acc === null) return [{ text: indent + t('account.none'), dim: true }]
  const parts: string[] = []
  if (acc.email !== null) parts.push(acc.email + (acc.name === null ? '' : ' (' + acc.name + ')'))
  if (acc.org !== null) parts.push(t('label.org') + ' ' + acc.org + (acc.role === null ? '' : ' · ' + acc.role))
  if (acc.plan !== null || acc.extraUsage) parts.push(t('label.tier') + ' ' + (acc.plan ?? DASH) + (acc.extraUsage ? ' · ' + t('account.extra_on') : ''))
  if (parts.length === 0) return [{ text: indent + t('account.partial'), dim: true }]
  const prefix = indent + (wide ? padR(t('label.account'), 8) : t('label.account') + ' ')
  const rest = truncateToWidth(parts.join(' · '), Math.max(8, cols - displayWidth(prefix)))
  return [{ text: prefix, dim: true }, { text: rest }]
}

function buildDetailRows(t: T, sp: SpendView | null, quota: readonly QuotaWindow[], acc: AccountView | null | undefined, wide: boolean, cols: number, forceHourly: boolean): Row[] {
  const indent = wide ? '  ' : ' '
  const out: Row[] = []
  for (const w of quota) {
    if (w.kind === 'five_hour' || w.kind === 'seven_day') continue
    const label = w.kind === 'spend_limit' ? t('label.quota_spend') : w.kind
    out.push(meterRow({ focused: false, label, pct: w.pct, reset: reset7Text(w.resetsAtMs, wide, t), wide, stale: false }))
  }
  if (sp !== null && sp.brain !== null && sp.cap !== null && sp.cap > 0) {
    const ratio = sp.brain / sp.cap
    const cells = wide ? 20 : 10
    const on = Math.max(0, Math.min(cells, Math.round(Math.min(1, ratio) * cells)))
    const off = cells - on
    const barColor = meterKey(ratio)
    const pctStr = ' ' + padL(Math.floor(Math.max(0, ratio) * 100 + 1e-9) + '%', wide ? 4 : 3)
    const note = money(sp.brain) + ' / ' + money(sp.cap) + (wide ? ' · ' + t('spend.note', { mode: fuseModeWord(t, sp.mode) }) : '')
    const row: Seg[] = [{ text: indent + (wide ? padR(t('label.brain'), 8) : t('label.brain') + ' ') }]
    if (on > 0) row.push({ text: GLYPHS.chart.meterOn.repeat(on), ...(barColor === undefined ? {} : { color: barColor }) })
    if (off > 0) row.push({ text: GLYPHS.chart.meterOff.repeat(off), color: PALETTE.idle })
    row.push({ text: pctStr, ...(barColor === undefined ? {} : { color: barColor }) }, { text: '  ' + note, dim: true })
    out.push(row)
  }
  const dashMoney = '$' + DASH
  if (sp !== null && ((sp.host_all !== '' && sp.host_all !== dashMoney) || sp.host_all_n !== null)) {
    const hostTxt = sp.host_all_n !== null ? money(sp.host_all_n) : sp.host_all
    const line = sp.host_all_n !== null && sp.brain !== null && sp.host_all_n >= sp.brain && sp.host_all_n > 0
      ? t('page.spend.host_split', { host: hostTxt, brain: money(sp.brain), other: money(sp.host_all_n - sp.brain) })
      : t('page.spend.host_only', { host: hostTxt })
    out.push([{ text: indent + line, dim: true }])
  }
  const wantHourly = out.length > 0 || acc !== undefined || forceHourly
  if (wantHourly && sp !== null && sp.hourly != null && sp.hourly.length > 0) {
    const total = money(sp.hourly.reduce((a, b) => a + b, 0))
    const peak = money(Math.max(...sp.hourly))
    out.push([{ text: indent + t('page.spend.last24_sum', { total, peak }), dim: true }])
  }
  if (acc !== undefined) out.push(accountDetailRow(t, acc, wide, cols))
  return out
}

export function renderSpend(ctx: PageCtx, view: SpendViewOpts = DEFAULT_VIEW): { body: Row[]; actions: Row[] } {
  const { t, size, live, console: con, nowMs } = ctx
  const wide = size.cols >= 100
  const short = ctx.shortBody === true
  const indent = wide ? '  ' : ' '
  const focus = clampFocus(view.focus)
  const qFeed = seatQuota.view()
  const qWins = live?.account?.quota ?? []
  const win5 = qWins.find(w => w.kind === 'five_hour')
  const win7 = qWins.find(w => w.kind === 'seven_day')

  const ageMs = qFeed.got_at_ms === null ? null : Math.max(0, nowMs - qFeed.got_at_ms)
  const ageMin = ageMs === null ? 0 : Math.floor(ageMs / 60_000)
  const row = qFeed.row
  const staleQuota = row !== null && (row.stale === true || (ageMs !== null && ageMs > SEATS_RED_AFTER_MS))

  const body: Row[] = []
  if (!short) body.push(sectionRule(seatHeaderTitle(t, wide, row, ageMs, staleQuota), wide))

  const hasQuotaData = row !== null || win5 !== undefined || win7 !== undefined
  if (hasQuotaData) {
    const pct5 = row?.five_hour_pct ?? win5?.pct ?? null
    const pct7 = row?.seven_day_pct ?? win7?.pct ?? null
    const reset5 = reset5Text(win5?.resetsAtMs ?? null, t)
    const reset7 = reset7Text(win7?.resetsAtMs ?? matchedPoolResetMs(con, row?.pool ?? null), wide, t)
    const label5 = wide ? t('label.quota_5h') : t('page.spend.q_5h_narrow')
    const label7 = wide ? t('label.quota_7d') : t('page.spend.q_7d_narrow')
    body.push(meterRow({ focused: focus === 0, label: label5, pct: pct5, reset: reset5, wide, stale: staleQuota, press: 'spend:meter:0' }))
    body.push(meterRow({ focused: focus === 1, label: label7, pct: pct7, reset: reset7, wide, stale: staleQuota, press: 'spend:meter:1' }))
  }
  if (row !== null) {
    if (staleQuota) {
      const msg = ageMin > 0 ? t('page.spend.q_stale', { min: ageMin }) : t('page.spend.q_stale_plain')
      body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + msg))
      if (qFeed.failed) {
        const failMsg = ageMs !== null ? t('page.spend.q_failed_stale', { age: ageOf(t, ageMs) }) : t('page.now.q_failed_none')
        body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + failMsg))
      }
    } else if (qFeed.failed && ageMs !== null) {
      body.push([{ text: indent + t('page.now.q_failed', { n: Math.floor(ageMs / 1000) }), color: PALETTE.attention }])
    }
  } else if (qFeed.got_at_ms !== null && ageMs !== null) {
    body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t('page.now.q_no_self', { age: ageOf(t, ageMs) })))
    if (qFeed.failed) {
      body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t('page.spend.q_failed_stale', { age: ageOf(t, ageMs) })))
    }
  } else {
    body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t(qFeed.failed ? 'page.now.q_failed_none' : 'page.now.q_none')))
  }

  const sp = live?.detail.spend ?? null
  if (live === null) {
    body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t('page.now.no_live')))
  } else if (live.state !== 'ok') {
    if (sp !== null) body.push(todayRow(t, sp, wide, true))
    const why = (live.header ?? '').trim() || live.state
    body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t('page.spend.stale_live', { why })))
  } else if (sp === null) {
    body.push(brokenRow(indent + GLYPHS.state.failed + ' ' + t('page.spend.no_spend')))
  } else {
    body.push(todayRow(t, sp, wide, false))
  }

  if (!short && live !== null) {
    const details = buildDetailRows(t, sp, qWins, live.account?.account, wide, size.cols, view.expanded)
    if (details.length > 0) {
      if (view.expanded) {
        body.push([{ text: indent }, { text: t('page.spend.fold_close'), color: PALETTE.action, press: 'key:z' }], ...details)
      } else {
        body.push([{ text: indent }, { text: t('page.spend.fold_open', { n: details.length }), color: PALETTE.action, press: 'key:z' }])
      }
    }
  }

  if (wide && !short) body.push([{ text: '' }])
  body.push([{ text: indent + t('page.spend.see_quota') + ' ' }, { text: '[4]', press: 'tab:4:quota', color: PALETTE.action }])
  const brokenSource = row === null || staleQuota || live === null || live.state !== 'ok' || sp === null
  return { body, actions: brokenSource ? [[{ text: t('frame.unknown'), dim: true }]] : [] }
}

export const spendPage: Page = { id: 'spend', key: '7', title: '花費', framed: true, render: ctx => renderSpend(ctx) }
