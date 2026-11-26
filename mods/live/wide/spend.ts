// mods/live/wide/spend.ts — console v5 wide page 5 花費 (P4a): pure projection from existing quota / spend / speed data.
import { GLYPHS } from '../../tux/glyphs'
import type { WideListRow } from './band'

export type WideSpendPool = {
  label: string
  pct: number | null
}

export type WideSpendInput = {
  pct5h: number | null
  reset5h: string | null
  eta5h: string | null
  hitBeforeReset: boolean | null
  ratePerHour: number | null
  pct7d: number | null
  reset7d: string | null
  pools: WideSpendPool[]
  todayTokens: string | null
  tps: number | null
  seatUsage: string[]
  stale: boolean
  missing: boolean
  // design states beyond the plain rows (P5a); all optional
  label?: string // the state label of the title when it is not 正常 / 過時（用快取） / 缺源 / 還沒有用量
  staleAge?: string // the quota is a cache this old, e.g. `18 分鐘前`: the 5h / 7d rows say so
  poolsNote?: string // after the 額度池 heading, e.g. `（14 分鐘前）`
  poolsMissing?: boolean // the pool list is unreadable
  todayMissing?: boolean // today's usage is unreadable
  todayNote?: string // after the speed on the 今日 row, e.g. `（35 分鐘前）`
  trend24h?: string // the 24h trend phrase of the 今日 context row
  poolRows?: { label: string; pct: number }[] // many pools: the list is the pool list, the cursor walks it
  cursor?: number
  narrative?: string[] // the source's own words for the reply column; absent = built from the figures
  detail?: string[] // the context rows the source gives; absent = built from the figures
  warnings?: string[] // fixed warning rows (source missing / stale)
  meterLines?: WideListRow[] // metering coverage rows (pages/metering.ts meteringWideRows), after the pool block; a row over 10% carries the `action` role; absent on older callers
}

export type WideSpendOutput = {
  stepTitle: string
  list: WideListRow[]
  reply: string[]
  hints: string
  pin: string[]
  ctx: string[]
  hist: { title: string; rows: string[] } | null
  events: string[] | null
  summary: string | null
}

const pct = (v: number | null): string => (v === null ? '—' : `${v}%`)

export function wideSpendSummary(i: Pick<WideSpendInput, 'pct5h' | 'pct7d' | 'todayTokens' | 'missing'>): string | null {
  if (i.missing && i.pct5h === null && i.pct7d === null && i.todayTokens === null) return null
  return `5h ${pct(i.pct5h)} · 7d ${pct(i.pct7d)} · 今日 ${i.todayTokens ?? '—'} tokens`
}

export function wideSpend(i: WideSpendInput): WideSpendOutput {
  const stepTitle = i.label ?? (i.missing
    ? '缺源'
    : i.stale
      ? '過時（用快取）'
      : i.pct5h === null && i.pct7d === null && i.todayTokens === null
        ? '還沒有用量'
        : '正常')

  const list: WideListRow[] = []
  const age = i.staleAge !== undefined ? ` ${GLYPHS.state.need_you} ${i.staleAge}` : ''
  const poolsText = i.pools.length > 0 ? `  ${i.pools.map(p => `${p.label} ${pct(p.pct)}`).join(' · ')}` : null
  if (i.poolRows !== undefined) {
    const cur = i.cursor ?? 0
    list.push(`額度池 ${i.poolRows.length}`)
    i.poolRows.forEach((p, idx) => list.push(`${idx === cur ? GLYPHS.structure.folded : ' '} ${p.label} · ${pct(p.pct)}`))
  } else {
    list.push(i.staleAge !== undefined ? '額度（快取）' : '額度')
    if (i.pct5h === null) list.push(`${GLYPHS.structure.folded} 5h 讀不到`)
    else if (i.pct5h === 0 && !i.reset5h) list.push(`${GLYPHS.structure.folded} 5h 0% · 視窗還沒開始`)
    else list.push(`${GLYPHS.structure.folded} 5h ${pct(i.pct5h)}${age}${i.reset5h ? ` · 重置 ${i.reset5h} 後` : ''}`)
    if (i.eta5h) {
      list.push(`  照速度 ${i.eta5h} 用完${i.hitBeforeReset === false ? '（晚於重置）' : i.hitBeforeReset === true ? '（早於重置）' : ''}`)
    }
    list.push(i.pct7d === null ? '  7d 讀不到' : `  7d ${pct(i.pct7d)}${age}${i.reset7d ? ` · ${i.reset7d} 後重置` : ''}`)
    const combined = poolsText !== null && i.todayTokens !== null && i.tps !== null && i.todayNote === undefined && i.poolsNote === undefined
    if (combined || poolsText !== null || i.poolsMissing === true || i.poolsNote !== undefined) list.push(combined ? '額度池與今日' : `額度池${i.poolsNote ?? ''}`)
    if (i.poolsMissing) list.push('  額度池讀不到')
    else if (poolsText !== null) list.push(poolsText)
    if (combined) {
      list.push(`  今日 ${i.todayTokens} tokens · 輸出 ${i.tps} tok/s`)
    } else {
      list.push('今日')
      if (i.todayMissing) list.push('  今日用量讀不到')
      else if (i.todayTokens === null) list.push('  還沒有請求')
      else if (i.tps === null) list.push(`  ${i.todayTokens} tokens · 速度 —`)
      else list.push(`  ${i.todayTokens} · ${i.tps} tok/s${i.todayNote ?? ''}`)
    }
  }

  const reply: string[] = []
  if (i.narrative !== undefined) {
    reply.push(...i.narrative)
  } else if (i.pct5h !== null) {
    reply.push(`5h 已用 ${i.pct5h}%${i.reset5h ? `：${i.reset5h} 後重置` : ''}${i.eta5h ? `，照目前速度要 ${i.eta5h} 才用完` : ''}${i.hitBeforeReset === false ? '，重置前不會撞頂' : ''}。`)
    if (i.hitBeforeReset === false) reply.push('不用調整；長任務可以照排。')
    else if (i.hitBeforeReset === true) reply.push('重置前會撞頂，建議放慢或切池。')
  } else {
    reply.push(i.missing ? '讀不到額度與用量資料。' : '目前還沒有用量紀錄。')
  }

  const ctx: string[] = []
  if (i.detail !== undefined) {
    ctx.push(...i.detail)
  } else {
    if (i.pct5h !== null) {
      ctx.push(`5h 已用 ${i.pct5h}%${i.ratePerHour !== null ? `，每小時約用 ${i.ratePerHour}%` : ''}。`)
    }
    if (i.eta5h && i.pct5h !== null) {
      ctx.push(`撞頂：剩下 ${100 - i.pct5h}% 照這個速度約 ${i.eta5h} 用完。`)
    }
    if (i.reset5h) ctx.push(`重置：5h 視窗 ${i.reset5h} 後歸零。`)
    if (i.hitBeforeReset === false) ctx.push('重置先到，所以這個視窗不會撞頂。')
    if (i.pct7d !== null) ctx.push(`7d 已用 ${i.pct7d}%${i.reset7d ? `，${i.reset7d} 後重置` : ''}。`)
    if (i.todayTokens !== null) ctx.push(`今日 ${i.todayTokens} tokens${i.trend24h ? `；${i.trend24h}` : ''}。`)
  }

  if (i.meterLines !== undefined) list.push(...i.meterLines)

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    pin: i.warnings ?? [],
    ctx,
    hist: i.seatUsage.length > 0 ? { title: '今天各席用量', rows: i.seatUsage } : null,
    events: null,
    summary: wideSpendSummary(i),
  }
}
