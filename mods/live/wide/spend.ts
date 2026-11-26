// mods/live/wide/spend.ts — console v5 wide page 5 花費 (P4a): pure projection from existing quota / spend / speed data.
import { GLYPHS } from '../../tux/glyphs'

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
}

export type WideSpendOutput = {
  stepTitle: string
  list: string[]
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
  const stepTitle = i.missing
    ? '缺源'
    : i.stale
      ? '過時（用快取）'
      : i.pct5h === null && i.pct7d === null && i.todayTokens === null
        ? '還沒有用量'
        : '正常'

  const list: string[] = [
    '額度',
    `${GLYPHS.structure.folded} 5h ${pct(i.pct5h)}${i.reset5h ? ` · 重置 ${i.reset5h} 後` : ''}`,
  ]
  if (i.eta5h) {
    list.push(`  照速度 ${i.eta5h} 用完${i.hitBeforeReset === false ? '（晚於重置）' : i.hitBeforeReset === true ? '（早於重置）' : ''}`)
  }
  list.push(`  7d ${pct(i.pct7d)}${i.reset7d ? ` · ${i.reset7d} 後重置` : ''}`)
  list.push('額度池與今日')
  if (i.pools.length > 0) {
    list.push(`  ${i.pools.map(p => `${p.label} ${pct(p.pct)}`).join(' · ')}`)
  }
  list.push(`  今日 ${i.todayTokens ?? '—'} tokens · 輸出 ${i.tps === null ? '—' : `${i.tps} tok/s`}`)

  const reply: string[] = []
  if (i.pct5h !== null) {
    reply.push(`5h 已用 ${i.pct5h}%${i.reset5h ? `：${i.reset5h} 後重置` : ''}${i.eta5h ? `，照目前速度要 ${i.eta5h} 才用完` : ''}。`)
    if (i.hitBeforeReset === false) reply.push('不用調整；長任務可以照排。')
    else if (i.hitBeforeReset === true) reply.push('重置前會撞頂，建議放慢或切池。')
  } else {
    reply.push(i.missing ? '讀不到額度與用量資料。' : '目前還沒有用量紀錄。')
  }

  const pin: string[] = []
  if (i.pct5h !== null) {
    pin.push(`5h 已用 ${i.pct5h}%${i.ratePerHour !== null ? `，每小時約用 ${i.ratePerHour}%` : ''}。`)
  }
  if (i.eta5h && i.pct5h !== null) {
    pin.push(`撞頂：剩下 ${100 - i.pct5h}% 照這個速度約 ${i.eta5h} 用完。`)
  }
  if (i.reset5h) pin.push(`重置：5h 視窗 ${i.reset5h} 後歸零。`)
  if (i.hitBeforeReset === false) pin.push('重置先到，所以這個視窗不會撞頂。')
  if (i.pct7d !== null) pin.push(`7d 已用 ${i.pct7d}%${i.reset7d ? `，${i.reset7d} 後重置` : ''}。`)
  if (i.todayTokens !== null) pin.push(`今日 ${i.todayTokens} tokens。`)

  return {
    stepTitle,
    list,
    reply,
    hints: 'j/k 換筆 · o 展開 · Esc 關閉',
    pin,
    ctx: [],
    hist: i.seatUsage.length > 0 ? { title: '今天各席用量', rows: i.seatUsage } : null,
    events: null,
    summary: wideSpendSummary(i),
  }
}
