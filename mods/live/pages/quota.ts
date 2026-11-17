// mods/live/pages/quota.ts — page 4 額度 (plan r2 §4.1, g2 folds A1 / A3 / A7 / A10 / A11): one row per quota pool, in danger order, with the verdict of fold A7.
// Pure: a PageCtx in, rows out; frameRows draws the header, the strip and the padding. Every number is the feed's (console quota.pools, capacity's pace): the pane never
// recomputes a rate or a projection, a field the feed lacks stays null and is drawn as a dash, never as 0.
//   pace missing (sources.quota_forecast is not ok): rate, projection and verdict columns read "✗ 無來源：capacity pace 未接", except limit_hit (a fact) and a stale pool (a fact)
//   stale (> 10 min or flagged): the row is red with the full reason, the numbers stay and carry a ✗ (A1, A10); 80x24 writes the reason in a row under the table, untruncated
//   Enter (A3) expands the focused pool's seats from `fleet seats --quota --json`; the page draws them from `quota.seats` when the feed carries them
import { STRIP_SPLIT_COLS } from './frame'
import type { Page, PageCtx } from './frame'
import { brokenRow } from './rows'
import type { Row } from './rows'
import type { QuotaSeat } from '../console'
import type { Seg } from '../model'
import { GLYPHS, PALETTE, displayWidth } from '../ui'
import type { QuotaPool, Verdict } from './quota-pick'
import { ROLE_WARNING, isUnknownPool, normalizedPools, poolKey, poolLabel, rankPools } from './quota-pick'

export type QuotaView = { focus: number; expanded: boolean } // the pane's own state (j/k, Enter); the page contract has no place for it yet, so render() uses the default

export type { QuotaSeat }

// ---- drawing helpers ----
const DASH = GLYPHS.structure.empty
const bad = GLYPHS.state.failed
const padR = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - displayWidth(text)))
// numbers stand against the right edge of their column (the last two cells are the stale mark's and a gap), so the % signs line up (G8)
const padL = (text: string, w: number): string => ' '.repeat(Math.max(0, w - displayWidth(text))) + text
const roleColor = (r: Verdict['role']): Seg['color'] => (r === 'broken' ? PALETTE.broken : r === ROLE_WARNING ? PALETTE.attention : PALETTE.done)
const roleGlyph = (r: Verdict['role']): string => (r === 'broken' ? GLYPHS.state.failed : r === ROLE_WARNING ? GLYPHS.state.need_you : GLYPHS.state.done)
const roleWord = (t: PageCtx['t'], r: Verdict['role']): string => (r === 'broken' ? t('page.quota.role_broken') : r === ROLE_WARNING ? t('page.quota.role_warning') : t('page.quota.role_success'))
const pct = (n: number | null, mark: boolean): string => (n === null ? DASH : Math.round(n) + '%') + (mark ? bad : '')
const numCell = (text: string, mark: boolean, w: number): string => padL(text, w - 2) + (mark ? bad : ' ') + ' '
const rate = (n: number | null, mark: boolean, t: PageCtx['t']): string => (n === null ? DASH : (n >= 0 ? '+' : '') + n.toFixed(1) + t('page.quota.rate_unit')) + (mark ? bad : '')

function tpe(ms: number): { mo: string; d: string; dow: number; hh: string; mm: string } {
  const d = new Date(ms + 8 * 3600000)
  const z = (n: number): string => String(n).padStart(2, '0')
  return { mo: z(d.getUTCMonth() + 1), d: z(d.getUTCDate()), dow: d.getUTCDay(), hh: z(d.getUTCHours()), mm: z(d.getUTCMinutes()) }
}
type Tier = 'wide' | 'mid' | 'narrow'
const tierOf = (cols: number): Tier => (cols >= 140 ? 'wide' : cols >= 100 ? 'mid' : 'narrow')

function ageText(ctx: PageCtx, ms: number | null): string | null {
  if (ms === null) return null
  const s = Math.max(0, Math.floor((ctx.nowMs - ms) / 1000))
  return s < 60 ? ctx.t('page.quota.age_s', { n: s }) : s < 3600 ? ctx.t('page.quota.age_m', { n: Math.floor(s / 60) }) : ctx.t('page.quota.age_h', { n: Math.floor(s / 3600) })
}
// "── title ─────── right"
function rule(title: string, right: string | null, cols: number): Row {
  const left = GLYPHS.structure.rule.repeat(2) + ' ' + title + ' '
  const r = right !== null && displayWidth(left) + 2 + displayWidth(' ' + right) <= cols ? ' ' + right : ''
  const fill = Math.max(2, cols - displayWidth(left) - displayWidth(r))
  return clipRowPlain([{ text: left, color: PALETTE.structure }, { text: GLYPHS.structure.rule.repeat(fill), color: PALETTE.structure }, ...(r === '' ? [] : [{ text: r, dim: true }])], cols)
}

type Cols = { pool: number; d7: number; h5: number; reset: number; burn: number; proj: number; exh: number; seats: number }
const COLS: Record<Tier, Cols> = {
  wide: { pool: 20, d7: 9, h5: 10, reset: 18, burn: 12, proj: 9, exh: 14, seats: 7 },
  mid: { pool: 14, d7: 8, h5: 10, reset: 14, burn: 11, proj: 9, exh: 0, seats: 0 },
  narrow: { pool: 10, d7: 7, h5: 6, reset: 7, burn: 10, proj: 8, exh: 0, seats: 0 },
}

function clipPlain(text: string, w: number): string {
  if (displayWidth(text) <= w) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (used + cw > w) break
    out += ch
    used += cw
  }
  return out
}

function fitCellR(text: string, w: number): string {
  if (w <= 0) return ''
  const fitted = displayWidth(text) < w ? text : clipPlain(text, Math.max(1, w - 1))
  return padR(fitted, w)
}

function clipRowPlain(row: Row, cols: number): Row {
  if (cols <= 0) return [{ text: '' }]
  const out: Row = []
  let used = 0
  for (const s of row) {
    const w = displayWidth(s.text)
    if (used + w <= cols) { out.push(s); used += w; continue }
    const room = cols - used
    if (room > 0) out.push({ ...s, text: clipPlain(s.text, room) })
    break
  }
  return out.length === 0 ? [{ text: '' }] : out
}

function shortVerdict(p: QuotaPool, v: Verdict, nowMs: number, paceOk: boolean, t: PageCtx['t']): string {
  const stalled = v.kind === 'stale' || v.kind === 'stale_seat'
  const fact = p.limit_hit === true || stalled
  if (!paceOk && !fact) return bad + ' ' + t('page.quota.sv_nopace')
  if (v.kind === 'limit_nosw') return t('page.quota.sv_limit_nosw')
  if (v.kind === 'limit_stranded') return t('page.quota.sv_limit_stranded', { n: p.stranded_seats ?? 0 })
  if (v.kind === 'limit_switched') return t('page.quota.sv_limit_switched', { pool: typeof p.switched === 'string' ? poolLabel(p.switched) : DASH })
  if (v.kind === 'stale') return bad + ' ' + t('page.quota.sv_stale', { min: v.staleMin === null ? DASH : v.staleMin })
  if (v.kind === 'stale_seat') return bad + ' ' + (v.staleMin === null ? t('page.quota.sv_stale_seat_plain') : t('page.quota.sv_stale_seat', { min: v.staleMin }))
  if (v.kind === 'exhaust_nosw') {
    const h = p.projected_exhaustion_at_ms === null ? '?' : Math.max(0, Math.round((p.projected_exhaustion_at_ms - nowMs) / 3600000))
    return t('page.quota.sv_exhaust_nosw', { h })
  }
  if (v.kind === 'exhaust_stranded' || v.kind === 'exhaust_ok') {
    const h = p.projected_exhaustion_at_ms === null ? '?' : Math.max(0, Math.round((p.projected_exhaustion_at_ms - nowMs) / 3600000))
    return t('page.quota.sv_exhaust', { h })
  }
  if (v.kind === 'use') return t('page.quota.sv_use', { p: p.projected_pct_at_reset === null ? 0 : Math.round(p.projected_pct_at_reset) })
  if (v.kind === 'waste') return t('page.quota.sv_waste', { y: Math.round(v.waste ?? 0) })
  return bad + ' ' + t('page.quota.sv_nopace')
}

function resetText(ms: number | null, tier: Tier, dows: string[]): string {
  if (ms === null) return DASH
  const x = tpe(ms)
  const dow = dows[x.dow] ?? ''
  return tier === 'wide' ? `${x.mo}-${x.d} ${dow} ${x.hh}:${x.mm}` : tier === 'mid' ? `${dow} ${x.hh}:${x.mm}` : `${dow}${x.hh}`
}

function rowWrappedLen(row: Row, cols: number): number {
  if (cols <= 0 || row.reduce((w, x) => w + displayWidth(x.text), 0) <= cols) return 1
  let lines = 0
  let used = 0
  let hasCur = false
  for (const seg of row) {
    for (const ch of seg.text) {
      const w = displayWidth(ch)
      if (used + w > cols) {
        lines++
        used = 0
        hasCur = false
      }
      used += w
      hasCur = true
    }
  }
  return lines + (hasCur ? 1 : 0)
}
const rowsWrappedLen = (list: Row[], cols: number): number => list.reduce((n, r) => n + rowWrappedLen(r, cols), 0)

export function renderQuota(ctx: PageCtx, view: QuotaView = { focus: 0, expanded: false }): { body: Row[]; actions: Row[] } {
  const { t } = ctx
  const cols = ctx.size.cols
  if (ctx.console === null) return { body: [brokenRow(bad + ' ' + t('page.quota.no_console'))], actions: [] }
  const q = ctx.console.quota // pools null = the console has no quota.pools (no source)
  if (q.pools === null || q.pools.length === 0) return { body: [brokenRow(bad + ' ' + t('page.quota.no_pools'))], actions: [] }
  const tier = tierOf(cols)
  const c = COLS[tier]
  const dows = t('page.quota.dow').split(' ')
  const paceOk = ctx.console.sources.quota_forecast?.state === 'ok'
  // normalizedPools (quota-pick.ts) is the one place that drops projections without a forecast source, folds seat_blocked, and deduplicates by pool_key (R1)
  const blocked = ctx.console.items.filter(i => i.kind === 'seat_blocked' && typeof i.facts.pool === 'string')
  const blockedBy = (pool: string) => blocked.filter(i => poolKey(String(i.facts.pool)) === poolKey(pool))
  const pools = normalizedPools(ctx.console) as QuotaPool[]
  const ranked = rankPools(pools, ctx.nowMs, t)
  const byName = new Map(pools.map(p => [p.pool, p]))
  const focus = Math.max(0, Math.min(view.focus, ranked.length - 1))
  const win = pools.map(p => p.burn_window_h).find((h): h is number => h !== null)
  const h = win === undefined ? '-' : String(win)
  const svs = ranked.map(v => shortVerdict(byName.get(v.pool) as QuotaPool, v, ctx.nowMs, paceOk, t))
  const verdictHead = paceOk ? t('page.quota.col_verdict') : t('page.quota.col_rate_proj_verdict')
  const verdictW = Math.max(displayWidth(verdictHead), ...svs.map(displayWidth))
  const widthWith = (withReset: boolean, withBurn: boolean): number => {
    const resetW = withReset ? c.reset : 0
    if (!paceOk) return 4 + c.pool + c.d7 + c.h5 + resetW + verdictW
    const burnW = withBurn ? c.burn : 0
    const wideExtra = tier === 'wide' ? c.exh + c.seats : 0
    return 4 + c.pool + c.d7 + c.h5 + resetW + burnW + c.proj + wideExtra + verdictW
  }
  // When columns do not fit: drop 重置 first, then 近 6 時. Never wrap a table row.
  const showReset = widthWith(true, true) <= cols
  const showBurn = paceOk && (showReset || widthWith(false, true) <= cols)
  const headerRows: Row[] = []

  if (!ctx.shortBody) {
    // title row, with the age of the quota source on the right
    const age = ageText(ctx, ctx.console.sources.quota_now?.at_ms ?? null)
    const right = age === null ? null : t('page.quota.data_age', { age })
    const title = paceOk ? t(tier === 'wide' ? 'page.quota.title_pace' : 'page.quota.title_pace_s', { h }) : t('page.quota.title_nopace') + ' · ' + bad + ' ' + t('page.quota.v_nopace')
    headerRows.push(rule(title, right, cols))
    if (!paceOk && tier !== 'narrow') headerRows.push(clipRowPlain([{ text: '(' + t('page.quota.title_nopace_note') + ')', dim: true }], cols))

    // column header
    const head: string[] = ['    ' + padR(t('page.quota.col_pool'), c.pool)]
    const short = tier === 'narrow'
    head.push(numCell(t(short ? 'page.quota.col_7d_s' : 'page.quota.col_7d'), false, c.d7), numCell(t(short ? 'page.quota.col_5h_s' : 'page.quota.col_5h'), false, c.h5))
    if (showReset) head.push(padR(t(short ? 'page.quota.col_reset_s' : 'page.quota.col_reset'), c.reset))
    if (paceOk) {
      if (showBurn) head.push(numCell(t('page.quota.col_burn', { h }), false, c.burn))
      head.push(numCell(t('page.quota.col_proj'), false, c.proj))
      if (tier === 'wide') head.push(padR(t('page.quota.col_exh'), c.exh), padR(t('page.quota.col_seats'), c.seats))
    }
    head.push(verdictHead)
    headerRows.push(clipRowPlain([{ text: head.join(''), dim: true }], cols))
  }

  // exactly one row per pool at every width; R4: unknown pools use `?` icon with warning colour role; R10: rate carries `%/時`
  const poolRowsAll: Row[] = ranked.map((v, i) => {
    const p = byName.get(v.pool) as QuotaPool
    const isStale = v.kind === 'stale' // the pool as a whole is old: its numbers carry the mark
    const seg = (text: string, color?: Seg['color']): Seg => (color === undefined ? { text } : { text, color })
    const mark = (x: string): Seg => seg(x, isStale ? PALETTE.broken : undefined)
    const icon = isUnknownPool(v) ? GLYPHS.state.unknown : roleGlyph(v.role)
    const row: Seg[] = [
      seg(i === focus ? GLYPHS.structure.folded + ' ' : '  '),
      seg(icon + ' ', roleColor(v.role)),
      seg(fitCellR(poolLabel(v.pool), c.pool)),
      mark(numCell(p.seven_day_pct === null ? DASH : Math.round(p.seven_day_pct) + '%', isStale, c.d7)),
      mark(numCell(p.five_hour_pct === null ? DASH : Math.round(p.five_hour_pct) + '%', isStale, c.h5)),
    ]
    if (showReset) row.push(seg(padR(resetText(p.resets_at_ms, tier, dows), c.reset)))
    if (paceOk) {
      if (showBurn) row.push(mark(numCell(rate(p.burn_pct_per_h, false, t), isStale, c.burn)))
      row.push(mark(numCell(p.projected_pct_at_reset === null ? DASH : (p.projected_pct_at_reset > 100 ? '>100' : Math.round(p.projected_pct_at_reset)) + '%', isStale, c.proj)))
      if (tier === 'wide') {
        const ex = p.limit_hit === true ? t('page.quota.used_up') : p.projected_exhaustion_at_ms === null ? DASH : (() => { const x = tpe(p.projected_exhaustion_at_ms); return `${x.mo}-${x.d} ${x.hh}:${x.mm}` })()
        row.push(seg(padR(ex, c.exh)), seg(padR(p.seats === null ? DASH : t('page.quota.seats_n', { n: p.seats }), c.seats)))
      }
    }
    const press = 'quota:pool:' + i // the whole row is one Button: it focuses this pool and shows / folds its seats
    row.push(seg(svs[i], roleColor(v.role)))
    return clipRowPlain(row.map(sg => ({ ...sg, press })), cols)
  })

  // the focused pool's detail carries the full verdict text (R5: reserved whole before non-focused pools can push it into `↓ 還有 N 列`)
  const fv = ranked[focus]
  const fp = byName.get(fv.pool) as QuotaPool
  const actions: Row[] = fp.switch_suggestion === null ? [] : [[{ text: t('page.quota.action_f'), color: PALETTE.action, press: 'fill:quota:' + fp.pool }]]
  const stripLen = cols < STRIP_SPLIT_COLS ? Math.min(2, ctx.size.rows) : Math.min(1, ctx.size.rows)
  const avail = Math.max(0, ctx.size.rows - 1 - stripLen)
  const actLen = Math.max(1, actions.length)
  const room = Math.max(0, avail - Math.min(actLen, avail))

  const kv = (label: string, text: string, color?: Seg['color']): Row => [{ text: padR(label, 6), dim: true }, color === undefined ? { text } : { text, color }]
  const openRow: Row = [{ text: '  ' }, { text: t(view.expanded ? 'page.quota.act_o_close' : 'page.quota.act_o_open'), color: PALETTE.action, press: 'quota:open' }] // G11: o is a Button (click works where the pane has no keyboard)
  const mine = q.seats.filter(s => poolKey(s.pool) === poolKey(fp.pool))
  const names = mine.map(s => s.seat)
  const count = fp.seats === null ? t('page.quota.f_seats_unknown') : t('page.quota.f_seats_n', { n: fp.seats })
  const seatsSummary = kv(t('page.quota.f_seats'), (names.length === 0 ? '' : names.slice(0, 2).join(' · ') + (names.length > 2 || (fp.seats ?? 0) > 2 ? ' · … ' : ' ')) + count)
  const seatRowText = (s: QuotaSeat): string => t('page.quota.seat_row', { seat: s.seat, a: pct(s.seven_day_pct, s.stale === true), b: pct(s.five_hour_pct, s.stale === true), age: s.age_min === null ? DASH : t('page.quota.age_m', { n: s.age_min }) })
  const fact = fp.limit_hit === true ? t('page.quota.f_limit_hit') + '，' : ''
  const verdictRow = kv(t('page.quota.f_verdict'), t('page.quota.f_verdict_row', { role: roleWord(t, fv.role), text: fact + fv.text }), roleColor(fv.role))
  const blockedRows: Row[] = blockedBy(fp.pool).map(it => {
    const stale = it.facts.stale === true
    return kv(t('page.quota.f_blocked'), (stale ? bad + ' ' : '') + it.text + (stale ? ' ' + bad + ' ' + t('page.quota.blocked_stale', { source: String(it.facts.source ?? '?') }) : ''), stale ? PALETTE.broken : undefined)
  })
  const verdictBlock: Row[] = [...blockedRows, verdictRow]

  const pickPools = (maxRows: number, withMore: boolean): Row[] => {
    if (maxRows <= 0) return []
    if (poolRowsAll.length <= maxRows) return poolRowsAll
    if (!withMore || maxRows === 1) {
      if (focus < maxRows) return poolRowsAll.slice(0, maxRows)
      return [...poolRowsAll.slice(0, maxRows - 1), poolRowsAll[focus]]
    }
    const keep = maxRows - 1
    const picked = focus < keep ? poolRowsAll.slice(0, keep) : [...poolRowsAll.slice(0, keep - 1), poolRowsAll[focus]]
    return [...picked, [{ text: t('frame.more', { n: poolRowsAll.length - keep, arrow: GLYPHS.structure.behind }), dim: true }]]
  }

  if (ctx.shortBody) {
    // R5 compact mode (<= 4 body rows): reserve the focused pool's full wrapped verdict first (plus >= 1 pool row when room >= 1), then fill remaining rows with pools and seats.
    const vLen = rowsWrappedLen(verdictBlock, cols)
    const maxPools = room <= 0 ? 0 : Math.max(1, room - vLen)
    const shownPools = pickPools(maxPools, false)
    const tail: Row[] = []
    if (view.expanded) {
      if (mine.length === 0) tail.push(kv(t('page.quota.f_seats'), t('page.quota.seat_none')))
      else mine.forEach((s, i) => tail.push(kv(i === 0 ? t('page.quota.f_seats') : '', seatRowText(s), s.stale === true ? PALETTE.broken : undefined)))
      tail.push(openRow)
    } else {
      tail.push(seatsSummary, openRow)
    }
    return { body: [...shownPools, ...verdictBlock, ...tail], actions }
  }

  const focusTitle = rule(t(tier === 'narrow' ? 'page.quota.focus_title_s' : view.expanded ? 'page.quota.focus_title_open' : 'page.quota.focus_title', { pool: poolLabel(fv.pool) }), null, cols)
  const expandedSeatRows: Row[] = []
  if (view.expanded) {
    if (mine.length === 0) expandedSeatRows.push(kv('', t('page.quota.seat_none')))
    for (const s of mine) expandedSeatRows.push(kv('', seatRowText(s), s.stale === true ? PALETTE.broken : undefined))
  }
  const switchRows: Row[] = []
  if (tier !== 'narrow') {
    const none = fp.stranded_seats === null && fp.switched === null
    switchRows.push(kv(t('page.quota.f_switch'), none ? t('page.quota.f_switch_null') : t('page.quota.f_switch_data', { n: fp.stranded_seats === null ? DASH : fp.stranded_seats, pool: typeof fp.switched === 'string' ? poolLabel(fp.switched) : DASH })))
  }
  const orderRows: Row[] = tier === 'wide' ? [kv(t('page.quota.f_order'), t(paceOk ? 'page.quota.f_order_pace' : 'page.quota.f_order_nopace'), undefined)] : []

  const fullFocus: Row[] = [[{ text: '' }], focusTitle, openRow, seatsSummary, ...expandedSeatRows, ...switchRows, ...verdictBlock, ...orderRows]
  const fullBody: Row[] = [...headerRows, ...poolRowsAll, ...fullFocus]
  if (room <= 0 || rowsWrappedLen(fullBody, cols) <= room) return { body: fullBody, actions }

  // R5: when fullBody overflows room at 120x30 / 80x24 / wide, reserve the focused pool's full wrapped verdict first, then allocate remaining rows to the pool table (with `↓ 還有 N 列`).
  const headLen = rowsWrappedLen(headerRows, cols)
  const focusCandidates: Row[][] = [
    fullFocus,
    [[{ text: '' }], focusTitle, openRow, seatsSummary, ...expandedSeatRows, ...switchRows, ...verdictBlock],
    [focusTitle, openRow, seatsSummary, ...expandedSeatRows, ...switchRows, ...verdictBlock],
    [focusTitle, openRow, seatsSummary, ...verdictBlock],
    [focusTitle, openRow, ...verdictBlock],
    [focusTitle, ...verdictBlock],
    verdictBlock,
  ]
  const minPoolRows = Math.min(poolRowsAll.length, 2)
  let keptFocus = verdictBlock
  for (const cand of focusCandidates) {
    if (headLen + minPoolRows + rowsWrappedLen(cand, cols) <= room) { keptFocus = cand; break }
  }
  let keptHeader = headerRows
  if (headLen + 1 + rowsWrappedLen(keptFocus, cols) > room) keptHeader = []
  const poolRoom = Math.max(1, room - rowsWrappedLen(keptHeader, cols) - rowsWrappedLen(keptFocus, cols))
  const shownPools = pickPools(poolRoom, true)
  return { body: [...keptHeader, ...shownPools, ...keptFocus], actions }
}

export const quotaPage: Page = { id: 'quota', key: '4', title: '額度', framed: true, render: ctx => renderQuota(ctx) }
